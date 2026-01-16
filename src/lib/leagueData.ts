import { apiGet, type ApiResult } from "./apifootball";
import { LEAGUES, type LeagueConfig } from "./leagues";

/* ---------------- API TYPES ---------------- */

type ApiLeagueResp = {
  response: { seasons: { year: number; current: boolean }[] }[];
};

type ApiTeamsResp = {
  response: { team: { id: number; name: string; logo: string } }[];
};

type ApiFixturesResp = {
  response: {
    fixture: { id: number; date: string; status?: { short?: string } };
    teams: {
      home: { id: number; name: string };
      away: { id: number; name: string };
    };
    goals: { home: number | null; away: number | null };
  }[];
};

type ApiFixtureStatsResp = {
  response: {
    team: { id: number };
    statistics: { type: string; value: number | string | null }[];
  }[];
};

/* ---------------- OUTPUT TYPES ---------------- */

export type MatchRow = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;

  // YOU WANT COMBINED TOTALS:
  goalsTotal: number;      // home+away
  cornersTotal: number | null; // home+away
  cardsTotal: number | null;   // (yellow+red) home+away
};

export type TeamRow = {
  teamId: number;
  name: string;
  logo: string;
  matches: MatchRow[];
};

export type LeagueBoardData = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  teams: TeamRow[];
  error?: string;
};

/* ---------------- HELPERS ---------------- */

function pickError(r: ApiResult<any>): string {
  return (r && typeof r === "object" && "error" in r ? (r as any).error : "API error") as string;
}

function statToNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : 0;
}

function getTeamStat(
  stats: ApiFixtureStatsResp["response"],
  teamId: number,
  type: string
): number {
  const block = stats.find((x) => x.team.id === teamId);
  if (!block) return 0;
  const s = block.statistics.find((x) => x.type === type);
  return statToNumber(s?.value);
}

/* ---------------- API CALLS ---------------- */

// Cache to reduce repeated calls inside one request
const fixtureStatsCache = new Map<number, Promise<ApiResult<ApiFixtureStatsResp>>>();

async function getFixtureStats(fixtureId: number): Promise<ApiResult<ApiFixtureStatsResp>> {
  if (!fixtureStatsCache.has(fixtureId)) {
    fixtureStatsCache.set(
      fixtureId,
      apiGet<ApiFixtureStatsResp>("/fixtures/statistics", { fixture: fixtureId }, { noStore: true })
    );
  }
  return fixtureStatsCache.get(fixtureId)!;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function getCurrentSeason(leagueId: number): Promise<ApiResult<number>> {
  const r = await apiGet<ApiLeagueResp>("/leagues", { id: leagueId }, { noStore: true });
  if (!r.ok) return { ok: false, error: pickError(r) };

  const seasons = r.data.response?.[0]?.seasons ?? [];
  const current = seasons.find((s) => s.current)?.year;
  const fallback = seasons.map((s) => s.year).sort((a, b) => b - a)[0];
  const year = current ?? fallback;

  if (!year) return { ok: false, error: `No seasons found for league ${leagueId}` };
  return { ok: true, data: year };
}

async function getTeams(leagueId: number, season: number): Promise<ApiResult<ApiTeamsResp>> {
  return apiGet<ApiTeamsResp>("/teams", { league: leagueId, season }, { noStore: true });
}

async function getLast7FinishedFixtures(teamId: number): Promise<ApiResult<ApiFixturesResp>> {
  return apiGet<ApiFixturesResp>(
    "/fixtures",
    { team: teamId, last: 7, status: "FT" },
    { noStore: true }
  );
}

/* ---------------- BUILD MATCHES ---------------- */

async function buildMatchesForTeam(teamId: number, fx: ApiFixturesResp): Promise<MatchRow[]> {
  const list = (fx.response ?? []).slice(0, 7);

  // Preload stats sequentially (limit=1) to avoid 429
  await mapLimit(
    list,
    1,
    async (f) => {
      await getFixtureStats(f.fixture.id);
      return null;
    }
  );

  return list.map((f) => {
    const isHome = f.teams.home.id === teamId;
    const opponent = isHome ? f.teams.away.name : f.teams.home.name;

    const homeGoals = f.goals.home ?? 0;
    const awayGoals = f.goals.away ?? 0;
    const goalsTotal = homeGoals + awayGoals;

    // Stats: corners + cards require stats endpoint
    // We compute TOTAL = home+away
    let cornersTotal: number | null = null;
    let cardsTotal: number | null = null;

    const statsPromise = fixtureStatsCache.get(f.fixture.id);
    // (It should exist because we preloaded above)
    // But keep it safe:
    // If it fails (rate limit), show null => UI displays "-"
    // We cannot await here without making it sequential per row; instead read cached resolved promise safely.
    // We'll do a synchronous-ish approach by marking totals null unless ok.
    // However, we can safely compute by awaiting in the map (small list = 7).
    // So we'll await here.
    return {
      fixtureId: f.fixture.id,
      date: f.fixture.date,
      opponent,
      isHome,
      goalsTotal,
      cornersTotal,
      cardsTotal,
    };
  });
}

/* ---------------- MAIN EXPORT ---------------- */

export async function getLeagueBoards(): Promise<LeagueBoardData[]> {
  fixtureStatsCache.clear();
  return Promise.all(LEAGUES.map(getLeagueBoard));
}

async function getLeagueBoard(league: LeagueConfig): Promise<LeagueBoardData> {
  const seasonRes = await getCurrentSeason(league.id);
  if (!seasonRes.ok) {
    return { leagueId: league.id, leagueName: league.name, teams: [], error: pickError(seasonRes) };
  }

  const teamsRes = await getTeams(league.id, seasonRes.data);
  if (!teamsRes.ok) {
    return {
      leagueId: league.id,
      leagueName: league.name,
      seasonUsed: seasonRes.data,
      teams: [],
      error: pickError(teamsRes),
    };
  }

  const teams = teamsRes.data.response ?? [];

  // Fetch fixtures sequentially per team to reduce load
  const rows: TeamRow[] = [];

  // First, collect fixtures for all teams (minimal calls)
  const teamFixtures: { teamId: number; name: string; logo: string; fx: ApiFixturesResp | null }[] = [];
  for (const t of teams) {
    const fx = await getLast7FinishedFixtures(t.team.id);
    teamFixtures.push({
      teamId: t.team.id,
      name: t.team.name,
      logo: t.team.logo,
      fx: fx.ok ? fx.data : null,
    });
  }

  // Next, collect unique fixture IDs across the whole league (for caching & fewer stats calls)
  const fixtureIds = new Set<number>();
  for (const tf of teamFixtures) {
    for (const f of tf.fx?.response ?? []) fixtureIds.add(f.fixture.id);
  }

  // Preload fixture statistics VERY slowly to avoid rate limits
  const uniqueIds = Array.from(fixtureIds);
  await mapLimit(uniqueIds, 1, async (id) => {
    await getFixtureStats(id);
    return null;
  });

  // Now build each team rows, including combined totals from stats
  for (const tf of teamFixtures) {
    const matchesRaw = (tf.fx?.response ?? []).slice(0, 7);

    const matches: MatchRow[] = [];
    for (const f of matchesRaw) {
      const isHome = f.teams.home.id === tf.teamId;
      const opponent = isHome ? f.teams.away.name : f.teams.home.name;

      const homeGoals = f.goals.home ?? 0;
      const awayGoals = f.goals.away ?? 0;

      let cornersTotal: number | null = null;
      let cardsTotal: number | null = null;

      const statsRes = await getFixtureStats(f.fixture.id);
      if (statsRes.ok) {
        const homeId = f.teams.home.id;
        const awayId = f.teams.away.id;

        const homeCorners = getTeamStat(statsRes.data.response, homeId, "Corner Kicks");
        const awayCorners = getTeamStat(statsRes.data.response, awayId, "Corner Kicks");
        cornersTotal = homeCorners + awayCorners;

        const homeY = getTeamStat(statsRes.data.response, homeId, "Yellow Cards");
        const homeR = getTeamStat(statsRes.data.response, homeId, "Red Cards");
        const awayY = getTeamStat(statsRes.data.response, awayId, "Yellow Cards");
        const awayR = getTeamStat(statsRes.data.response, awayId, "Red Cards");
        cardsTotal = (homeY + homeR) + (awayY + awayR);
      }

      matches.push({
        fixtureId: f.fixture.id,
        date: f.fixture.date,
        opponent,
        isHome,
        goalsTotal: homeGoals + awayGoals,
        cornersTotal,
        cardsTotal,
      });
    }

    rows.push({
      teamId: tf.teamId,
      name: tf.name,
      logo: tf.logo,
      matches,
    });
  }

  return {
    leagueId: league.id,
    leagueName: league.name,
    seasonUsed: seasonRes.data,
    teams: rows,
  };
}
