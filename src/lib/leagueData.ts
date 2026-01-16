import { apiGet, type ApiResult } from "./apifootball";
import { LEAGUES, type LeagueConfig } from "./leagues";

/* ---------------- API TYPES ---------------- */

type ApiLeagueResp = {
  response: { seasons: { year: number; current: boolean }[] }[];
};

type ApiTeamsResp = {
  response: { team: { id: number; name: string; logo: string } }[];
};

type FixtureRow = {
  fixture: { id: number; date: string; status?: { short?: string } };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
};

type ApiLeagueFixturesResp = {
  response: FixtureRow[];
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

  // combined totals
  goalsTotal: number;            // home + away
  cornersTotal: number | null;   // home + away
  cardsTotal: number | null;     // (yellow+red) home + away
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

function getTeamStat(stats: ApiFixtureStatsResp["response"], teamId: number, type: string): number {
  const block = stats.find((x) => x.team.id === teamId);
  if (!block) return 0;
  const s = block.statistics.find((x) => x.type === type);
  return statToNumber(s?.value);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
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

/* ---------------- STATS FETCH ---------------- */

// Cache per request
const fixtureStatsCache = new Map<number, ApiFixtureStatsResp | null>();

async function getFixtureStatsWithRetry(fixtureId: number): Promise<ApiFixtureStatsResp | null> {
  if (fixtureStatsCache.has(fixtureId)) return fixtureStatsCache.get(fixtureId)!;

  const maxTries = 8;

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    // slow down (burst control)
    await sleep(600);

    const r = await apiGet<ApiFixtureStatsResp>(
      "/fixtures/statistics",
      { fixture: fixtureId },
      { noStore: true }
    );

    if (r.ok) {
      fixtureStatsCache.set(fixtureId, r.data);
      return r.data;
    }

    const err = pickError(r);
    const msg = err.toLowerCase();
    const isRate =
      msg.includes("rate") ||
      msg.includes("too many") ||
      msg.includes("exceeded");

    // If rate-limited, back off and try again (do NOT cache null yet)
    if (isRate && attempt < maxTries) {
      await sleep(900 * attempt);
      continue;
    }

    // Non-rate error: cache null and stop
    fixtureStatsCache.set(fixtureId, null);
    return null;
  }

  // After max tries, cache null (prevents infinite loops in one request)
  fixtureStatsCache.set(fixtureId, null);
  return null;
}

/* ---------------- API CALLS ---------------- */

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

async function getRecentLeagueFixtures(
  leagueId: number,
  season: number
): Promise<ApiResult<ApiLeagueFixturesResp>> {
  // BIGGER PULL so every team can get 7
  return apiGet<ApiLeagueFixturesResp>(
    "/fixtures",
    { league: leagueId, season, status: "FT", last: 1000 },
    { noStore: true }
  );
}

async function getRecentTeamFixtures(
  leagueId: number,
  season: number,
  teamId: number
): Promise<ApiResult<ApiLeagueFixturesResp>> {
  // Fallback ONLY for teams missing matches
  return apiGet<ApiLeagueFixturesResp>(
    "/fixtures",
    { league: leagueId, season, team: teamId, status: "FT", last: 20 },
    { noStore: true }
  );
}

/* ---------------- BUILD ---------------- */

export async function getLeagueBoards(): Promise<LeagueBoardData[]> {
  fixtureStatsCache.clear();
  return Promise.all(LEAGUES.map(getLeagueBoard));
}

async function getLeagueBoard(league: LeagueConfig): Promise<LeagueBoardData> {
  const seasonRes = await getCurrentSeason(league.id);
  if (!seasonRes.ok) {
    return { leagueId: league.id, leagueName: league.name, teams: [], error: pickError(seasonRes) };
  }

  const season = seasonRes.data;

  const teamsRes = await getTeams(league.id, season);
  if (!teamsRes.ok) {
    return { leagueId: league.id, leagueName: league.name, seasonUsed: season, teams: [], error: pickError(teamsRes) };
  }

  const fxRes = await getRecentLeagueFixtures(league.id, season);
  if (!fxRes.ok) {
    return { leagueId: league.id, leagueName: league.name, seasonUsed: season, teams: [], error: pickError(fxRes) };
  }

  const allFixtures = (fxRes.data.response ?? []).slice();
  allFixtures.sort((a, b) => (a.fixture.date < b.fixture.date ? 1 : -1));

  const teams = teamsRes.data.response ?? [];

  // last 7 per team (from league fixtures)
  const teamMatches = new Map<number, FixtureRow[]>();
  for (const t of teams) teamMatches.set(t.team.id, []);

  for (const f of allFixtures) {
    const homeId = f.teams.home.id;
    const awayId = f.teams.away.id;

    const hList = teamMatches.get(homeId);
    if (hList && hList.length < 7) hList.push(f);

    const aList = teamMatches.get(awayId);
    if (aList && aList.length < 7) aList.push(f);
  }

  // ✅ Fallback: any team still missing matches gets a team-specific pull
  const missing = teams
    .map((t) => t.team.id)
    .filter((id) => (teamMatches.get(id)?.length ?? 0) < 7);

  if (missing.length > 0) {
    // Do these sequentially to avoid spikes
    for (const teamId of missing) {
      const r = await getRecentTeamFixtures(league.id, season, teamId);
      if (!r.ok) continue;

      const list = (r.data.response ?? []).slice().sort((a, b) => (a.fixture.date < b.fixture.date ? 1 : -1));

      const picked: FixtureRow[] = [];
      for (const f of list) {
        const isInThisTeam = f.teams.home.id === teamId || f.teams.away.id === teamId;
        if (!isInThisTeam) continue;
        picked.push(f);
        if (picked.length >= 7) break;
      }

      teamMatches.set(teamId, picked);
      await sleep(250);
    }
  }

  // Gather UNIQUE fixtures shown
  const neededFixtureIds = new Set<number>();
  for (const list of teamMatches.values()) {
    for (const f of list) neededFixtureIds.add(f.fixture.id);
  }

  const uniqueIds = Array.from(neededFixtureIds);

  // Fetch stats slowly (limit=1) so rateLimit stops happening
  await mapLimit(uniqueIds, 1, async (id) => {
    await getFixtureStatsWithRetry(id);
    return null;
  });

  // Build output
  const rows: TeamRow[] = teams.map((t) => {
    const list = teamMatches.get(t.team.id) ?? [];

    const matches: MatchRow[] = list.map((f) => {
      const isHome = f.teams.home.id === t.team.id;
      const opponent = isHome ? f.teams.away.name : f.teams.home.name;

      const homeGoals = f.goals.home ?? 0;
      const awayGoals = f.goals.away ?? 0;

      const stats = fixtureStatsCache.get(f.fixture.id) ?? null;

      let cornersTotal: number | null = null;
      let cardsTotal: number | null = null;

      if (stats) {
        const homeId = f.teams.home.id;
        const awayId = f.teams.away.id;

        const homeCorners = getTeamStat(stats.response, homeId, "Corner Kicks");
        const awayCorners = getTeamStat(stats.response, awayId, "Corner Kicks");
        cornersTotal = homeCorners + awayCorners;

        const homeY = getTeamStat(stats.response, homeId, "Yellow Cards");
        const homeR = getTeamStat(stats.response, homeId, "Red Cards");
        const awayY = getTeamStat(stats.response, awayId, "Yellow Cards");
        const awayR = getTeamStat(stats.response, awayId, "Red Cards");
        cardsTotal = (homeY + homeR) + (awayY + awayR);
      }

      return {
        fixtureId: f.fixture.id,
        date: f.fixture.date,
        opponent,
        isHome,
        goalsTotal: homeGoals + awayGoals,
        cornersTotal,
        cardsTotal,
      };
    });

    return {
      teamId: t.team.id,
      name: t.team.name,
      logo: t.team.logo,
      matches,
    };
  });

  return {
    leagueId: league.id,
    leagueName: league.name,
    seasonUsed: season,
    teams: rows,
  };
}
