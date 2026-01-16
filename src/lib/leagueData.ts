import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;

  opponent?: string; // "Monterrey"
  homeAway?: "H" | "A";

  ck?: number; // corners
  g?: number; // goals-for
  c?: number; // cards (yellow+red)
};

export type LeagueBoard = {
  leagueTitle: string;
  season: number;
  rows: Array<{
    teamId: number;
    teamName: string;
    cells: MatchCell[]; // ALWAYS length = columns (default 7)
  }>;
};

async function resolveLeagueId(leagueName: string, country: string, season: number) {
  const trySeason = async (s: number) => {
    const data = await apiFootball<{
      response: Array<{ league: { id: number }; country: { name: string } }>;
    }>("/leagues", { name: leagueName, country, season: s }, 60 * 60 * 24);

    return data.response?.[0]?.league?.id ?? null;
  };

  const idNow = await trySeason(season);
  if (idNow) return idNow;

  const idPrev = await trySeason(season - 1);
  if (idPrev) return idPrev;

  throw new Error(
    `Could not find league id for ${leagueName} (${country}) season ${season} or ${season - 1}`
  );
}

function getStatValue(
  stats: Array<{ type: string; value: number | null }>,
  type: string
) {
  return stats.find((s) => s.type === type)?.value ?? null;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// small throttled pool so we don’t hit API limits hard
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;

  const workers = Array.from({ length: concurrency }).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function buildLeagueBoard(opts: {
  leagueName: string;
  country: string;
  season: number;
  columns?: number; // default 7
}): Promise<LeagueBoard> {
  const { leagueName, country, season, columns = 7 } = opts;

  const leagueId = await resolveLeagueId(leagueName, country, season);

  // 1) All teams in the league (one call)
  const teams = await apiFootball<{
    response: Array<{ team: { id: number; name: string } }>;
  }>("/teams", { league: leagueId, season }, 60 * 60 * 24);

  const teamList = teams.response.map((t) => ({
    id: t.team.id,
    name: t.team.name,
  }));

  // 2) Get a big list of MOST RECENT FT fixtures for the league (one call)
  // We will build each team’s last 7 matches from THIS list.
  const leagueFix = await apiFootball<{
    response: Array<{
      fixture: { id: number; date: string };
      teams: {
        home: { id: number; name: string };
        away: { id: number; name: string };
      };
      goals: { home: number | null; away: number | null };
    }>;
  }>(
    "/fixtures",
    { league: leagueId, season, status: "FT", last: 250 },
    60 * 30
  );

  const fixtures = leagueFix.response ?? [];

  // 3) Build: teamId -> array of fixtures (already “recent”, we’ll keep first 7)
  const teamToFixtures = new Map<number, typeof fixtures>();

  for (const fx of fixtures) {
    const h = fx.teams.home.id;
    const a = fx.teams.away.id;

    if (!teamToFixtures.has(h)) teamToFixtures.set(h, []);
    if (!teamToFixtures.has(a)) teamToFixtures.set(a, []);

    teamToFixtures.get(h)!.push(fx);
    teamToFixtures.get(a)!.push(fx);
  }

  // 4) Collect all fixtureIds that will be displayed (unique) so we fetch stats ONCE per match
  const wantedFixtureIds = new Set<number>();

  for (const team of teamList) {
    const list = teamToFixtures.get(team.id) ?? [];
    for (const fx of list.slice(0, columns)) {
      wantedFixtureIds.add(fx.fixture.id);
    }
  }

  const fixtureIds = Array.from(wantedFixtureIds);

  // 5) Fetch stats per fixture with throttling (few at a time)
  const statsByFixture = new Map<
    number,
    Array<{
      team: { id: number };
      statistics: Array<{ type: string; value: number | null }>;
    }>
  >();

  await mapWithConcurrency(fixtureIds, 3, async (fixtureId, idx) => {
    // tiny delay between requests helps avoid rate-limit spikes
    if (idx % 3 === 0) await sleep(150);

    try {
      const stats = await apiFootball<{
        response: Array<{
          team: { id: number };
          statistics: Array<{ type: string; value: number | null }>;
        }>;
      }>("/fixtures/statistics", { fixture: fixtureId }, 60 * 60 * 6);

      statsByFixture.set(fixtureId, stats.response ?? []);
    } catch {
      // if stats fail, we still show opponent + goals; CK/C become "-"
      statsByFixture.set(fixtureId, []);
    }

    return true;
  });

  // 6) Build rows with FIXED columns: Match 1..Match 7 for each team (their own last 7 FT)
  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    const list = (teamToFixtures.get(team.id) ?? []).slice(0, columns);

    const cells: MatchCell[] = [];

    for (let i = 0; i < columns; i++) {
      const fx = list[i];

      if (!fx) {
        cells.push({});
        continue;
      }

      const isHome = fx.teams.home.id === team.id;
      const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;
      const homeAway: "H" | "A" = isHome ? "H" : "A";

      const goalsFor = isHome ? (fx.goals.home ?? 0) : (fx.goals.away ?? 0);

      const perTeamStats =
        statsByFixture.get(fx.fixture.id)?.find((s) => s.team.id === team.id)
          ?.statistics ?? [];

      const corners = getStatValue(perTeamStats, "Corner Kicks");
      const yellows = getStatValue(perTeamStats, "Yellow Cards") ?? 0;
      const reds = getStatValue(perTeamStats, "Red Cards") ?? 0;

      const ck = typeof corners === "number" ? corners : undefined;
      const c = (typeof yellows === "number" ? yellows : 0) + (typeof reds === "number" ? reds : 0);

      cells.push({
        fixtureId: fx.fixture.id,
        opponent,
        homeAway,
        ck,
        g: goalsFor,
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
    rows,
  };
}
