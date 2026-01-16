import { apiFootball } from "./apifootball";

export type MatchCell = {
  opponent: string;
  homeAway: "H" | "A";
  ck: number;
  g: number;
  c: number;
};

export type LeagueBoard = {
  leagueTitle: string;
  rows: {
    teamId: number;
    teamName: string;
    matches: MatchCell[];
  }[];
};

function combineCards(stats: any[]) {
  const y = stats.find((s) => s.type === "Yellow Cards")?.value ?? 0;
  const r = stats.find((s) => s.type === "Red Cards")?.value ?? 0;
  return y + r;
}

function getStat(stats: any[], type: string) {
  return stats.find((s) => s.type === type)?.value ?? 0;
}

export async function buildLeagueBoard(opts: {
  leagueName: string;
  country: string;
}): Promise<LeagueBoard> {
  const { leagueName, country } = opts;

  // find league id automatically
  const leagueRes = await apiFootball<any>("/leagues", {
    name: leagueName,
    country,
  });

  const leagueId = leagueRes.response?.[0]?.league?.id;

  if (!leagueId) {
    return { leagueTitle: leagueName, rows: [] };
  }

  // get ALL teams
  const teamsRes = await apiFootball<any>("/teams", {
    league: leagueId,
  });

  const teams = teamsRes.response.map((t: any) => ({
    id: t.team.id,
    name: t.team.name,
  }));

  const rows: LeagueBoard["rows"] = [];

  for (const team of teams) {
    // last 7 finished matches
    const fxRes = await apiFootball<any>("/fixtures", {
      team: team.id,
      league: leagueId,
      status: "FT",
      last: 7,
    });

    const matches: MatchCell[] = [];

    for (const fx of fxRes.response) {
      const isHome = fx.teams.home.id === team.id;
      const opponent = isHome
        ? fx.teams.away.name
        : fx.teams.home.name;

      const goals = isHome
        ? fx.goals.home
        : fx.goals.away;

      const statsRes = await apiFootball<any>("/fixtures/statistics", {
        fixture: fx.fixture.id,
      });

      const teamStats =
        statsRes.response.find((s: any) => s.team.id === team.id)
          ?.statistics ?? [];

      matches.push({
        opponent,
        homeAway: isHome ? "H" : "A",
        ck: getStat(teamStats, "Corner Kicks"),
        g: goals ?? 0,
        c: combineCards(teamStats),
      });
    }

    rows.push({
      teamId: team.id,
      teamName: team.name,
      matches,
    });
  }

  return {
    leagueTitle: leagueName,
    rows,
  };
}
