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

    // When get=statistics is used, API-Football includes this field:
    statistics?: {
      team: { id: number };
      statistics: { type: string; value: number | string | null }[];
    }[];
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
  corners: number | null; // null = not available
  cards: number | null;   // null = not available
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
  return short === "FT" || short === "AET" || short === "PEN";
}

function statToNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : 0;
}

function getStat(stats: ApiFixturesResp["response"][0]["statistics"] | undefined, teamId: number, type: string) {
  if (!stats) return null;
  const teamBlock = stats.find((x) => x.team.id === teamId);
  if (!teamBlock) return null;
  const s = teamBlock.statistics.find((x) => x.type === type);
  return s ? statToNumber(s.value) : null;
}

/* ---------------- API CALLS ---------------- */

// IMPORTANT: we will allow caching to reduce requests.
// apiGet() currently uses fetch cache based on opts.noStore.
// We'll call with noStore:false so Next can cache between requests.
const CACHE_OK = { noStore: false };

async function getCurrentSeason(leagueId: number): Promise<ApiResult<number>> {
  const r = await apiGet<ApiLeagueResp>("/leagues", { id: leagueId }, CACHE_OK);
  if (!r.ok) return { ok: false, error: pickError(r) };

  const seasons = r.data.response?.[0]?.seasons ?? [];
  const current = seasons.find((s) => s.current)?.year;
  const fallback = seasons.map((s) => s.year).sort((a, b) => b - a)[0];
  const year = current ?? fallback;

  if (!year) return { ok: false, error: `No seasons found for league ${leagueId}` };
  return { ok: true, data: year };
}

async function getTeams(leagueId: number, season: number): Promise<ApiResult<ApiTeamsResp>> {
  return apiGet<ApiTeamsResp>("/teams", { league: leagueId, season }, CACHE_OK);
}

async function getRecentFixturesWithStats(teamId: number): Promise<ApiResult<ApiFixturesResp>> {
  // KEY FIX: include statistics in the fixtures call (no per-fixture calls)
  // Pull more than 7 and then filter finished.
  return apiGet<ApiFixturesResp>(
    "/fixtures",
    { team: teamId, last: 15, get: "statistics" },
    CACHE_OK
  );
}

/* ---------------- BUILD MATCHES ---------------- */

function buildMatches(teamId: number, fx: ApiFixturesResp): MatchRow[] {
  const all = fx.response ?? [];
  const finished = all.filter((f) => isFinishedShort(f.fixture?.status?.short)).slice(0, 7);

  return finished.map((f) => {
    const isHome = f.teams.home.id === teamId;
    const opponent = isHome ? f.teams.away.name : f.teams.home.name;

    const goalsFor = isHome ? f.goals.home ?? 0 : f.goals.away ?? 0;
    const goalsAgainst = isHome ? f.goals.away ?? 0 : f.goals.home ?? 0;

    const corners = getStat(f.statistics, teamId, "Corner Kicks");
    const yellow = getStat(f.statistics, teamId, "Yellow Cards");
    const red = getStat(f.statistics, teamId, "Red Cards");
    const cards = yellow === null && red === null ? null : (yellow ?? 0) + (red ?? 0);

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

  // IMPORTANT: do NOT run all teams in parallel (rate limit).
  // Sequential is safest on free-tier.
  const rows: TeamRow[] = [];

  for (const t of teams) {
    const fx = await getRecentFixturesWithStats(t.team.id);
    const matches = fx.ok ? buildMatches(t.team.id, fx.data) : [];

    rows.push({
      teamId: t.team.id,
      name: t.team.name,
      logo: t.team.logo,
      matches,
    });
  }

  return {
    leagueId: league.id,
    leagueName: league.name,
    seasonUsed: seasonRes.data,
    teams: rows,
  };
}
