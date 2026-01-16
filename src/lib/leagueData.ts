import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;
  opponent?: string; // who they played
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
      response: Array<{ league: { id: number }; country: { name: string } }>;
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
  if (!resolved) {
    // Never crash the whole page
    return { leagueTitle: leagueName, season, columns, rows: [] };
  }

  const { leagueId, seasonUsed } = resolved;

  // 1) Get ALL teams
  const teams = await apiFootball<{
    response: Array<{ team: { id: number; name: string } }>;
  }>("/teams", { league: leagueId, season: seasonUsed }, 60 * 60 * 24);

  const teamList = teams.response.map((t) => ({ id: t.team.id, name: t.team.name }));

  // 2) For each team, fetch LAST 7 matches.
  // Prefer finished (FT) so we get real numbers, but if league has no finished yet, fallback to last matches anyway.
  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    // Try finished matches first
    let fixtures = await apiFootball<{
      response: Array<{
        fixture: { id: number; status: { short: string } };
        teams: {
          home: { id: number; name: string };
          away: { id: number; name: string };
        };
        goals: { home: number | null; away: number | null };
      }>;
    }>("/fixtures", { league: leagueId, season: seasonUsed, team: team.id, status: "FT", last: columns }, 60 * 60 * 6);

    // If not enough finished games, fallback to whatever exists
    if (!fixtures.response || fixtures.response.length < columns) {
      fixtures = await apiFootball<{
        response: Array<{
          fixture: { id: number; status: { short: string } };
          teams: {
            home: { id: number; name: string };
            away: { id: number; name: string };
          };
          goals: { home: number | null; away: number | null };
        }>;
      }>("/fixtures", { league: leagueId, season: seasonUsed, team: team.id, last: columns }, 60 * 60 * 6);
    }

    const cells: MatchCell[] = [];

    for (const fx of fixtures.response.slice(0, columns)) {
      const isHome = fx.teams.home.id === team.id;
      const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;
      const goalsFor = isHome ? (fx.goals.home ?? 0) : (fx.goals.away ?? 0);

      const status = fx.fixture.status.short;
      const isFinished = status === "FT" || status === "AET" || status === "PEN";

      // default
      const cell: MatchCell = {
        fixtureId: fx.fixture.id,
        opponent,
        homeAway: isHome ? "H" : "A",
        g: goalsFor,
      };

      // Corners/Cards only if finished (stats usually not ready before FT)
      if (isFinished) {
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
      }

      cells.push(cell);
    }

    // Always ensure exactly 7 cells so the UI never collapses
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
