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

async function resolveLeagueId(leagueName: string, country: string) {
  const data = await apiFootball<{ response: Array<{ league: { id: number } }> }>(
    "/leagues",
    { name: leagueName, country }
  );
  const id = data.response?.[0]?.league?.id;
  if (!id) throw new Error(`Could not find league id for ${leagueName} (${country})`);
  return id;
}

export async function buildLeagueBoard(opts: {
  leagueName: string;
  country: string;
  columns?: number; // default 7
}): Promise<LeagueBoard> {
  const { leagueName, country, columns = 7 } = opts;

  const leagueId = await resolveLeagueId(leagueName, country);

  // Get teams (use current season if API requires it; many endpoints still return teams without season)
  // We'll try without season first, then fallback to 2025 if needed.
  let teamsResp:
    | { response: Array<{ team: { id: number; name: string } }> }
    | null = null;

  try {
    teamsResp = await apiFootball("/teams", { league: leagueId });
  } catch {
    teamsResp = await apiFootball("/teams", { league: leagueId, season: 2025 });
  }

  const teamList = (teamsResp?.response ?? []).map((t) => ({
    id: t.team.id,
    name: t.team.name,
  }));

  // If teams still empty, return empty board (UI will show no rows)
  if (teamList.length === 0) {
    return { leagueTitle: leagueName, rows: [] };
  }

  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    // LAST 7 finished matches for that team (NO YEAR / NO SEASON)
    const fixtures = await apiFootball<{
      response: Array<{
        fixture: { id: number };
        teams: { home: { id: number; name: string }; away: { id: number; name: string } };
        goals: { home: number | null; away: number | null };
      }>;
    }>("/fixtures", { team: team.id, status: "FT", last: columns });

    // newest -> oldest already; keep order as returned
    const cells: MatchCell[] = [];

    for (const fx of fixtures.response) {
      const fixtureId = fx.fixture.id;

      const isHome = fx.teams.home.id === team.id;
      const opponentName = isHome ? fx.teams.away.name : fx.teams.home.name;
      const opponent = `${opponentName} (${isHome ? "H" : "A"})`;

      // TOTAL goals (home+away)
      const gTotal = num(fx.goals.home) + num(fx.goals.away);

      // Stats: corners + cards (need both teams stats; we sum them)
      const stats = await apiFootball<{
        response: Array<{
          team: { id: number };
          statistics: Array<{ type: string; value: number | null }>;
        }>;
      }>("/fixtures/statistics", { fixture: fixtureId });

      const homeStats = stats.response.find((s) => s.team.id === fx.teams.home.id)?.statistics ?? [];
      const awayStats = stats.response.find((s) => s.team.id === fx.teams.away.id)?.statistics ?? [];

      const ckTotal = corners(homeStats) + corners(awayStats);
      const cTotal = sumCards(homeStats) + sumCards(awayStats);

      cells.push({
        fixtureId,
        opponent,
        g: gTotal,
        ck: ckTotal,
        c: cTotal,
      });
    }

    // If a team has < 7 games, pad with blanks so columns stay fixed
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
