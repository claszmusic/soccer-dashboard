import { apiGet, type ApiResult } from "./apifootball";
import { LEAGUES, type LeagueConfig } from "./leagues";

/* ---------------- API TYPES ---------------- */

type ApiLeagueResp = {
  response: { seasons: { year: number; current: boolean }[] }[];
};

type ApiTeamsResp = {
  response: { team: { id: number; name: string; logo: string } }[];
};

type ApiFixturesResp = {
  response: {
    fixture: { id: number; date: string; status: { short: string } };
    teams: {
      home: { id: number; name: string };
      away: { id: number; name: string };
    };
    goals: { home: number | null; away: number | null };
  }[];
};

// NOTE: stats come from a different endpoint
type ApiFixtureStatsResp = {
  response: {
    team: { id: number };
    statistics: { type: string; value: number | string | null }[];
  }[];
};

/* ---------------- OUTPUT TYPES ---------------- */

export type MatchRow = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  corners: number | null; // null means "not available"
  cards: number | null;   // null means "not available"
};

export type TeamRow = {
  teamId: number;
  name: string;
  logo: string;
  matches: MatchRow[];
};

export type LeagueBoardData = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  teams: TeamRow[];
  error?: string;
};

/* ---------------- HELPERS ---------------- */

function pickError(r: ApiResult<any>): string {
  return (r && typeof r === "object" && "error" in r ? (r as any).error : "API error") as string;
}

function isFinishedShort(short: string | undefined) {
  // These are "finished" results you still want counted
  return short === "FT" || short === "AET" || short === "PEN";
}

function statToNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : 0;
}

function getStatValue(stats: ApiFixtureStatsResp["response"], teamId: number, type: string): number {
  const teamBlock = stats.find((x) => x.team.id === teamId);
  if (!teamBlock) return 0;
  const s = teamBlock.statistics.find((x) => x.type === type);
  return statToNumber(s?.value);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return results;
}

/* ---------------- API CALLS ---------------- */

async function getCurrentSeason(leagueId: number): Promise<ApiResult<number>> {
  const r = await apiGet<ApiLeagueResp>("/leagues", { id: leagueId }, { noStore: true });
  if (!r.ok) return { ok: false, error: pickError(r) };

  const seasons = r.data.response?.[0]?.seasons ?? [];
  const current = seasons.find((s) => s.current)?.year;
  const fallback = seasons.map((s) => s.year).sort((a, b) => b - a)[0];
  const year = current ?? fallback;

  if (!year) return { ok: false, error: `No seasons found for league ${leagueId}` };
  return { ok: true, data: year };
}

async function getTeams(leagueId: number, season: number): Promise<ApiResult<ApiTeamsResp>> {
  return apiGet<ApiTeamsResp>("/teams", { league: leagueId, season }, { noStore: true });
}

async function getRecentFixtures(teamId: number): Promise<ApiResult<ApiFixturesResp>> {
  // IMPORTANT: pull more than 7, then filter "finished" (FT/AET/PEN), then take last 7
  // This prevents "missing teams" when last=7 includes non-finished fixtures.
  return apiGet<ApiFixturesResp>("/fixtures", { team: teamId, last: 15 }, { noStore: true });
}

// Cache stats per fixture (many teams share fixtures)
const statsCache = new Map<number, Promise<ApiResult<ApiFixtureStatsResp>>>();

async function getFixtureStats(fixtureId: number): Promise<ApiResult<ApiFixtureStatsResp>> {
  if (!statsCache.has(fixtureId)) {
    statsCache.set(
      fixtureId,
      apiGet<ApiFixtureStatsResp>("/fixtures/statistics", { fixture: fixtureId }, { noStore: true })
    );
  }
  return statsCache.get(fixtureId)!;
}

/* ---------------- BUILD MATCHES ---------------- */

async function buildMatchesForTeam(teamId: number, fxRes: ApiFixturesResp): Promise<MatchRow[]> {
  const all = fxRes.response ?? [];
  const finished = all
    .filter((f) => isFinishedShort(f.fixture?.status?.short))
    // newest first is typical; we still slice safely
    .slice(0, 7);

  // Fetch stats for these fixtures with low concurrency (avoid 429)
  const statsByFixture = await mapLimit(finished, 2, async (f) => {
    const s = await getFixtureStats(f.fixture.id);
    return { fixtureId: f.fixture.id, stats: s };
  });

  const statsMap = new Map<number, ApiResult<ApiFixtureStatsResp>>();
  for (const x of statsByFixture) statsMap.set(x.fixtureId, x.stats);

  return finished.map((f) => {
    const isHome = f.teams.home.id === teamId;
    const opponent = isHome ? f.teams.away.name : f.teams.home.name;

    const goalsFor = isHome ? f.goals.home ?? 0 : f.goals.away ?? 0;
    const goalsAgainst = isHome ? f.goals.away ?? 0 : f.goals.home ?? 0;

    const statsRes = statsMap.get(f.fixture.id);
    let corners: number | null = null;
    let cards: number | null = null;

    if (statsRes?.ok) {
      const cornersN = getStatValue(statsRes.data.response, teamId, "Corner Kicks");
      const yellow = getStatValue(statsRes.data.response, teamId, "Yellow Cards");
      const red = getStatValue(statsRes.data.response, teamId, "Red Cards");
      corners = Number.isFinite(cornersN) ? cornersN : null;
      cards = Number.isFinite(yellow + red) ? yellow + red : null;
    }

    return {
      fixtureId: f.fixture.id,
      date: f.fixture.date,
      opponent,
      isHome,
      goalsFor,
      goalsAgainst,
      corners,
      cards,
    };
  });
}

/* ---------------- MAIN EXPORT ---------------- */

export async function getLeagueBoards(): Promise<LeagueBoardData[]> {
  // Clear cache per request (prevents memory growth across serverless invocations)
  statsCache.clear();
  return Promise.all(LEAGUES.map(getLeagueBoard));
}

async function getLeagueBoard(league: LeagueConfig): Promise<LeagueBoardData> {
  const seasonRes = await getCurrentSeason(league.id);
  if (!seasonRes.ok) {
    return { leagueId: league.id, leagueName: league.name, teams: [], error: pickError(seasonRes) };
  }

  const teamsRes = await getTeams(league.id, seasonRes.data);
  if (!teamsRes.ok) {
    return {
      leagueId: league.id,
      leagueName: league.name,
      seasonUsed: seasonRes.data,
      teams: [],
      error: pickError(teamsRes),
    };
  }

  const teams = teamsRes.data.response ?? [];

  // Fetch team fixtures with a moderate concurrency limit
  const teamRows = await mapLimit(teams, 3, async (t) => {
    const fx = await getRecentFixtures(t.team.id);
    const matches = fx.ok ? await buildMatchesForTeam(t.team.id, fx.data) : [];

    return {
      teamId: t.team.id,
      name: t.team.name,
      logo: t.team.logo,
      matches,
    } satisfies TeamRow;
  });

  return {
    leagueId: league.id,
    leagueName: league.name,
    seasonUsed: seasonRes.data,
    teams: teamRows,
  };
}
