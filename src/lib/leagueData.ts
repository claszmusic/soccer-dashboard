// src/lib/leagueData.ts
// Self-contained data layer with caching + throttling + 429 retry.
// Goal: reliably fill ALL teams with last 7 finished matches including totals for Goals/Corners/Cards.

export type MatchCard = {
  fixtureId: number;
  date: string; // ISO
  opponent: string;
  isHome: boolean;

  // Totals (home + away combined)
  goalsTotal: number | null;
  cornersTotal: number | null;
  cardsTotal: number | null;
};

export type TeamBoard = {
  teamId: number;
  name: string;
  logo: string;
  matches: MatchCard[]; // length <= 7
};

export type LeagueBoard = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  error?: string;
  teams: TeamBoard[];
};

// Put your leagues here (IDs are API-Football league IDs)
const LEAGUES: Array<{ leagueId: number; leagueName: string }> = [
  { leagueId: 262, leagueName: "Liga MX" },
  { leagueId: 39, leagueName: "Premier League" },
  { leagueId: 78, leagueName: "Bundesliga" },
  { leagueId: 140, leagueName: "La Liga" },
  { leagueId: 135, leagueName: "Serie A" },
];

// API-Football base
const API_BASE = "https://v3.football.api-sports.io";

// ---------- tiny utils ----------
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

// Simple concurrency limiter (no dependency)
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

// ---------- caching (in-memory per server instance) ----------
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

// ---------- API fetch with retry/backoff ----------
async function apiFetch<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  opts?: { cacheKey?: string; ttlMs?: number }
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const key = opts?.cacheKey;
  const ttlMs = opts?.ttlMs ?? 5 * 60_000;

  if (key) {
    const cached = cacheGet<{ ok: true; data: T } | { ok: false; error: string; status?: number }>(key);
    if (cached) return cached;
  }

  const apiKey = process.env.APISPORTS_KEY || process.env.APISPORTS_API_KEY || process.env.APISPORTSKEY;
  if (!apiKey) {
    const res = { ok: false as const, error: "Missing APISPORTS_KEY env var" };
    if (key) cacheSet(key, res, ttlMs);
    return res;
  }

  const url = `${API_BASE}${path}${toQS(params)}`;

  // Retry logic: handles 429 + 5xx + network errors
  const maxAttempts = 5;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const r = await fetch(url, {
        headers: {
          "x-apisports-key": apiKey,
        },
        // Important on Vercel: avoid “no-store” for everything; we already cache in-memory.
        // Also allows Next to dedupe identical requests during a single render.
        cache: "force-cache",
      });

      if (r.status === 429) {
        // Backoff: 0.6s, 1.2s, 2.4s, 4.8s...
        const wait = Math.min(8000, 600 * Math.pow(2, attempt - 1));
        await sleep(wait);
        continue;
      }

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        const res = {
          ok: false as const,
          error: `API error ${r.status}: ${text || r.statusText}`,
          status: r.status,
        };
        if (key) cacheSet(key, res, ttlMs);
        return res;
      }

      const json = (await r.json()) as T;
      const res = { ok: true as const, data: json };
      if (key) cacheSet(key, res, ttlMs);
      return res;
    } catch (e: any) {
      // network error → retry
      const wait = Math.min(8000, 400 * Math.pow(2, attempt - 1));
      await sleep(wait);
      if (attempt >= maxAttempts) {
        const res = { ok: false as const, error: `Network error: ${e?.message ?? String(e)}` };
        if (key) cacheSet(key, res, ttlMs);
        return res;
      }
    }
  }

  const res = { ok: false as const, error: "Unknown error" };
  if (key) cacheSet(key, res, ttlMs);
  return res;
}

// ---------- API response types (minimal) ----------
type ApiLeaguesResp = {
  response: Array<{
    league: { id: number; name: string };
    seasons: Array<{ year: number; current: boolean }>;
  }>;
};

type ApiTeamsResp = {
  response: Array<{
    team: { id: number; name: string; logo: string };
  }>;
};

type ApiFixturesResp = {
  response: Array<{
    fixture: { id: number; date: string; status: { short: string } };
    teams: {
      home: { id: number; name: string };
      away: { id: number; name: string };
    };
    goals: { home: number | null; away: number | null };
  }>;
};

type ApiFixtureStatsResp = {
  response: Array<{
    team: { id: number; name: string };
    statistics: Array<{ type: string; value: number | string | null }>;
  }>;
};

// ---------- extract totals ----------
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

function pickStat(stats: Array<{ type: string; value: number | string | null }>, wanted: string) {
  const hit = stats.find((s) => s.type === wanted);
  return statNumber(hit?.value ?? null);
}

function fixtureTotalsFromStats(resp: ApiFixtureStatsResp): { cornersTotal: number | null; cardsTotal: number | null } {
  const rows = resp.response ?? [];
  if (rows.length < 1) return { cornersTotal: null, cardsTotal: null };

  // Corners can appear as "Corner Kicks"
  // Cards can appear as "Yellow Cards" and "Red Cards"
  let cornersTotal: number | null = null;
  let cardsTotal: number | null = null;

  const teamTotals = rows.map((row) => {
    const corners = pickStat(row.statistics, "Corner Kicks");
    const yellows = pickStat(row.statistics, "Yellow Cards");
    const reds = pickStat(row.statistics, "Red Cards");
    const cards = sumOrNull(yellows, reds);
    return { corners, cards };
  });

  cornersTotal = sumOrNull(teamTotals[0]?.corners ?? null, teamTotals[1]?.corners ?? null);
  cardsTotal = sumOrNull(teamTotals[0]?.cards ?? null, teamTotals[1]?.cards ?? null);

  return { cornersTotal, cardsTotal };
}

// ---------- main helpers ----------
async function getCurrentSeason(leagueId: number): Promise<number | null> {
  const r = await apiFetch<ApiLeaguesResp>(
    "/leagues",
    { id: leagueId },
    { cacheKey: `leagues:${leagueId}`, ttlMs: 12 * 60 * 60_000 } // 12h
  );
  if (!r.ok) return null;

  const seasons = r.data.response?.[0]?.seasons ?? [];
  const current = seasons.find((s) => s.current)?.year ?? seasons[0]?.year ?? null;
  return current ?? null;
}

async function getTeamsForLeague(leagueId: number, season: number): Promise<TeamBoard[] | null> {
  const r = await apiFetch<ApiTeamsResp>(
    "/teams",
    { league: leagueId, season },
    { cacheKey: `teams:${leagueId}:${season}`, ttlMs: 12 * 60 * 60_000 } // 12h
  );
  if (!r.ok) return null;

  return (r.data.response ?? []).map((x) => ({
    teamId: x.team.id,
    name: x.team.name,
    logo: x.team.logo,
    matches: [],
  }));
}

// Last 7 finished games for a team (across competitions)
async function getLastFinishedFixtures(teamId: number): Promise<ApiFixturesResp["response"]> {
  const r = await apiFetch<ApiFixturesResp>(
    "/fixtures",
    {
      team: teamId,
      last: 7,
      status: "FT",
    },
    { cacheKey: `fixtures:last7:team:${teamId}`, ttlMs: 10 * 60_000 } // 10m
  );
  if (!r.ok) return [];
  return r.data.response ?? [];
}

// Fixture stats (cached per fixture so both teams reuse it)
async function getFixtureTotals(fixtureId: number): Promise<{ cornersTotal: number | null; cardsTotal: number | null }> {
  const r = await apiFetch<ApiFixtureStatsResp>(
    "/fixtures/statistics",
    { fixture: fixtureId },
    { cacheKey: `fxstats:${fixtureId}`, ttlMs: 6 * 60 * 60_000 } // 6h
  );
  if (!r.ok) return { cornersTotal: null, cardsTotal: null };

  return fixtureTotalsFromStats(r.data);
}

// ---------- exported API ----------
export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  // VERY IMPORTANT: throttle so we don’t trigger rateLimit
  // We do:
  // - Teams processing with low concurrency
  // - Fixture stats calls cached across teams
  const teamLimiter = createLimiter(2); // keep low to avoid 429
  const statLimiter = createLimiter(3); // stats are heavy; keep low

  const out: LeagueBoard[] = [];

  for (const league of LEAGUES) {
    const season = await getCurrentSeason(league.leagueId);

    if (!season) {
      out.push({
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        error: "Could not resolve current season for this league.",
        teams: [],
      });
      continue;
    }

    const teams = await getTeamsForLeague(league.leagueId, season);
    if (!teams) {
      out.push({
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        seasonUsed: season,
        error: "Could not load teams for this league.",
        teams: [],
      });
      continue;
    }

    // Fill matches for each team (throttled)
    const filledTeams = await Promise.all(
      teams.map((t) =>
        teamLimiter(async () => {
          const fixtures = await getLastFinishedFixtures(t.teamId);

          const matchesBase: MatchCard[] = fixtures.map((fx) => {
            const fixtureId = fx.fixture.id;
            const date = fx.fixture.date;

            const homeId = fx.teams.home.id;
            const awayId = fx.teams.away.id;

            const isHome = t.teamId === homeId;
            const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;

            const goalsTotal =
              (fx.goals.home ?? 0) + (fx.goals.away ?? 0);

            return {
              fixtureId,
              date,
              opponent,
              isHome,
              goalsTotal,
              cornersTotal: null,
              cardsTotal: null,
            };
          });

          // Fetch stats for each fixture (throttled + cached)
          const matches = await Promise.all(
            matchesBase.map((m) =>
              statLimiter(async () => {
                // Tiny spacing also helps avoid burst limits
                await sleep(120);

                const totals = await getFixtureTotals(m.fixtureId);
                return {
                  ...m,
                  cornersTotal: totals.cornersTotal,
                  cardsTotal: totals.cardsTotal,
                };
              })
            )
          );

          return { ...t, matches };
        })
      )
    );

    out.push({
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      seasonUsed: season,
      teams: filledTeams,
    });

    // Small pause between leagues to avoid spikes
    await sleep(400);
  }

  return out;
}
