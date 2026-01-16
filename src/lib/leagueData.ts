import { apiGet, type ApiResult } from "./apifootball";
import { LEAGUES, type LeagueConfig } from "./leagues";

/* ---------------- API TYPES ---------------- */

type ApiLeagueResp = {
  response: {
    seasons: { year: number; current: boolean }[];
  }[];
};

type ApiTeamsResp = {
  response: {
    team: { id: number; name: string; logo: string };
  }[];
};

type ApiFixturesResp = {
  response: {
    fixture: { id: number; date: string };
    teams: {
      home: { id: number; name: string };
      away: { id: number; name: string };
    };
    goals: { home: number | null; away: number | null };
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
  corners: number;
  cards: number;
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
  // Works even if TS refuses to narrow unions
  return (r && typeof r === "object" && "error" in r ? (r as any).error : "API error") as string;
}

function getStat(
  stats: ApiFixturesResp["response"][0]["statistics"] | undefined,
  teamId: number,
  name: string
): number {
  if (!stats) return 0;
  const t = stats.find((s) => s.team.id === teamId);
  if (!t) return 0;
  const s = t.statistics.find((x) => x.type === name);
  return typeof s?.value === "number" ? s.value : 0;
}

/* ---------------- API LOGIC ---------------- */

async function getCurrentSeason(leagueId: number): Promise<ApiResult<number>> {
  const r = await apiGet<ApiLeagueResp>("/leagues", { id: leagueId }, { noStore: true });

  if (!r.ok) {
    return { ok: false, error: pickError(r) };
  }

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

async function getFixtures(teamId: number): Promise<ApiResult<ApiFixturesResp>> {
  // Includes cups because we do NOT filter by league
  return apiGet<ApiFixturesResp>("/fixtures", { team: teamId, last: 7, status: "FT" }, { noStore: true });
}

/* ---------------- BUILD MATCHES ---------------- */

function buildMatches(teamId: number, fx: ApiFixturesResp): MatchRow[] {
  return (fx.response ?? []).map((f) => {
    const isHome = f.teams.home.id === teamId;
    const opponent = isHome ? f.teams.away.name : f.teams.home.name;

    const goalsFor = isHome ? f.goals.home ?? 0 : f.goals.away ?? 0;
    const goalsAgainst = isHome ? f.goals.away ?? 0 : f.goals.home ?? 0;

    const corners = getStat(f.statistics, teamId, "Corner Kicks");
    const yellow = getStat(f.statistics, teamId, "Yellow Cards");
    const red = getStat(f.statistics, teamId, "Red Cards");

    return {
      fixtureId: f.fixture.id,
      date: f.fixture.date,
      opponent,
      isHome,
      goalsFor,
      goalsAgainst,
      corners,
      cards: yellow + red,
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
  const rows: TeamRow[] = [];

  // Simple + reliable (no TS tricks). If you hit 429 later we can add concurrency limits.
  for (const t of teams) {
    const fx = await getFixtures(t.team.id);
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
