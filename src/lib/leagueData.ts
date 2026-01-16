// src/lib/leagueData.ts
import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;
  opponent?: string; // "Monterrey (H)"
  ck?: number; // corners
  g?: number; // goals-for
  c?: number; // cards total
};

export type LeagueBoard = {
  leagueTitle: string;
  season: number;
  columns: number; // 7
  rows: Array<{
    teamId: number;
    teamName: string;
    cells: MatchCell[]; // length = columns
  }>;
};

function statValue(
  stats: Array<{ type: string; value: number | null }>,
  type: string
): number | undefined {
  const v = stats.find((s) => s.type === type)?.value ?? null;
  return typeof v === "number" ? v : undefined;
}

async function resolveLeagueId(leagueName: string, country: string, season: number): Promise<number> {
  const trySeason = async (s: number) => {
    const data = await apiFootball<{
      response: Array<{ league: { id: number }; country: { name: string } }>;
    }>("/leagues", { name: leagueName, country, season: s });

    return data.response?.[0]?.league?.id ?? null;
  };

  const idNow = await trySeason(season);
  if (idNow) return idNow;

  const idPrev = await trySeason(season - 1);
  if (idPrev) return idPrev;

  throw new Error(`Could not find league id for ${leagueName} (${country}) season ${season} or ${season - 1}`);
}

export async function buildLeagueBoard(opts: {
  leagueName: string;
  country: string;
  season: number;
  columns?: number; // default 7
}): Promise<LeagueBoard> {
  const { leagueName, country, season, columns = 7 } = opts;

  const leagueId = await resolveLeagueId(leagueName, country, season);

  // 1) Get ALL teams for the league/season
  const teams = await apiFootball<{
    response: Array<{ team: { id: number; name: string } }>;
  }>("/teams", { league: leagueId, season });

  const teamList = teams.response
    .map((t) => ({ id: t.team.id, name: t.team.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 2) For each team, get last 7 FINISHED matches (FT) and fill cells
  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    // last 7 FT matches for this team in this league/season
    const fixtures = await apiFootball<{
      response: Array<{
        fixture: { id: number; date: string };
        teams: {
          home: { id: number; name: string };
          away: { id: number; name: string };
        };
        goals: { home: number | null; away: number | null };
      }>;
    }>("/fixtures", { league: leagueId, season, team: team.id, status: "FT", last: columns });

    // API returns most recent first
    const fxList = fixtures.response ?? [];

    const cells: MatchCell[] = [];

    for (let i = 0; i < columns; i++) {
      const fx = fxList[i];
      if (!fx) {
        cells.push({});
        continue;
      }

      const isHome = fx.teams.home.id === team.id;
      const opponentName = isHome ? fx.teams.away.name : fx.teams.home.name;
      const ha = isHome ? "(H)" : "(A)";

      const goalsFor = isHome ? (fx.goals.home ?? 0) : (fx.goals.away ?? 0);

      // stats for corners/cards (FT only)
      const stats = await apiFootball<{
        response: Array<{
          team: { id: number };
          statistics: Array<{ type: string; value: number | null }>;
        }>;
      }>("/fixtures/statistics", { fixture: fx.fixture.id });

      const teamStats = stats.response.find((s) => s.team.id === team.id)?.statistics ?? [];

      const corners = statValue(teamStats, "Corner Kicks");
      const yellows = statValue(teamStats, "Yellow Cards") ?? 0;
      const reds = statValue(teamStats, "Red Cards") ?? 0;
      const cardsTotal = (yellows ?? 0) + (reds ?? 0);

      cells.push({
        fixtureId: fx.fixture.id,
        opponent: `${opponentName} ${ha}`,
        ck: corners,
        g: goalsFor,
        c: cardsTotal,
      });
    }

    rows.push({
      teamId: team.id,
      teamName: team.name,
      cells,
    });
  }

  return {
    leagueTitle: leagueName,
    season,
    columns,
    rows,
  };
}
