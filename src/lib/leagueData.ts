// src/lib/leagueData.ts
// STABLE "ALWAYS LAST 7" VERSION (works across season boundaries)
//
// Fixes the random missing-team blanks by:
// - cache: "no-store" (no Vercel/Next partial caching)
// - Fetching fixtures for BOTH current season + previous season, merging and sorting
// - Per-team fallback WITHOUT season (team + last=60), so it still works if season/year is weird
// - Never dropping matches if corners/cards fail
//
// Output fields used by UI:
// goalsTotal / cornersTotal / cardsTotal

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

function sortByDateDesc<T extends { fixture: { date: string } }>(arr: T[]): T[] {
  return arr
    .slice()
    .sort((a, b) => (a.fixture.date < b.fixture.date ? 1 : a.fixture.date > b.fixture.date ? -1 : 0));
}

// ---------------- API fetch (NO CACHE) + retry ----------------
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

// Fetch finished fixtures for BOTH current + previous season, merge, sort.
async function getLeagueFinishedFixturesAcrossSeasons(leagueId: number, season: number) {
  const seasonsToTry = [season, season - 1];

  const all: ApiFixturesResp["response"] = [];

  for (const s of seasonsToTry) {
    const r = await apiFetch<ApiFixturesResp>("/fixtures", {
      league: leagueId,
      season: s,
      last: 1000,
    });
    if (!r.ok) continue;

    const finished = (r.data.response ?? []).filter((fx) => FINISHED.has(fx.fixture.status?.short));
    all.push(...finished);
  }

  // Dedup by fixtureId
  const byId = new Map<number, ApiFixturesResp["response"][number]>();
  for (const fx of all) byId.set(fx.fixture.id, fx);

  return sortByDateDesc(Array.from(byId.values()));
}

// Per-team fallback WITHOUT season (prevents season boundary blanks)
async function getTeamFinishedFixturesNoSeason(teamId: number) {
  const r = await apiFetch<ApiFixturesResp>("/fixtures", { team: teamId, last: 60 });
  if (!r.ok) return [];

  const finished = (r.data.response ?? []).filter((fx) => FINISHED.has(fx.fixture.status?.short));
  return finished.slice(0, 7);
}

async function getCornersTotal(fixtureId: number): Promise<number | null> {
  const r = await apiFetch<ApiFixtureStatsResp>("/fixtures/statistics", { fixture: fixtureId });
  if (!r.ok) return null;

  const rows = r.data.response ?? [];
  if (!rows.length) return null;

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

    // One league list across current+previous season (prevents season-boundary blanks)
    const leagueFinished = await getLeagueFinishedFixturesAcrossSeasons(league.leagueId, season);

    // For each team: pick last 7 from league list; if none -> fallback no-season
    const perTeamFixtures = await Promise.all(
      teams.map(async (t) => {
        const fromLeague = leagueFinished
          .filter((fx) => fx.teams.home.id === t.teamId || fx.teams.away.id === t.teamId)
          .slice(0, 7);

        if (fromLeague.length > 0) return { team: t, fixtures: fromLeague };

        const fallback = await getTeamFinishedFixturesNoSeason(t.teamId);
        return { team: t, fixtures: fallback };
      })
    );

    // Dedup fixture IDs for stats/events
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
          ? "League fixtures returned empty; using team fallback where possible."
          : undefined,
    });

    await sleep(300);
  }

  return out;
}
