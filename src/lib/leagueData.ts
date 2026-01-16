import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;
  opponent?: string; // "Monterrey (H)"
  ck?: number; // TOTAL corners (home+away)
  g?: number;  // TOTAL goals (home+away)
  c?: number;  // TOTAL cards (home+away)
};

export type LeagueBoard = {
  leagueTitle: string;
  rows: Array<{
    teamId: number;
    teamName: string;
    cells: MatchCell[]; // always 7
  }>;
};

function num(v: any): number {
  return typeof v === "number" ? v : 0;
}

function sumCards(stats: Array<{ type: string; value: number | null }>) {
  const yellow = stats.find((s) => s.type === "Yellow Cards")?.value;
  const red = stats.find((s) => s.type === "Red Cards")?.value;
  return num(yellow) + num(red);
}

function corners(stats: Array<{ type: string; value: number | null }>) {
  const ck = stats.find((s) => s.type === "Corner Kicks")?.value;
  return num(ck);
}

async function resolveLeagueId(leagueName: string, country: string): Promise<number | null> {
  try {
    const data = await apiFootball<{ response: Array<{ league: { id: number } }> }>(
      "/leagues",
      { name: leagueName, country }
    );
    const id = data.response?.[0]?.league?.id;
    return id ?? null;
  } catch {
    return null;
  }
}

export async function buildLeagueBoard(opts: {
  leagueName: string;
  country: string;
  columns?: number; // default 7
}): Promise<LeagueBoard> {
  const { leagueName, country, columns = 7 } = opts;

  const leagueId = await resolveLeagueId(leagueName, country);
  if (!leagueId) return { leagueTitle: leagueName, rows: [] };

  // Teams: try with a fallback season (many APIs require season here)
  let teamsResp:
    | { response: Array<{ team: { id: number; name: string } }> }
    | null = null;

  try {
    teamsResp = await apiFootball("/teams", { league: leagueId, season: new Date().getFullYear() });
    if (!teamsResp?.response?.length) {
      teamsResp = await apiFootball("/teams", { league: leagueId, season: new Date().getFullYear() - 1 });
    }
  } catch {
    return { leagueTitle: leagueName, rows: [] };
  }

  const teamList = (teamsResp?.response ?? []).map((t) => ({
    id: t.team.id,
    name: t.team.name,
  }));

  if (teamList.length === 0) return { leagueTitle: leagueName, rows: [] };

  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    let fixturesData:
      | { response: Array<any> }
      | null = null;

    try {
      fixturesData = await apiFootball("/fixtures", { team: team.id, status: "FT", last: columns });
    } catch {
      fixturesData = { response: [] };
    }

    const cells: MatchCell[] = [];

    for (const fx of fixturesData.response ?? []) {
      const fixtureId = fx.fixture?.id;
      if (!fixtureId) continue;

      const home = fx.teams?.home;
      const away = fx.teams?.away;

      if (!home?.id || !away?.id) continue;

      const isHome = home.id === team.id;
      const opponentName = isHome ? away.name : home.name;
      const opponent = `${opponentName} (${isHome ? "H" : "A"})`;

      const gTotal = num(fx.goals?.home) + num(fx.goals?.away);

      // Stats (sum home+away)
      let statsResp:
        | { response: Array<{ team: { id: number }; statistics: Array<{ type: string; value: number | null }> }> }
        | null = null;

      try {
        statsResp = await apiFootball("/fixtures/statistics", { fixture: fixtureId });
      } catch {
        statsResp = { response: [] };
      }

      const homeStats = statsResp.response.find((s) => s.team.id === home.id)?.statistics ?? [];
      const awayStats = statsResp.response.find((s) => s.team.id === away.id)?.statistics ?? [];

      const ckTotal = corners(homeStats) + corners(awayStats);
      const cTotal = sumCards(homeStats) + sumCards(awayStats);

      cells.push({ fixtureId, opponent, g: gTotal, ck: ckTotal, c: cTotal });
    }

    while (cells.length < columns) cells.push({});

    rows.push({
      teamId: team.id,
      teamName: team.name,
      cells,
    });
  }

  return {
    leagueTitle: leagueName,
    rows,
  };
}
