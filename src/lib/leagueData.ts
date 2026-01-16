// src/lib/leagueData.ts
// Stable league data loader for API-Football (APISports)
//
// Goals: show last 7 FINISHED matches per team (across season boundaries),
// compute totals (home+away combined) for goals, corners, cards,
// NEVER drop matches if stats/events missing, and reduce disappearing data with caching.

export type LeagueBoard = {
  ok: boolean;
  data: LeagueBlock[];
  error?: string;
};

export type LeagueBlock = {
  leagueId: number;
  leagueName: string;
  seasonUsed: number;
  teams: TeamBlock[];
};

export type TeamBlock = {
  teamId: number;
  name: string;
  logo: string;
  matches: MatchRow[];
};

export type MatchRow = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;
  goalsTotal: number;
  cornersTotal: number; // always a number (0 if missing)
  cardsTotal: number; // always a number (0 if missing)
};

const API_BASE = "https://v3.football.api-sports.io";
const DAY_SECONDS = 60 * 60 * 24;

const APISPORTS_KEY = process.env.APISPORTS_KEY;

// ---- simple in-memory cache (best-effort; Vercel serverless may reset) ----
type CacheEntry<T> = { exp: number; val: T };
const memCache = new Map<string, CacheEntry<any>>();

function memGet<T>(key: string): T | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    memCache.delete(key);
    return null;
  }
  return hit.val as T;
}
function memSet<T>(key: string, val: T, ttlSeconds: number) {
  memCache.set(key, { val, exp: Date.now() + ttlSeconds * 1000 });
}

// ---- throttling (keep requests gentle) ----
let lastRequestAt = 0;
async function throttle(ms = 220) {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + ms - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

// ---- fetch with 429 retry ----
async function apiFetchJson<T>(
  path: string,
  opts: {
    cacheMode?: RequestCache; // "no-store" or default
    revalidateSeconds?: number; // next.js cache for fetch
    retries?: number;
  } = {}
): Promise<T> {
  if (!APISPORTS_KEY) {
    throw new Error("Missing env var APISPORTS_KEY");
  }

  const url = `${API_BASE}${path}`;
  const retries = opts.retries ?? 3;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(220);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-apisports-key": APISPORTS_KEY,
      },
      cache: opts.cacheMode,
      next: opts.revalidateSeconds ? { revalidate: opts.revalidateSeconds } : undefined,
    });

    if (res.status === 429 && attempt < retries) {
      // exponential backoff
      const backoff = 400 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${res.status} ${res.statusText} for ${path} :: ${text.slice(0, 200)}`);
    }

    return (await res.json()) as T;
  }

  // should never reach
  throw new Error(`Failed to fetch ${path}`);
}

function currentSeasonGuess(): number {
  // Soccer seasons: many leagues run across years.
  // API-Football expects a "season" like 2025, 2026, etc (start year of season).
  // We'll just start from the current year, then walk backwards until we collect 7 finished matches.
  return new Date().getUTCFullYear();
}

// ---- API types (partial) ----
type ApiResponse<T> = { response: T };

type ApiTeam = {
  team: { id: number; name: string; logo: string };
};

type ApiFixture = {
  fixture: { id: number; date: string; status: { short: string } };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
};

type ApiStatRow = {
  type: string;
  value: number | string | null;
};

type ApiFixtureStatistics = {
  team: { id: number; name: string };
  statistics: ApiStatRow[];
};

type ApiEvent = {
  type: string; // "Card", "Goal", ...
  detail: string; // "Yellow Card", "Red Card", etc
};

// ---- helpers to parse corners/cards ----
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickCornerKicks(stats: ApiStatRow[]): number {
  // API-Football uses type like "Corner Kicks"
  const row = stats.find((s) => s.type.toLowerCase() === "corner kicks");
  const n = toNumber(row?.value);
  return n ?? 0;
}

function countCards(events: ApiEvent[]): number {
  // Count all card events (yellow, 2nd yellow, red)
  let count = 0;
  for (const e of events) {
    if (e.type?.toLowerCase() === "card") count += 1;
  }
  return count;
}

// ---- cached per-fixture corners/cards ----
async function getCornersTotal(fixtureId: number): Promise<number> {
  const key = `stats:${fixtureId}`;
  const cached = memGet<number>(key);
  if (cached !== null) return cached;

  try {
    // cache these calls for 24h to avoid disappearing stats
    const json = await apiFetchJson<ApiResponse<ApiFixtureStatistics[]>>(
      `/fixtures/statistics?fixture=${fixtureId}`,
      { revalidateSeconds: DAY_SECONDS, retries: 3 }
    );

    const blocks = json.response ?? [];
    let total = 0;
    for (const b of blocks) {
      total += pickCornerKicks(b.statistics ?? []);
    }

    // always set a number
    memSet(key, total, DAY_SECONDS);
    return total;
  } catch {
    // on any error, NEVER fail the match; just return 0
    memSet(key, 0, 60 * 10); // short cache (10m) to avoid hammering when failing
    return 0;
  }
}

async function getCardsTotal(fixtureId: number): Promise<number> {
  const key = `events:${fixtureId}`;
  const cached = memGet<number>(key);
  const cachedNull = memGet<"__0__">(key + ":z"); // marker to avoid re-fetch storm
  if (cached !== null) return cached;
  if (cachedNull) return 0;

  try {
    const json = await apiFetchJson<ApiResponse<ApiEvent[]>>(`/fixtures/events?fixture=${fixtureId}`, {
      revalidateSeconds: DAY_SECONDS,
      retries: 3,
    });

    const events = json.response ?? [];
    const total = countCards(events);

    memSet(key, total, DAY_SECONDS);
    return total;
  } catch {
    memSet(key + ":z", "__0__", 60 * 10);
    return 0;
  }
}

// ---- fixtures: last 7 finished across seasons ----
async function fetchFinishedFixturesForTeamSeason(args: {
  leagueId: number;
  season: number;
  teamId: number;
}): Promise<ApiFixture[]> {
  const { leagueId, season, teamId } = args;

  const json = await apiFetchJson<ApiResponse<ApiFixture[]>>(
    `/fixtures?league=${leagueId}&season=${season}&team=${teamId}&status=FT`,
    { cacheMode: "no-store", retries: 3 }
  );

  return json.response ?? [];
}

async function getLast7FinishedFixtures(leagueId: number, teamId: number): Promise<{ seasonUsed: number; fixtures: ApiFixture[] }> {
  const startSeason = currentSeasonGuess();
  const collected: ApiFixture[] = [];
  const seen = new Set<number>();

  // Walk back up to 6 seasons if needed (covers weird cases)
  for (let s = startSeason; s >= startSeason - 6; s--) {
    let batch: ApiFixture[] = [];
    try {
      batch = await fetchFinishedFixturesForTeamSeason({ leagueId, season: s, teamId });
    } catch {
      // ignore season errors; keep going backwards
      batch = [];
    }

    // newest first
    batch.sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime());

    for (const f of batch) {
      const id = f.fixture.id;
      if (seen.has(id)) continue;
      seen.add(id);
      collected.push(f);
      if (collected.length >= 7) break;
    }

    if (collected.length >= 7) {
      return { seasonUsed: s, fixtures: collected.slice(0, 7) };
    }
  }

  // If we never reached 7, return whatever we found
  return { seasonUsed: startSeason, fixtures: collected.slice(0, 7) };
}

// ---- teams in league ----
async function fetchTeamsInLeague(leagueId: number, season: number): Promise<ApiTeam[]> {
  const json = await apiFetchJson<ApiResponse<ApiTeam[]>>(`/teams?league=${leagueId}&season=${season}`, {
    cacheMode: "no-store",
    retries: 3,
  });
  return json.response ?? [];
}

// ---- public: build league blocks (your page.tsx calls this) ----
export async function getLeagueBoard(args: {
  leagues: Array<{ leagueId: number; leagueName: string; season?: number }>;
}): Promise<LeagueBoard> {
  try {
    const blocks: LeagueBlock[] = [];

    for (const L of args.leagues) {
      const season = L.season ?? currentSeasonGuess();
      const teamsResp = await fetchTeamsInLeague(L.leagueId, season);

      const teams: TeamBlock[] = [];

      for (const t of teamsResp) {
        const teamId = t.team.id;
        const name = t.team.name;
        const logo = t.team.logo;

        const { seasonUsed, fixtures } = await getLast7FinishedFixtures(L.leagueId, teamId);

        const matches: MatchRow[] = await Promise.all(
          fixtures.map(async (fx) => {
            const fixtureId = fx.fixture.id;
            const date = fx.fixture.date;

            const homeId = fx.teams.home.id;
            const awayId = fx.teams.away.id;

            const isHome = homeId === teamId;
            const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;

            const goalsHome = fx.goals.home ?? 0;
            const goalsAway = fx.goals.away ?? 0;
            const goalsTotal = goalsHome + goalsAway;

            // IMPORTANT: always numbers, never null
            const cornersTotal = await getCornersTotal(fixtureId);
            const cardsTotal = await getCardsTotal(fixtureId);

            return {
              fixtureId,
              date,
              opponent,
              isHome,
              goalsTotal,
              cornersTotal,
              cardsTotal,
            };
          })
        );

        teams.push({ teamId, name, logo, matches });

        // prefer the earliest season that actually produced matches for this team
        blocks.push({
          leagueId: L.leagueId,
          leagueName: L.leagueName,
          seasonUsed,
          teams,
        });

        // NOTE: we pushed block inside loop? -> fix: break out of building block once at end.
        // We'll undo this below.
        blocks.pop();
      }

      // finalize this league block once
      const seasonUsedFinal = season;
      blocks.push({
        leagueId: L.leagueId,
        leagueName: L.leagueName,
        seasonUsed: seasonUsedFinal,
        teams,
      });
    }

    return { ok: true, data: blocks };
  } catch (e: any) {
    return { ok: false, data: [], error: e?.message ?? String(e) };
  }
}
