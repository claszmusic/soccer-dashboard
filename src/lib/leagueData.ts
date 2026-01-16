import { apiFootball } from "./apifootball";

export type MatchCell = {
  fixtureId?: number;
  opponent?: string; // "Monterrey (H)"
  ck?: number; // TOTAL corners (home+away)
  g?: number; // TOTAL goals (home+away)
  c?: number; // TOTAL cards (home+away)
};

export type LeagueBoard = {
  leagueTitle: string;
  season: number;
  rows: Array<{
    teamId: number;
    teamName: string;
    cells: MatchCell[]; // always 7
  }>;
  error?: string; // <-- so UI can show what happened
};

function n(v: any) {
  return typeof v === "number" ? v : 0;
}
function stat(stats: Array<{ type: string; value: number | null }>, type: string) {
  const v = stats.find((s) => s.type === type)?.value;
  return typeof v === "number" ? v : 0;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<{ ok: true; data: T } | { ok: false; err: string; data: T }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e: any) {
    return { ok: false, err: e?.message ?? String(e), data: fallback };
  }
}

async function resolveLeagueAndSeason(leagueName: string, country: string) {
  const leagues = await apiFootball<{
    response: Array<{
      league: { id: number; name: string };
      seasons?: Array<{ year: number; current?: boolean }>;
    }>;
  }>("/leagues", { name: leagueName, country }, 60 * 60 * 12);

  const item = leagues.response?.[0];
  const leagueId = item?.league?.id;
  const seasons = item?.seasons ?? [];

  const current = seasons.find((s) => s.current);
  const allYears = seasons.map((s) => s.year).sort((a, b) => b - a);
  const seasonYear = current?.year ?? allYears[0] ?? new Date().getFullYear();
  const seasonCandidates = [seasonYear, ...allYears.filter((y) => y !== seasonYear)].slice(0, 6);

  if (!leagueId) return null;
  return { leagueId, seasonYear, seasonCandidates };
}

async function getLastFTFixturesWithFallback(opts: {
  teamId: number;
  seasonCandidates: number[];
  columns: number;
}) {
  const { teamId, seasonCandidates, columns } = opts;

  for (const y of seasonCandidates) {
    const fx = await apiFootball<{
      response: Array<{
        fixture: { id: number };
        teams: { home: { id: number; name: string }; away: { id: number; name: string } };
        goals: { home: number | null; away: number | null };
      }>;
    }>("/fixtures", { team: teamId, season: y, status: "FT", last: columns }, 60 * 5);

    if ((fx.response ?? []).length > 0) return fx.response;
  }
  return [];
}

export async function buildLeagueBoard(opts: {
  leagueName: string;
  country: string;
  columns?: number;
}): Promise<LeagueBoard> {
  const { leagueName, country, columns = 7 } = opts;

  // default empty board (never crash)
  const empty: LeagueBoard = {
    leagueTitle: leagueName,
    season: new Date().getFullYear(),
    rows: [],
  };

  const resolvedWrap = await safe(async () => resolveLeagueAndSeason(leagueName, country), null as any);
  const resolved = resolvedWrap.data;

  if (!resolved) {
    return { ...empty, error: resolvedWrap.ok ? "League not found from API" : resolvedWrap.err };
  }

  const { leagueId, seasonYear, seasonCandidates } = resolved;

  const teamsWrap = await safe(async () => {
    return await apiFootball<{ response: Array<{ team: { id: number; name: string } }> }>("/teams", { league: leagueId, season: seasonYear }, 60 * 60 * 6);
  }, { response: [] as any[] });

  const teamList = (teamsWrap.data.response ?? []).map((t) => ({ id: t.team.id, name: t.team.name }));

  if (teamList.length === 0) {
    return { ...empty, season: seasonYear, error: teamsWrap.ok ? "No teams returned" : teamsWrap.err };
  }

  const rows: LeagueBoard["rows"] = [];

  for (const team of teamList) {
    const fixturesWrap = await safe(
      async () => getLastFTFixturesWithFallback({ teamId: team.id, seasonCandidates, columns }),
      [] as any[]
    );

    const fixtures = fixturesWrap.data ?? [];
    const cells: MatchCell[] = [];

    for (const fx of fixtures) {
      const fixtureId = fx.fixture?.id;
      const home = fx.teams?.home;
      const away = fx.teams?.away;
      if (!fixtureId || !home?.id || !away?.id) continue;

      const isHome = home.id === team.id;
      const opponent = `${isHome ? away.name : home.name} (${isHome ? "H" : "A"})`;
      const gTotal = n(fx.goals?.home) + n(fx.goals?.away);

      const statsWrap = await safe(async () => {
        return await apiFootball<{
          response: Array<{
            team: { id: number };
            statistics: Array<{ type: string; value: number | null }>;
          }>;
        }>("/fixtures/statistics", { fixture: fixtureId }, 60 * 60 * 6);
      }, { response: [] as any[] });

      const homeStats = statsWrap.data.response.find((s) => s.team.id === home.id)?.statistics ?? [];
      const awayStats = statsWrap.data.response.find((s) => s.team.id === away.id)?.statistics ?? [];

      const ckTotal = stat(homeStats, "Corner Kicks") + stat(awayStats, "Corner Kicks");
      const cTotal =
        (stat(homeStats, "Yellow Cards") + stat(homeStats, "Red Cards")) +
        (stat(awayStats, "Yellow Cards") + stat(awayStats, "Red Cards"));

      cells.push({ fixtureId, opponent, g: gTotal, ck: ckTotal, c: cTotal });
    }

    while (cells.length < columns) cells.push({});
    rows.push({ teamId: team.id, teamName: team.name, cells });
  }

  return { leagueTitle: leagueName, season: seasonYear, rows };
}
