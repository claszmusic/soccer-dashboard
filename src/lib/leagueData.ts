// src/lib/leagueData.ts
// STABLE + SELF-HEALING VERSION
// Fixes "teams randomly blank" by:
// - Disabling caching (no-store) so Vercel doesn't serve partial API results
// - Retrying if API returns suspiciously small/empty fixture payloads
// - Per-team fallback if league fixture list doesn't include a team
// - Never dropping matches if corners/cards fail

export type MatchCard = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;
  goalsTotal: number | null;
  cornersTotal: number | null;
  cardsTotal: number | null;
};

export type TeamBoard = {
  teamId: number;
  name: string;
  logo: string;
  matches: MatchCard[];
};

export type LeagueBoard = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  error?: string;
  teams: TeamBoard[];
};

const LEAGUES: Array<{ leagueId: number; leagueName: string }> = [
  { leagueId: 262, leagueName: "Liga MX" },
  { leagueId: 39, leagueName: "Premier League" },
  { leagueId: 78, leagueName: "Bundesliga" },
  { leagueId: 140, leagueName: "La Liga" },
  { leagueId: 135, leagueName: "Serie A" },
];

const API_BASE = "https://v3.football.api-sports.io";
const FINISHED = new Set(["FT", "AET", "PEN"]);

// ---------------- utils ----------------
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toQS(params: Record<string, string | number | boolean | undefined>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

function blankMatch(): MatchCard {
  return {
    fixtureId: 0,
    date: "",
    opponent: "-",
    isHome: true,
    goalsTotal: null,
    cornersTotal: null,
    cardsTotal: null,
  };
}

function statNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sumNumbers(values: Array<number | null>): number | null {
  const any = values.some((x) => x !== null);
  if (!any) return null;
  return values.reduce((acc, v) => acc + (v ?? 0), 0);
}

// ---------------- API fetch (NO CACHE) + strong retry ----------------
async function apiFetch<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const apiKey =
    process.env.APISPORTS_KEY ||
    process.env.APISPORTS_API_KEY ||
    process.env.APISPORTSKEY;

  if (!apiKey) return { ok: false as const, error: "Missing APISPORTS_KEY env var" };

  const url = `${API_BASE}${path}${toQS(params)}`;

  const maxAttempts = 7;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "x-apisports-key": apiKey },
        // IMPORTANT: do not let Vercel/Next cache partial responses
        cache: "no-store",
      });

      if (r.status === 429) {
        const wait = Math.min(20000, 1000 * Math.pow(2, attempt - 1));
        await sleep(wait);
        continue;
      }

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        return {
          ok: false as const,
          error: `API ${r.status}: ${txt || r.statusText}`,
          status: r.status,
        };
      }

      const json = (await r.json()) as T;
      return { ok: true as const, data: json };
    } catch (e: any) {
      if (attempt === maxAttempts) {
        return { ok: false as const, error: `Network error: ${e?.message ?? String(e)}` };
      }
      await sleep(Math.min(12000, 700 * Math.pow(2, attempt - 1)));
    }
  }

  return { ok: false as const, error: "Unknown error" };
}

// ---------------- API types (minimal) ----------------
type ApiLeaguesResp = {
  response: Array<{
    seasons: Array<{ year: number; current: boolean }>;
  }>;
};

type ApiTeamsResp = {
  response: Array<{ team: { id: number; name: string; logo: string } }>;
};

type ApiFixturesResp = {
  response: Array<{
    fixture: { id: number; date: string; status: { short: string } };
    teams: { home: { id: number; name: string }; away: { id: number; name: string } };
    goals: { home: number | null; away: number | null };
  }>;
};

type ApiFixtureStatsResp = {
  response: Array<{
    statistics: Array<{ type: string; value: number | string | null }>;
  }>;
};

type ApiEventsResp = {
  response: Array<{
    type: string;
    detail: string;
  }>;
};

// ---------------- core fetchers ----------------
async function getCurrentSeason(leagueId: number): Promise<number | null> {
  const r = await apiFetch<ApiLeaguesResp>("/leagues", { id: leagueId });
  if (!r.ok) return null;

  const seasons = r.data.response?.[0]?.seasons ?? [];
  return seasons.find((s) => s.current)?.year ?? seasons[0]?.year ?? null;
}

async function getTeamsForLeague(leagueId: number, season: number): Promise<TeamBoard[] | null> {
  const r = await apiFetch<ApiTeamsResp>("/teams", { league: leagueId, season });
  if (!r.ok) return null;

  return (r.data.response ?? []).map((x) => ({
    teamId: x.team.id,
    name: x.team.name,
    logo: x.team.logo,
    matches: [],
  }));
}

// League fixtures (season-aligned) with retries if response looks "too small"
async function getLeagueFinishedFixtures(leagueId: number, season: number) {
  // Try a couple times if we get a suspiciously small payload
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await apiFetch<ApiFixturesResp>("/fixtures", {
      league: leagueId,
      season,
      last: 1000,
    });

    if (!r.ok) {
      await sleep(800 * attempt);
      continue;
    }

    const all = r.data.response ?? [];
    const finished = all.filter((fx) => FINISHED.has(fx.fixture.status?.short));

    // If this comes back tiny, it's often a throttled/partial payload -> retry
    if (finished.length >= 60 || attempt === 3) return finished;

    await sleep(900 * attempt);
  }

  return [];
}

// Per-team fallback (only used when league list doesn't include the team)
async function getTeamFinishedFixtures(teamId: number, season: number) {
  const r = await apiFetch<ApiFixturesResp>("/fixtures", {
    team: teamId,
    season,
    last: 30,
  });
  if (!r.ok) return [];

  const all = r.data.response ?? [];
  return all.filter((fx) => FINISHED.has(fx.fixture.status?.short)).slice(0, 7);
}

async function getCornersTotal(fixtureId: number): Promise<number | null> {
  const r = await apiFetch<ApiFixtureStatsResp>("/fixtures/statistics", { fixture: fixtureId });
  if (!r.ok) return null;

  const rows = r.data.response ?? [];
  if (!rows.length) return null;

  // Some responses group by team; we sum Corner Kicks across the returned rows
  const cornerVals: Array<number | null> = rows.map((row) => {
    const v = row.statistics.find((s) => s.type === "Corner Kicks")?.value ?? null;
    return statNumber(v);
  });

  return sumNumbers(cornerVals);
}

async function getCardsTotal(fixtureId: number): Promise<number | null> {
  const r = await apiFetch<ApiEventsResp>("/fixtures/events", { fixture: fixtureId });
  if (!r.ok) return null;

  const events = r.data.response ?? [];
  if (!events.length) return 0;

  let yellow = 0;
  let red = 0;

  for (const e of events) {
    if (e.type !== "Card") continue;
    const d = (e.detail ?? "").toLowerCase();
    if (d.includes("yellow")) yellow++;
    if (d.includes("red")) red++;
  }

  return yellow + red;
}

async function retryNullable<T>(
  fn: () => Promise<T | null>,
  tries: number,
  baseWaitMs: number
): Promise<T | null> {
  for (let i = 1; i <= tries; i++) {
    const v = await fn();
    if (v !== null) return v;
    if (i < tries) await sleep(baseWaitMs * i);
  }
  return null;
}

// ---------------- exported ----------------
export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  // Gentle concurrency for stats/events
  const fxLimiter = createLimiter(2);

  const out: LeagueBoard[] = [];

  for (const league of LEAGUES) {
    const season = await getCurrentSeason(league.leagueId);
    if (!season) {
      out.push({
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        error: "Could not resolve season.",
        teams: [],
      });
      continue;
    }

    const teams = await getTeamsForLeague(league.leagueId, season);
    if (!teams || teams.length === 0) {
      out.push({
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        seasonUsed: season,
        error: "Could not load teams.",
        teams: [],
      });
      continue;
    }

    // 1) One league fixtures call (season-aligned), but with retries
    const leagueFinished = await getLeagueFinishedFixtures(league.leagueId, season);

    // 2) For each team: use league list, but if empty -> per-team fallback
    const perTeamFixtures = await Promise.all(
      teams.map(async (t) => {
        const fromLeague = leagueFinished
          .filter((fx) => fx.teams.home.id === t.teamId || fx.teams.away.id === t.teamId)
          .slice(0, 7);

        if (fromLeague.length > 0) return { team: t, fixtures: fromLeague };

        // Fallback ONLY when league list failed to include them (prevents random blank teams)
        const fallback = await getTeamFinishedFixtures(t.teamId, season);
        return { team: t, fixtures: fallback };
      })
    );

    // 3) Dedup fixture IDs we actually need stats for
    const fixtureIdsSet = new Set<number>();
    for (const tf of perTeamFixtures) {
      for (const fx of tf.fixtures) fixtureIdsSet.add(fx.fixture.id);
    }
    const fixtureIds = [...fixtureIdsSet];

    const fixtureData = new Map<number, { cornersTotal: number | null; cardsTotal: number | null }>();

    await Promise.all(
      fixtureIds.map((fixtureId) =>
        fxLimiter(async () => {
          await sleep(120);

          const cornersTotal = await retryNullable(() => getCornersTotal(fixtureId), 3, 650);
          const cardsTotal = await retryNullable(() => getCardsTotal(fixtureId), 3, 650);

          fixtureData.set(fixtureId, { cornersTotal, cardsTotal });
        })
      )
    );

    // 4) Map into TeamBoard matches (always 7 slots)
    const filledTeams: TeamBoard[] = perTeamFixtures.map(({ team, fixtures }) => {
      const real: MatchCard[] = fixtures.map((fx) => {
        const fixtureId = fx.fixture.id;
        const date = fx.fixture.date;

        const isHome = team.teamId === fx.teams.home.id;
        const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;

        const homeGoals = fx.goals.home ?? 0;
        const awayGoals = fx.goals.away ?? 0;

        const d = fixtureData.get(fixtureId) ?? { cornersTotal: null, cardsTotal: null };

        return {
          fixtureId,
          date,
          opponent,
          isHome,
          goalsTotal: homeGoals + awayGoals,
          cornersTotal: d.cornersTotal,
          cardsTotal: d.cardsTotal,
        };
      });

      const matches = real.slice(0, 7);
      while (matches.length < 7) matches.push(blankMatch());

      return { ...team, matches };
    });

    out.push({
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      seasonUsed: season,
      teams: filledTeams,
      error:
        leagueFinished.length === 0
          ? "League fixtures came back empty (API throttling). Using team fallback where possible."
          : undefined,
    });

    await sleep(400);
  }

  return out;
}
