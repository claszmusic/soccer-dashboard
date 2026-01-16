// src/lib/leagueData.ts
// Reliable: last 7 finished matches per team, without "missing teams" due to request bursts.
// Strategy:
// 1) Fetch TEAMS once (needs season)
// 2) Fetch LEAGUE FIXTURES once (last N, finished) and reuse for every team
// 3) For each team, pick last 7 matches from that league fixtures list
// 4) Fetch corners + cards only for fixtures that appear in the last-7 lists (deduped)
// GoalsTotal = from /fixtures (home+away goals)
// CornersTotal = from /fixtures/statistics (sum of "Corner Kicks" across teams)
// CardsTotal = from /fixtures/events (count Yellow + Red across both teams)

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

// ---------------- cache (in-memory) ----------------
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<any>>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ---------------- API fetch w/ 429 retry ----------------
async function apiFetch<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  opts?: { cacheKey?: string; ttlMs?: number }
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const cacheKey = opts?.cacheKey;
  const ttlMs = opts?.ttlMs ?? 10 * 60_000;

  if (cacheKey) {
    const cached = cacheGet<any>(cacheKey);
    if (cached) return cached;
  }

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
        next: { revalidate: 600 },
      });

      if (r.status === 429) {
        const wait = Math.min(20000, 900 * Math.pow(2, attempt - 1));
        await sleep(wait);
        continue;
      }

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        const res = {
          ok: false as const,
          error: `API ${r.status}: ${txt || r.statusText}`,
          status: r.status,
        };
        // cache errors briefly so we don't get "stuck empty"
        if (cacheKey) cacheSet(cacheKey, res, 15_000);
        return res;
      }

      const json = (await r.json()) as T;
      const res = { ok: true as const, data: json };
      if (cacheKey) cacheSet(cacheKey, res, ttlMs);
      return res;
    } catch (e: any) {
      if (attempt === maxAttempts) {
        const res = { ok: false as const, error: `Network error: ${e?.message ?? String(e)}` };
        if (cacheKey) cacheSet(cacheKey, res, 15_000);
        return res;
      }
      await sleep(Math.min(12000, 600 * Math.pow(2, attempt - 1)));
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
    team: { id: number };
    statistics: Array<{ type: string; value: number | string | null }>;
  }>;
};

type ApiEventsResp = {
  response: Array<{
    type: string;
    detail: string;
  }>;
};

// ---------------- helpers ----------------
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

async function getCurrentSeason(leagueId: number): Promise<number | null> {
  const r = await apiFetch<ApiLeaguesResp>(
    "/leagues",
    { id: leagueId },
    { cacheKey: `leagues:${leagueId}`, ttlMs: 12 * 60 * 60_000 }
  );
  if (!r.ok) return null;

  const seasons = r.data.response?.[0]?.seasons ?? [];
  return seasons.find((s) => s.current)?.year ?? seasons[0]?.year ?? null;
}

async function getTeamsForLeague(leagueId: number, season: number): Promise<TeamBoard[] | null> {
  const r = await apiFetch<ApiTeamsResp>(
    "/teams",
    { league: leagueId, season },
    { cacheKey: `teams:${leagueId}:${season}`, ttlMs: 12 * 60 * 60_000 }
  );
  if (!r.ok) return null;

  return (r.data.response ?? []).map((x) => ({
    teamId: x.team.id,
    name: x.team.name,
    logo: x.team.logo,
    matches: [],
  }));
}

// ONE call per league. Pull a big recent window and filter to finished.
// This is what prevents "some teams missing" due to bursts.
async function getLeagueFinishedFixtures(leagueId: number) {
  // Big window so every team has enough matches even if some are postponed.
  // You can increase to 400 if you want.
  const r = await apiFetch<ApiFixturesResp>(
    "/fixtures",
    { league: leagueId, last: 300 },
    { cacheKey: `leaguefx:last300:${leagueId}`, ttlMs: 8 * 60_000 }
  );
  if (!r.ok) return [];

  const all = r.data.response ?? [];
  const finished = all.filter((fx) => FINISHED.has(fx.fixture.status?.short));
  return finished;
}

async function getCornersTotal(fixtureId: number): Promise<number | null> {
  const r = await apiFetch<ApiFixtureStatsResp>(
    "/fixtures/statistics",
    { fixture: fixtureId },
    { cacheKey: `fxstats:${fixtureId}`, ttlMs: 6 * 60 * 60_000 }
  );
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
  const r = await apiFetch<ApiEventsResp>(
    "/fixtures/events",
    { fixture: fixtureId },
    { cacheKey: `fxevents:${fixtureId}`, ttlMs: 6 * 60 * 60_000 }
  );
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
  // Keep these LOW. Your plan may be higher, but API still throttles bursts.
  const fxLimiter = createLimiter(1); // stats/events calls must be gentle

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

    // ONE fixtures call per league (this is the big fix)
    const leagueFinished = await getLeagueFinishedFixtures(league.leagueId);

    if (leagueFinished.length === 0) {
      out.push({
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        seasonUsed: season,
        error: "No finished fixtures returned (API throttling or league off-season).",
        teams: teams.map((t) => ({ ...t, matches: Array.from({ length: 7 }).map(blankMatch) })),
      });
      continue;
    }

    // For each team, pick last 7 fixtures from the league list
    const perTeamFixtures = teams.map((t) => {
      const fxs = leagueFinished.filter(
        (fx) => fx.teams.home.id === t.teamId || fx.teams.away.id === t.teamId
      );
      return { team: t, fixtures: fxs.slice(0, 7) };
    });

    // Only fetch corners/cards for fixtures we will actually display
    const fixtureIdsSet = new Set<number>();
    for (const tf of perTeamFixtures) {
      for (const fx of tf.fixtures) fixtureIdsSet.add(fx.fixture.id);
    }
    const fixtureIds = [...fixtureIdsSet];

    const fixtureData = new Map<number, { cornersTotal: number | null; cardsTotal: number | null }>();

    // Gentle, deterministic pacing to prevent 429 causing "missing teams"
    for (const fixtureId of fixtureIds) {
      await fxLimiter(async () => {
        await sleep(220);

        const cornersTotal = await retryNullable(() => getCornersTotal(fixtureId), 3, 700);
        const cardsTotal = await retryNullable(() => => getCardsTotal(fixtureId), 3, 700).catch(
          async () => retryNullable(() => getCardsTotal(fixtureId), 3, 700)
        );

        fixtureData.set(fixtureId, { cornersTotal, cardsTotal });
      });
    }

    const filledTeams: TeamBoard[] = perTeamFixtures.map(({ team, fixtures }) => {
      const matchesReal: MatchCard[] = fixtures.map((fx) => {
        const fixtureId = fx.fixture.id;
        const date = fx.fixture.date;

        const isHome = team.teamId === fx.teams.home.id;
        const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;

        const homeGoals = fx.goals.home ?? 0;
        const awayGoals = fx.goals.away ?? 0;
        const goalsTotal = homeGoals + awayGoals;

        const d = fixtureData.get(fixtureId) ?? { cornersTotal: null, cardsTotal: null };

        return {
          fixtureId,
          date,
          opponent,
          isHome,
          goalsTotal,
          cornersTotal: d.cornersTotal,
          cardsTotal: d.cardsTotal,
        };
      });

      const matches = matchesReal.slice(0, 7);
      while (matches.length < 7) matches.push(blankMatch());

      return { ...team, matches };
    });

    out.push({
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      seasonUsed: season,
      teams: filledTeams,
    });

    await sleep(800);
  }

  return out;
}
