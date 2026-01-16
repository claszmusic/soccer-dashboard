// src/lib/leagueData.ts
import { apiGet } from "./apifootball";
import { LEAGUES, type LeagueConfig } from "./leagues";

type ApiLeagueResp = {
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
      home: { id: number; name: string; logo: string; winner?: boolean };
      away: { id: number; name: string; logo: string; winner?: boolean };
    };
    goals: { home: number | null; away: number | null };
    statistics?: Array<{
      team: { id: number; name: string };
      statistics: Array<{ type: string; value: number | string | null }>;
    }>;
  }>;
};

export type MatchRow = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;

  goalsFor: number;
  goalsAgainst: number;

  corners: number; // for the team
  cards: number;   // yellow+red for the team
};

export type TeamRow = {
  teamId: number;
  name: string;
  logo: string;
  matches: MatchRow[]; // last 7 finished (incl cups)
};

export type LeagueBoardData = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  teams: TeamRow[];
  error?: string; // <— IMPORTANT: show this on UI instead of “empty”
};

// small helper: parse stats from fixture.statistics if present
function getStatValue(
  statsBlock: ApiFixturesResp["response"][number]["statistics"] | undefined,
  teamId: number,
  type: string
): number {
  if (!statsBlock) return 0;
  const t = statsBlock.find((x) => x.team.id === teamId);
  if (!t) return 0;

  const s = t.statistics.find((x) => x.type.toLowerCase() === type.toLowerCase());
  if (!s) return 0;

  const v = s.value;
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;

  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : 0;
}

// Basic concurrency limiter (prevents 429 storms)
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function getCurrentSeason(leagueId: number): Promise<ApiResult<number>> {
  const r = await apiGet<ApiLeagueResp>("/leagues", { id: leagueId }, { noStore: true });
  if (!r.ok) return r;
  const seasons = r.data.response?.[0]?.seasons ?? [];
  const current = seasons.find((s) => s.current)?.year;
  const fallback = seasons.map((s) => s.year).sort((a, b) => b - a)[0];
  const year = current ?? fallback;
  if (!year) return { ok: false, error: `No seasons found for league ${leagueId}` };
  return { ok: true, data: year };
}

async function getTeamsForLeague(leagueId: number, season: number): Promise<ApiResult<ApiTeamsResp>> {
  return apiGet<ApiTeamsResp>("/teams", { league: leagueId, season }, { noStore: true });
}

async function getLastFinishedFixturesForTeam(teamId: number): Promise<ApiResult<ApiFixturesResp>> {
  // NOTE: No league filter => includes cups (what you asked)
  // status=FT usually works; if you want AET/PEN too, remove status filter.
  return apiGet<ApiFixturesResp>(
    "/fixtures",
    { team: teamId, last: 7, status: "FT" },
    { noStore: true }
  );
}

function buildTeamMatches(teamId: number, fixtures: ApiFixturesResp): MatchRow[] {
  return (fixtures.response ?? []).map((fx) => {
    const home = fx.teams.home;
    const away = fx.teams.away;
    const isHome = home.id === teamId;
    const opponent = isHome ? away.name : home.name;

    const homeGoals = fx.goals.home ?? 0;
    const awayGoals = fx.goals.away ?? 0;

    const goalsFor = isHome ? homeGoals : awayGoals;
    const goalsAgainst = isHome ? awayGoals : homeGoals;

    const corners = getStatValue(fx.statistics, teamId, "Corner Kicks");
    const yellow = getStatValue(fx.statistics, teamId, "Yellow Cards");
    const red = getStatValue(fx.statistics, teamId, "Red Cards");
    const cards = yellow + red;

    return {
      fixtureId: fx.fixture.id,
      date: fx.fixture.date,
      opponent,
      isHome,
      goalsFor,
      goalsAgainst,
      corners,
      cards,
    };
  });
}

export async function getLeagueBoards(): Promise<LeagueBoardData[]> {
  return Promise.all(LEAGUES.map((l) => getOneLeagueBoard(l)));
}

export async function getOneLeagueBoard(league: LeagueConfig): Promise<LeagueBoardData> {
  // 1) season
  const seasonRes = await getCurrentSeason(league.id);
  if (!seasonRes.ok) {
    return { leagueId: league.id, leagueName: league.name, teams: [], error: seasonRes.error };
  }

  // 2) teams
  const teamsRes = await getTeamsForLeague(league.id, seasonRes.data);
  if (!teamsRes.ok) {
    return {
      leagueId: league.id,
      leagueName: league.name,
      seasonUsed: seasonRes.data,
      teams: [],
      error: `Teams fetch failed (${teamsRes.status ?? "?"}): ${teamsRes.error}`,
    };
  }

  const teams = teamsRes.data.response ?? [];
  if (teams.length === 0) {
    return {
      leagueId: league.id,
      leagueName: league.name,
      seasonUsed: seasonRes.data,
      teams: [],
      error: `No teams returned for season ${seasonRes.data} (league ${league.id}).`,
    };
  }

  // 3) fixtures per team (limit concurrency so you don’t get 429)
  const teamRows = await mapLimit(teams, 5, async (t) => {
    const teamId = t.team.id;
    const fxRes = await getLastFinishedFixturesForTeam(teamId);

    // IMPORTANT: don’t silently drop — return empty matches but keep team visible
    const matches = fxRes.ok ? buildTeamMatches(teamId, fxRes.data) : [];
    const err = fxRes.ok ? undefined : fxRes.error;

    return {
      teamId,
      name: t.team.name,
      logo: t.team.logo,
      matches,
      _err: err,
      _status: fxRes.ok ? undefined : fxRes.status,
    };
  });

  // If we got rate-limited anywhere, surface it (this is usually why you see “no data”)
  const rateLimited = teamRows.find((x: any) => x._status === 429);
  const anyErrors = teamRows.find((x: any) => x._err);

  const topError =
    rateLimited
      ? "API rate limited (429). Your plan/quota is being exceeded. Reduce refreshes or add caching."
      : anyErrors
        ? `Some team requests failed (example: ${anyErrors._err}).`
        : undefined;

  return {
    leagueId: league.id,
    leagueName: league.name,
    seasonUsed: seasonRes.data,
    teams: teamRows.map(({ _err, _status, ...rest }: any) => rest),
    error: topError,
  };
}
