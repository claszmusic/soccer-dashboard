// src/lib/leagueData.ts
// Reliable: last 7 finished matches per team.
// Goals = from /fixtures
// Corners = from /fixtures/statistics (Corner Kicks)
// Cards = from /fixtures/events (count Yellow + Red)
// Includes: caching + throttling + 429 retry + fixture de-dup (1 match fetched once, reused for both teams)

export type MatchCard = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;

  goalsTotal: number | null;   // home+away goals
  cornersTotal: number | null; // home+away corners
  cardsTotal: number | null;   // home+away (yellow+red)
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

// Concurrency limiter (no dependency)
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

  const apiKey = process.env.APISPORTS_KEY || process.env.APISPORTS_API_KEY || process.env.APISPORTSKEY;
  if (!apiKey) {
    const res = { ok: false as const, error: "Missing APISPORTS_KEY env var" };
    if (cacheKey) cacheSet(cacheKey, res, ttlMs);
    return res;
  }

  const url = `${API_BASE}${path}${toQS(params)}`;

  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "x-apisports-key": apiKey },
        cache: "force-cache",
      });

      if (r.status === 429) {
        // Backoff: 0.8s, 1.6s, 3.2s, 6.4s...
        const wait = Math.min(12000, 800 * Math.pow(2, attempt - 1));
        await sleep(wait);
        continue;
      }

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        const res = { ok: false as const, error: `API ${r.status}: ${txt || r.statusText}`, status: r.status };
        if (cacheKey) cacheSet(cacheKey, res, ttlMs);
        return res;
      }

      const json = (await r.json()) as T;
      const res = { ok: true as const, data: json };
      if (cacheKey) cacheSet(cacheKey, res, ttlMs);
      return res;
    } catch (e: any) {
      if (attempt === maxAttempts) {
        const res = { ok: false as const, error: `Network error: ${e?.message ?? String(e)}` };
        if (cacheKey) cacheSet(cacheKey, res, ttlMs);
        return res;
      }
      await sleep(Math.min(8000, 400 * Math.pow(2, attempt - 1)));
    }
  }

  const res = { ok: false as const, error: "Unknown error" };
  if (cacheKey) cacheSet(cacheKey, res, ttlMs);
  return res;
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
    type: string;   // "Card", "Goal", etc
    detail: string; // "Yellow Card", "Red Card", etc
  }>;
};

// ---------------- parse helpers ----------------
function statNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sumOrNull(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

// ---------------- core fetchers ----------------
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

// Get last 7 FINISHED fixtures for a team (across competitions)
async function getLastFinishedFixtures(teamId: number) {
  // IMPORTANT: include extra finished statuses too (some leagues use AET/PEN)
  const statuses = "FT,AET,PEN";
  const r = await apiFetch<ApiFixturesResp>(
    "/fixtures",
    { team: teamId, last: 7, status: statuses },
    { cacheKey: `fixtures:last7:${teamId}`, ttlMs: 10 * 60_000 }
  );
  if (!r.ok) return [];
  return r.data.response ?? [];
}

// Corners from statistics
async function getCornersTotal(fixtureId: number): Promise<number | null> {
  const r = await apiFetch<ApiFixtureStatsResp>(
    "/fixtures/statistics",
    { fixture: fixtureId },
    { cacheKey: `fxstats:${fixtureId}`, ttlMs: 6 * 60 * 60_000 }
  );
  if (!r.ok) return null;

  const rows = r.data.response ?? [];
  if (rows.length < 2) return null;

  const c0 = statNumber(rows[0].statistics.find((s) => s.type === "Corner Kicks")?.value ?? null);
  const c1 = statNumber(rows[1].statistics.find((s) => s.type === "Corner Kicks")?.value ?? null);
  return sumOrNull(c0, c1);
}

// Cards from events (more reliable)
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
    if (e.detail?.toLowerCase().includes("yellow")) yellow++;
    if (e.detail?.toLowerCase().includes("red")) red++;
  }

  return yellow + red;
}

// ---------------- exported ----------------
export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  // Throttle hard to avoid burst limits
  const teamLimiter = createLimiter(2);  // teams fetched slowly
  const fxLimiter = createLimiter(3);    // fixture detail (stats/events)
  const out: LeagueBoard[] = [];

  for (const league of LEAGUES) {
    const season = await getCurrentSeason(league.leagueId);
    if (!season) {
      out.push({ leagueId: league.leagueId, leagueName: league.leagueName, error: "Could not resolve season.", teams: [] });
      continue;
    }

    const teams = await getTeamsForLeague(league.leagueId, season);
    if (!teams) {
      out.push({ leagueId: league.leagueId, leagueName: league.leagueName, seasonUsed: season, error: "Could not load teams.", teams: [] });
      continue;
    }

    // 1) Fetch fixtures for all teams (throttled)
    const teamFixtures = await Promise.all(
      teams.map((t) =>
        teamLimiter(async () => {
          const fixtures = await getLastFinishedFixtures(t.teamId);
          return { team: t, fixtures };
        })
      )
    );

    // 2) Build a unique fixture list so we fetch corners/cards ONCE per match
    const fixtureMap = new Map<number, true>();
    for (const tf of teamFixtures) {
      for (const fx of tf.fixtures) fixtureMap.set(fx.fixture.id, true);
    }
    const fixtureIds = [...fixtureMap.keys()];

    // 3) Fetch fixture corners+cards (cached + throttled)
    //    Also do a retry pass for any null corners/cards.
    const fixtureData = new Map<number, { cornersTotal: number | null; cardsTotal: number | null }>();

    async function fetchFixtureOnce(fixtureId: number) {
      // small spacing helps avoid burst
      await sleep(120);
      const [cornersTotal, cardsTotal] = await Promise.all([
        fxLimiter(() => getCornersTotal(fixtureId)),
        fxLimiter(() => getCardsTotal(fixtureId)),
      ]);
      fixtureData.set(fixtureId, { cornersTotal, cardsTotal });
    }

    // First pass
    for (const id of fixtureIds) {
      await fetchFixtureOnce(id);
    }

    // Second pass: ONLY retry fixtures missing either value (common when API returns empty first try)
    const missing = fixtureIds.filter((id) => {
      const d = fixtureData.get(id);
      return !d || d.cornersTotal === null || d.cardsTotal === null;
    });

    if (missing.length) {
      // wait a bit before retrying
      await sleep(1500);
      for (const id of missing) {
        await fetchFixtureOnce(id);
      }
    }

    // 4) Map back into TeamBoard matches
    const filledTeams: TeamBoard[] = teamFixtures.map(({ team, fixtures }) => {
      const matches: MatchCard[] = fixtures.map((fx) => {
        const fixtureId = fx.fixture.id;
        const date = fx.fixture.date;

        const homeId = fx.teams.home.id;
        const isHome = team.teamId === homeId;
        const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;

        const goalsTotal = (fx.goals.home ?? 0) + (fx.goals.away ?? 0);

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

      return { ...team, matches };
    });

    out.push({
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      seasonUsed: season,
      teams: filledTeams,
    });

    // pause between leagues to avoid spikes
    await sleep(700);
  }

  return out;
}
