import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;
  opponent?: string;
  homeAway?: "H" | "A";
  ck?: number; // COMBINED (home+away)
  g?: number;  // COMBINED (home+away)
  c?: number;  // COMBINED (home+away)
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

function sumStatAcrossTeams(
  statsResponse: Array<{ statistics: Array<{ type: string; value: number | null }> }>,
  type: string
) {
  let total = 0;
  let foundAny = false;

  for (const team of statsResponse) {
    const v = getStatValue(team.statistics ?? [], type);
    if (typeof v === "number") {
      total += v;
      foundAny = true;
    }
  }

  return foundAny ? total : undefined;
}

async function combinedCardsFromEvents(fixtureId: number): Promise<number | undefined> {
  // Backup method when /fixtures/statistics doesn't return card stats
  try {
    const events = await apiFootball<{
      response: Array<{ type: string; detail?: string | null }>;
    }>("/fixtures/events", { fixture: fixtureId }, 60 * 60 * 24);

    let cards = 0;

    for (const e of events.response ?? []) {
      if (e.type !== "Card") continue;
      // Count both yellow + red as "cards" (same as your UI expectation)
      // Most providers use details like "Yellow Card", "Red Card", etc.
      cards += 1;
    }

    return cards;
  } catch {
    return undefined;
  }
}

async function getFtFixturesAcrossSeasons(opts: {
  leagueId: number;
  teamId: number;
  seasonPrimary: number;
  seasonFallback: number;
  needed: number;
}) {
  const { leagueId, teamId, seasonPrimary, seasonFallback, needed } = opts;

  const fetchSeason = async (s: number) => {
    const fx = await apiFootball<{
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
      { league: leagueId, season: s, team: teamId, status: "FT", last: 50 },
      60 * 60 * 6
    );

    return (fx.response ?? []).filter((x) => x.fixture.status.short === "FT");
  };

  const primary = await fetchSeason(seasonPrimary);
  const ids = new Set<number>();
  const out: typeof primary = [];

  for (const f of primary) {
    if (ids.has(f.fixture.id)) continue;
    ids.add(f.fixture.id);
    out.push(f);
    if (out.length >= needed) return out;
  }

  const fallback = await fetchSeason(seasonFallback);
  for (const f of fallback) {
    if (ids.has(f.fixture.id)) continue;
    ids.add(f.fixture.id);
    out.push(f);
    if (out.length >= needed) break;
  }

  return out;
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

  // All teams in the league (using seasonUsed)
  const teams = await apiFootball<{
    response: Array<{ team: { id: number; name: string } }>;
  }>("/teams", { league: leagueId, season: seasonUsed }, 60 * 60 * 24);

  const teamList = teams.response.map((t) => ({ id: t.team.id, name: t.team.name }));

  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    // FT only, but ALSO pull from previous season if needed so teams don't stay blank
    const ft = await getFtFixturesAcrossSeasons({
      leagueId,
      teamId: team.id,
      seasonPrimary: seasonUsed,
      seasonFallback: seasonUsed - 1,
      needed: columns,
    });

    const cells: MatchCell[] = [];

    for (const fx of ft.slice(0, columns)) {
      const isHome = fx.teams.home.id === team.id;
      const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;

      // ✅ COMBINED goals (total match goals)
      const goalsHome = fx.goals.home ?? 0;
      const goalsAway = fx.goals.away ?? 0;
      const combinedGoals = goalsHome + goalsAway;

      const cell: MatchCell = {
        fixtureId: fx.fixture.id,
        opponent,
        homeAway: isHome ? "H" : "A",
        g: combinedGoals,
      };

      // ✅ COMBINED corners + cards (total match)
      try {
        const stats = await apiFootball<{
          response: Array<{
            team: { id: number };
            statistics: Array<{ type: string; value: number | null }>;
          }>;
        }>("/fixtures/statistics", { fixture: fx.fixture.id }, 60 * 60 * 24);

        const resp = stats.response ?? [];

        // corners: sum both teams
        cell.ck = sumStatAcrossTeams(resp, "Corner Kicks");

        // cards: sum both teams (yellow + red)
        const y = sumStatAcrossTeams(resp, "Yellow Cards") ?? 0;
        const r = sumStatAcrossTeams(resp, "Red Cards") ?? 0;

        // if stats don’t provide cards at all, fallback to /fixtures/events
        if (y === 0 && r === 0) {
          const cardsFromEvents = await combinedCardsFromEvents(fx.fixture.id);
          if (typeof cardsFromEvents === "number") {
            cell.c = cardsFromEvents;
          } else {
            cell.c = 0;
          }
        } else {
          cell.c = y + r;
        }
      } catch {
        // If statistics fails, at least try events for cards
        const cardsFromEvents = await combinedCardsFromEvents(fx.fixture.id);
        if (typeof cardsFromEvents === "number") cell.c = cardsFromEvents;
      }

      cells.push(cell);
    }

    // Keep columns locked in position (always 7 cells)
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
