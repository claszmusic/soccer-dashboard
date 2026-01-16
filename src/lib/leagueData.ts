import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;
  opponent?: string; // "Monterrey (H)"
  ck?: number; // TOTAL corners (home+away)
  g?: number; // TOTAL goals (home+away)
  c?: number; // TOTAL cards (home+away)
};

export type LeagueBoard = {
  leagueTitle: string;
  season: number;
  rows: Array<{
    teamId: number;
    teamName: string;
    cells: MatchCell[]; // always columns length
  }>;
};

function n(v: any) {
  return typeof v === "number" ? v : 0;
}

function stat(stats: Array<{ type: string; value: number | null }>, type: string) {
  const v = stats.find((s) => s.type === type)?.value;
  return typeof v === "number" ? v : 0;
}

async function resolveLeagueAndSeason(leagueName: string, country: string) {
  const data = await apiFootball<{
    response: Array<{
      league: { id: number; name: string };
      country: { name: string };
      seasons?: Array<{ year: number; current?: boolean }>;
    }>;
  }>("/leagues", { name: leagueName, country }, 60 * 60 * 12);

  const item = data.response?.[0];
  const leagueId = item?.league?.id;

  // Pick the most recent season year (prefer current=true, else highest year)
  const seasons = item?.seasons ?? [];
  const current = seasons.find((s) => s.current);
  const seasonYear =
    current?.year ??
    seasons.map((s) => s.year).sort((a, b) => b - a)[0] ??
    new Date().getFullYear();

  if (!leagueId) return null;

  return { leagueId, seasonYear };
}

export async function buildLeagueBoard(opts: {
  leagueName: string;
  country: string;
  columns?: number; // default 7
}): Promise<LeagueBoard> {
  const { leagueName, country, columns = 7 } = opts;

  const resolved = await resolveLeagueAndSeason(leagueName, country);
  if (!resolved) return { leagueTitle: leagueName, season: new Date().getFullYear(), rows: [] };

  const { leagueId, seasonYear } = resolved;

  // 1) Get all teams in that league + season
  const teams = await apiFootball<{
    response: Array<{ team: { id: number; name: string } }>;
  }>("/teams", { league: leagueId, season: seasonYear }, 60 * 60 * 12);

  const teamList = (teams.response ?? []).map((t) => ({
    id: t.team.id,
    name: t.team.name,
  }));

  if (teamList.length === 0) {
    return { leagueTitle: leagueName, season: seasonYear, rows: [] };
  }

  const rows: LeagueBoard["rows"] = [];

  // 2) For each team: last 7 FT fixtures (no matter the date)
  for (const team of teamList) {
    const fixtures = await apiFootball<{
      response: Array<{
        fixture: { id: number };
        teams: { home: { id: number; name: string }; away: { id: number; name: string } };
        goals: { home: number | null; away: number | null };
      }>;
    }>("/fixtures", { team: team.id, season: seasonYear, status: "FT", last: columns }, 60 * 15);

    const cells: MatchCell[] = [];

    for (const fx of fixtures.response ?? []) {
      const fixtureId = fx.fixture?.id;
      if (!fixtureId) continue;

      const home = fx.teams?.home;
      const away = fx.teams?.away;
      if (!home?.id || !away?.id) continue;

      const isHome = home.id === team.id;
      const opponentName = isHome ? away.name : home.name;
      const opponent = `${opponentName} (${isHome ? "H" : "A"})`;

      // TOTAL goals (home+away)
      const gTotal = n(fx.goals?.home) + n(fx.goals?.away);

      // 3) Stats: corners + cards for BOTH teams, summed (home+away)
      const stats = await apiFootball<{
        response: Array<{
          team: { id: number };
          statistics: Array<{ type: string; value: number | null }>;
        }>;
      }>("/fixtures/statistics", { fixture: fixtureId }, 60 * 60 * 12);

      const homeStats = stats.response.find((s) => s.team.id === home.id)?.statistics ?? [];
      const awayStats = stats.response.find((s) => s.team.id === away.id)?.statistics ?? [];

      const ckTotal = stat(homeStats, "Corner Kicks") + stat(awayStats, "Corner Kicks");
      const cTotal =
        (stat(homeStats, "Yellow Cards") + stat(homeStats, "Red Cards")) +
        (stat(awayStats, "Yellow Cards") + stat(awayStats, "Red Cards"));

      cells.push({ fixtureId, opponent, g: gTotal, ck: ckTotal, c: cTotal });
    }

    // Keep columns fixed (always 7). If not enough matches, fill blanks.
    while (cells.length < columns) cells.push({});

    rows.push({
      teamId: team.id,
      teamName: team.name,
      cells,
    });
  }

  return {
    leagueTitle: leagueName,
    season: seasonYear,
    rows,
  };
}
