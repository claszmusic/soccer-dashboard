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
  rows: Array<{
    teamId: number;
    teamName: string;
    cells: MatchCell[];
  }>;
};

async function resolveLeagueId(leagueName: string, country: string, season: number) {
  const trySeason = async (s: number) => {
    const data = await apiFootball<{
      response: Array<{ league: { id: number } }>;
    }>("/leagues", { name: leagueName, country, season: s }, 60 * 60 * 24);

    return data.response?.[0]?.league?.id ?? null;
  };

  return (await trySeason(season)) ?? (await trySeason(season - 1)) ?? (() => {
    throw new Error(`Could not find league id for ${leagueName} (${country}) season ${season}`);
  })();
}

function getStatValue(stats: Array<{ type: string; value: number | null }>, type: string) {
  return stats.find((s) => s.type === type)?.value ?? null;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// retry wrapper (handles rate limit / temporary fails)
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown = null;

  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // backoff: 300ms, 800ms, 1600ms, 2600ms...
      const wait = 300 + i * i * 500;
      await sleep(wait);
    }
  }

  throw lastErr;
}

export async function buildLeagueBoard(opts: {
  leagueName: string;
  country: string;
  season: number;
  columns?: number;
}): Promise<LeagueBoard> {
  const { leagueName, country, season, columns = 7 } = opts;

  const leagueId = await resolveLeagueId(leagueName, country, season);

  // Teams
  const teams = await withRetry(() =>
    apiFootball<{
      response: Array<{ team: { id: number; name: string } }>;
    }>("/teams", { league: leagueId, season }, 60 * 60 * 24)
  );

  const teamList = teams.response.map((t) => ({ id: t.team.id, name: t.team.name }));

  // Last FT fixtures in league
  const leagueFix = await withRetry(() =>
    apiFootball<{
      response: Array<{
        fixture: { id: number; date: string };
        teams: {
          home: { id: number; name: string };
          away: { id: number; name: string };
        };
        goals: { home: number | null; away: number | null };
      }>;
    }>("/fixtures", { league: leagueId, season, status: "FT", last: 250 }, 60 * 20)
  );

  const fixtures = leagueFix.response ?? [];

  // Map team -> fixtures
  const teamToFixtures = new Map<number, typeof fixtures>();

  for (const fx of fixtures) {
    const h = fx.teams.home.id;
    const a = fx.teams.away.id;
    if (!teamToFixtures.has(h)) teamToFixtures.set(h, []);
    if (!teamToFixtures.has(a)) teamToFixtures.set(a, []);
    teamToFixtures.get(h)!.push(fx);
    teamToFixtures.get(a)!.push(fx);
  }

  // We limit stats calls HARD to avoid blank pages:
  // only fetch stats for first N unique fixtures in this league
  const MAX_STATS_FIXTURES_PER_LEAGUE = 12;

  const wantedFixtureIds: number[] = [];
  const seen = new Set<number>();

  for (const team of teamList) {
    const list = teamToFixtures.get(team.id) ?? [];
    for (const fx of list.slice(0, columns)) {
      if (!seen.has(fx.fixture.id)) {
        seen.add(fx.fixture.id);
        wantedFixtureIds.push(fx.fixture.id);
      }
      if (wantedFixtureIds.length >= MAX_STATS_FIXTURES_PER_LEAGUE) break;
    }
    if (wantedFixtureIds.length >= MAX_STATS_FIXTURES_PER_LEAGUE) break;
  }

  const statsByFixture = new Map<
    number,
    Array<{ team: { id: number }; statistics: Array<{ type: string; value: number | null }> }>
  >();

  // Fetch stats sequentially (slow but safe)
  for (let i = 0; i < wantedFixtureIds.length; i++) {
    const fixtureId = wantedFixtureIds[i];
    await sleep(250); // spacing prevents rate limit spikes

    try {
      const stats = await withRetry(() =>
        apiFootball<{
          response: Array<{
            team: { id: number };
            statistics: Array<{ type: string; value: number | null }>;
          }>;
        }>("/fixtures/statistics", { fixture: fixtureId }, 60 * 60 * 6)
      );

      statsByFixture.set(fixtureId, stats.response ?? []);
    } catch {
      statsByFixture.set(fixtureId, []);
    }
  }

  // Build rows
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

      // Stats may be missing (if fixture not in our capped stats set)
      const perTeamStats =
        statsByFixture.get(fx.fixture.id)?.find((s) => s.team.id === team.id)?.statistics ?? [];

      const corners = getStatValue(perTeamStats, "Corner Kicks");
      const yellows = getStatValue(perTeamStats, "Yellow Cards");
      const reds = getStatValue(perTeamStats, "Red Cards");

      const ck = typeof corners === "number" ? corners : undefined;
      const c =
        (typeof yellows === "number" ? yellows : 0) + (typeof reds === "number" ? reds : 0);

      cells.push({
        fixtureId: fx.fixture.id,
        opponent,
        homeAway,
        g: goalsFor,
        ck,
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
