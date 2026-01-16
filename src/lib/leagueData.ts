import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;
  dateLabel: string;
  ck?: number;
  g?: number;
  c?: number;
};

export type LeagueBoard = {
  leagueTitle: string;
  season: number;
  dateColumns: string[];
  rows: Array<{
    teamId: number;
    teamName: string;
    cells: MatchCell[];
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
  columns?: number;
}): Promise<LeagueBoard> {
  const { leagueName, country, season, columns = 7 } = opts;

  const resolved = await resolveLeague(leagueName, country, season);
  if (!resolved) {
    // Don’t crash the whole site—return an empty board
    return { leagueTitle: leagueName, season, dateColumns: [], rows: [] };
  }

  const { leagueId, seasonUsed } = resolved;

  // 1) Teams (use seasonUsed!)
  const teams = await apiFootball<{
    response: Array<{ team: { id: number; name: string } }>;
  }>("/teams", { league: leagueId, season: seasonUsed }, 60 * 60 * 24);

  const teamList = teams.response.map((t) => ({ id: t.team.id, name: t.team.name }));

  // 2) Date columns
  // Try finished games first
  const finished = await apiFootball<{
    response: Array<{ fixture: { id: number; date: string } }>;
  }>("/fixtures", { league: leagueId, season: seasonUsed, status: "FT", last: 250 }, 60 * 60 * 6);

  const dateColumns: string[] = [];
  const seen = new Set<string>();

  for (const fx of finished.response) {
    const label = monthDayLabel(fx.fixture.date);
    if (seen.has(label)) continue;
    seen.add(label);
    dateColumns.push(label);
    if (dateColumns.length >= columns) break;
  }

  // If no finished games yet, use upcoming games so you still see dates + teams
  if (dateColumns.length === 0) {
    const upcoming = await apiFootball<{
      response: Array<{ fixture: { id: number; date: string } }>;
    }>("/fixtures", { league: leagueId, season: seasonUsed, next: 50 }, 60 * 60 * 6);

    for (const fx of upcoming.response) {
      const label = monthDayLabel(fx.fixture.date);
      if (seen.has(label)) continue;
      seen.add(label);
      dateColumns.push(label);
      if (dateColumns.length >= columns) break;
    }
  }

  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    const fixtures = await apiFootball<{
      response: Array<{
        fixture: { id: number; date: string; status: { short: string } };
        goals: { home: number | null; away: number | null };
        teams: { home: { id: number }; away: { id: number } };
      }>;
    }>("/fixtures", { league: leagueId, season: seasonUsed, team: team.id, last: 40 }, 60 * 60 * 6);

    const byDate: Record<
      string,
      { fixtureId: number; dateLabel: string; goalsFor: number; status: string }
    > = {};

    for (const fx of fixtures.response) {
      const dateLabel = monthDayLabel(fx.fixture.date);
      if (!dateColumns.includes(dateLabel)) continue;

      const isHome = fx.teams.home.id === team.id;
      const goalsFor = isHome ? (fx.goals.home ?? 0) : (fx.goals.away ?? 0);

      byDate[dateLabel] = {
        fixtureId: fx.fixture.id,
        dateLabel,
        goalsFor,
        status: fx.fixture.status.short,
      };
    }

    const cells: MatchCell[] = [];

    for (const d of dateColumns) {
      const fx = byDate[d];
      if (!fx) {
        cells.push({ dateLabel: d });
        continue;
      }

      // Only fetch corners/cards if finished (stats often missing for not-finished)
      const isFinished = fx.status === "FT" || fx.status === "AET" || fx.status === "PEN";
      if (!isFinished) {
        cells.push({ fixtureId: fx.fixtureId, dateLabel: d, g: fx.goalsFor });
        continue;
      }

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
      const c = yellows + reds;

      cells.push({ fixtureId: fx.fixtureId, dateLabel: d, ck, g: fx.goalsFor, c });
    }

    rows.push({ teamId: team.id, teamName: team.name, cells });
  }

  return {
    leagueTitle: leagueName,
    season: seasonUsed,
    dateColumns,
    rows,
  };
}
