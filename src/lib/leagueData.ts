import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;
  opponent?: string;
  homeAway?: "H" | "A";
  ck?: number;
  g?: number;
  c?: number;
};

export type LeagueBoard = {
  leagueTitle: string;
  season: number;
  columns: number; // always 7
  rows: Array<{
    teamId: number;
    teamName: string;
    cells: MatchCell[]; // length === columns
  }>;
};

async function resolveLeague(leagueName: string, country: string, season: number) {
  const trySeason = async (s: number) => {
    const data = await apiFootball<{
      response: Array<{ league: { id: number } }>;
    }>("/leagues", { name: leagueName, country, season: s }, 60 * 60 * 24);

    const id = data.response?.[0]?.league?.id ?? null;
    return id ? { leagueId: id, seasonUsed: s } : null;
  };

  return (await trySeason(season)) || (await trySeason(season - 1)) || null;
}

function getStatValue(stats: Array<{ type: string; value: number | null }>, type: string) {
  return stats.find((s) => s.type === type)?.value ?? null;
}

export async function buildLeagueBoard(opts: {
  leagueName: string;
  country: string;
  season: number;
  columns?: number; // default 7
}): Promise<LeagueBoard> {
  const { leagueName, country, season, columns = 7 } = opts;

  const resolved = await resolveLeague(leagueName, country, season);
  if (!resolved) return { leagueTitle: leagueName, season, columns, rows: [] };

  const { leagueId, seasonUsed } = resolved;

  // All teams in the league
  const teams = await apiFootball<{
    response: Array<{ team: { id: number; name: string } }>;
  }>("/teams", { league: leagueId, season: seasonUsed }, 60 * 60 * 24);

  const teamList = teams.response.map((t) => ({ id: t.team.id, name: t.team.name }));

  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    // FT ONLY — pull more than 7 so we’re safe
    const fixtures = await apiFootball<{
      response: Array<{
        fixture: { id: number; status: { short: string } };
        teams: {
          home: { id: number; name: string };
          away: { id: number; name: string };
        };
        goals: { home: number | null; away: number | null };
      }>;
    }>(
      "/fixtures",
      { league: leagueId, season: seasonUsed, team: team.id, status: "FT", last: 25 },
      60 * 60 * 6
    );

    const ft = (fixtures.response || []).filter((fx) => fx.fixture.status.short === "FT").slice(0, columns);

    const cells: MatchCell[] = [];

    for (const fx of ft) {
      const isHome = fx.teams.home.id === team.id;
      const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;
      const goalsFor = isHome ? (fx.goals.home ?? 0) : (fx.goals.away ?? 0);

      const cell: MatchCell = {
        fixtureId: fx.fixture.id,
        opponent,
        homeAway: isHome ? "H" : "A",
        g: goalsFor,
      };

      // Stats (corners/cards). Even for FT, sometimes stats can be missing → keep safe.
      try {
        const stats = await apiFootball<{
          response: Array<{
            team: { id: number };
            statistics: Array<{ type: string; value: number | null }>;
          }>;
        }>("/fixtures/statistics", { fixture: fx.fixture.id }, 60 * 60 * 24);

        const teamStats = stats.response.find((s) => s.team.id === team.id)?.statistics ?? [];

        const corners = getStatValue(teamStats, "Corner Kicks");
        const yellows = getStatValue(teamStats, "Yellow Cards") ?? 0;
        const reds = getStatValue(teamStats, "Red Cards") ?? 0;

        cell.ck = typeof corners === "number" ? corners : undefined;
        cell.c = yellows + reds;
      } catch {
        // leave ck/c undefined if stats missing
      }

      cells.push(cell);
    }

    // Always keep 7 columns so UI never collapses
    while (cells.length < columns) cells.push({});

    rows.push({
      teamId: team.id,
      teamName: team.name,
      cells,
    });
  }

  return {
    leagueTitle: leagueName,
    season: seasonUsed,
    columns,
    rows,
  };
}
