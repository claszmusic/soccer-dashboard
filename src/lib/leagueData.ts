import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;
  dateLabel: string; // "Jan 11"
  ck?: number;
  g?: number;
  c?: number;
};

export type TeamRow = {
  teamId: number;
  teamName: string;
  cellsByDate: Record<string, MatchCell>;
};

export type LeagueBoard = {
  leagueTitle: string;
  season: number;
  dateColumns: string[]; // 7 columns
  rows: Array<{
    teamId: number;
    teamName: string;
    cells: MatchCell[]; // aligned to dateColumns
  }>;
};

async function resolveLeagueId(leagueName: string, country: string, season: number) {
  const data = await apiFootball<{
    response: Array<{ league: { id: number; name: string }; country: { name: string } }>;
  }>("/leagues", { name: leagueName, country, season }, 60 * 60 * 24);

  const id = data.response?.[0]?.league?.id;
  if (!id) throw new Error(`Could not find league id for ${leagueName} (${country}) season ${season}`);
  return id;
}

function monthDayLabel(dateISO: string) {
  const d = new Date(dateISO);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  const leagueId = await resolveLeagueId(leagueName, country, season);

  // 1) ALL teams in the league
  const teams = await apiFootball<{
    response: Array<{ team: { id: number; name: string } }>;
  }>("/teams", { league: leagueId, season }, 60 * 60 * 24);

  const teamList = teams.response.map((t) => ({ id: t.team.id, name: t.team.name }));

  // 2) Build a consistent set of recent "matchday" date columns from league finished games
  const leagueFix = await apiFootball<{
    response: Array<{ fixture: { id: number; date: string } }>;
  }>("/fixtures", { league: leagueId, season, status: "FT", last: 250 }, 60 * 60 * 6);

  const dateColumns: string[] = [];
  const seen = new Set<string>();

  // fixtures returned as "last" (most recent) -> go in order and take unique labels
  for (const fx of leagueFix.response) {
    const label = monthDayLabel(fx.fixture.date);
    if (seen.has(label)) continue;
    seen.add(label);
    dateColumns.push(label);
    if (dateColumns.length >= columns) break;
  }

  // 3) For each team, fetch recent fixtures, then fill cells for dateColumns
  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    const fixtures = await apiFootball<{
      response: Array<{
        fixture: { id: number; date: string };
        goals: { home: number | null; away: number | null };
        teams: { home: { id: number }; away: { id: number } };
      }>;
    }>("/fixtures", { league: leagueId, season, team: team.id, last: 40 }, 60 * 60 * 6);

    // Map team fixtures by dateLabel (latest fixture on that label wins)
    const byDate: Record<string, { fixtureId: number; dateLabel: string; goalsFor: number }> = {};

    for (const fx of fixtures.response) {
      const dateLabel = monthDayLabel(fx.fixture.date);
      const isHome = fx.teams.home.id === team.id;
      const goalsFor = isHome ? (fx.goals.home ?? 0) : (fx.goals.away ?? 0);

      // only store if this dateLabel is in our columns
      if (!dateColumns.includes(dateLabel)) continue;

      byDate[dateLabel] = { fixtureId: fx.fixture.id, dateLabel, goalsFor };
    }

    // Build aligned cells in the exact column order
    const cells: MatchCell[] = [];

    for (const d of dateColumns) {
      const fx = byDate[d];
      if (!fx) {
        cells.push({ dateLabel: d });
        continue;
      }

      // stats for corners/cards
      const stats = await apiFootball<{
        response: Array<{
          team: { id: number };
          statistics: Array<{ type: string; value: number | null }>;
        }>;
      }>("/fixtures/statistics", { fixture: fx.fixtureId }, 60 * 60 * 24);

      const teamStats = stats.response.find((s) => s.team.id === team.id)?.statistics ?? [];

      const corners = getStatValue(teamStats, "Corner Kicks");
      const yellows = getStatValue(teamStats, "Yellow Cards") ?? 0;
      const reds = getStatValue(teamStats, "Red Cards") ?? 0;

      const ck = typeof corners === "number" ? corners : undefined;
      const c = (yellows ?? 0) + (reds ?? 0);

      cells.push({
        fixtureId: fx.fixtureId,
        dateLabel: d,
        ck,
        g: fx.goalsFor,
        c,
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
    dateColumns,
    rows,
  };
}
