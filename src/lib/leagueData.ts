// src/lib/leagueData.ts
// FINAL STABLE VERSION — no missing teams

export type MatchCard = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;
  goalsTotal: number | null;
  cornersTotal: number | null;
  cardsTotal: number | null;
};

export type TeamBoard = {
  teamId: number;
  name: string;
  logo: string;
  matches: MatchCard[];
};

export type LeagueBoard = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  error?: string;
  teams: TeamBoard[];
};

const LEAGUES = [
  { leagueId: 262, leagueName: "Liga MX" },
  { leagueId: 39, leagueName: "Premier League" },
  { leagueId: 78, leagueName: "Bundesliga" },
  { leagueId: 140, leagueName: "La Liga" },
  { leagueId: 135, leagueName: "Serie A" },
];

const API_BASE = "https://v3.football.api-sports.io";
const FINISHED = new Set(["FT", "AET", "PEN"]);

// ---------------- utils ----------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function toQS(params: Record<string, any>) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) usp.set(k, String(v));
  });
  return usp.toString() ? `?${usp}` : "";
}

// ---------------- fetch wrapper ----------------
async function apiFetch<T>(path: string, params: Record<string, any>) {
  const apiKey =
    process.env.APISPORTS_KEY ||
    process.env.APISPORTS_API_KEY ||
    process.env.APISPORTSKEY;

  if (!apiKey) return { ok: false, data: null };

  const url = `${API_BASE}${path}${toQS(params)}`;

  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, {
      headers: { "x-apisports-key": apiKey },
      next: { revalidate: 600 },
    });

    if (r.status === 429) {
      await sleep(1000 * (i + 1));
      continue;
    }

    if (!r.ok) return { ok: false, data: null };

    return { ok: true, data: (await r.json()) as T };
  }

  return { ok: false, data: null };
}

// ---------------- API types ----------------
type ApiLeaguesResp = {
  response: { seasons: { year: number; current: boolean }[] }[];
};

type ApiTeamsResp = {
  response: { team: { id: number; name: string; logo: string } }[];
};

type ApiFixturesResp = {
  response: {
    fixture: { id: number; date: string; status: { short: string } };
    teams: { home: { id: number; name: string }; away: { id: number; name: string } };
    goals: { home: number | null; away: number | null };
  }[];
};

type ApiStatsResp = {
  response: {
    statistics: { type: string; value: number | string | null }[];
  }[];
};

type ApiEventsResp = {
  response: { type: string; detail: string }[];
};

// ---------------- helpers ----------------
function blankMatch(): MatchCard {
  return {
    fixtureId: 0,
    date: "",
    opponent: "-",
    isHome: true,
    goalsTotal: null,
    cornersTotal: null,
    cardsTotal: null,
  };
}

function statNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getCurrentSeason(leagueId: number) {
  const r = await apiFetch<ApiLeaguesResp>("/leagues", { id: leagueId });
  if (!r.ok) return null;

  const seasons = r.data.response[0]?.seasons ?? [];
  return seasons.find(s => s.current)?.year ?? seasons[0]?.year ?? null;
}

async function getTeams(leagueId: number, season: number) {
  const r = await apiFetch<ApiTeamsResp>("/teams", { league: leagueId, season });
  if (!r.ok) return null;

  return r.data.response.map(x => ({
    teamId: x.team.id,
    name: x.team.name,
    logo: x.team.logo,
    matches: [],
  }));
}

async function getLeagueFixtures(leagueId: number, season: number) {
  const r = await apiFetch<ApiFixturesResp>(
    "/fixtures",
    { league: leagueId, season, status: "FT", last: 800 }
  );

  if (r.ok && r.data.response.length) return r.data.response;

  const fallback = await apiFetch<ApiFixturesResp>(
    "/fixtures",
    { league: leagueId, season, last: 800 }
  );

  if (!fallback.ok) return [];

  return fallback.data.response.filter(f =>
    FINISHED.has(f.fixture.status.short)
  );
}

async function getCornersTotal(fixture: number) {
  const r = await apiFetch<ApiStatsResp>("/fixtures/statistics", { fixture });
  if (!r.ok) return null;

  const vals = r.data.response.map(r =>
    statNumber(r.statistics.find(s => s.type === "Corner Kicks")?.value)
  );

  return vals.some(v => v !== null) ? vals.reduce((a, b) => a + (b ?? 0), 0) : null;
}

async function getCardsTotal(fixture: number) {
  const r = await apiFetch<ApiEventsResp>("/fixtures/events", { fixture });
  if (!r.ok) return null;

  let y = 0, red = 0;
  for (const e of r.data.response) {
    if (e.type !== "Card") continue;
    const d = e.detail.toLowerCase();
    if (d.includes("yellow")) y++;
    if (d.includes("red")) red++;
  }
  return y + red;
}

// ---------------- MAIN ----------------
export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  const out: LeagueBoard[] = [];

  for (const league of LEAGUES) {
    const season = await getCurrentSeason(league.leagueId);
    if (!season) continue;

    const teams = await getTeams(league.leagueId, season);
    if (!teams) continue;

    const fixtures = await getLeagueFixtures(league.leagueId, season);

    const fixtureData = new Map<number, { c: number | null; ca: number | null }>();

    for (const team of teams) {
      const teamFx = fixtures.filter(
        f => f.teams.home.id === team.teamId || f.teams.away.id === team.teamId
      ).slice(0, 7);

      const matches: MatchCard[] = [];

      for (const fx of teamFx) {
        if (!fixtureData.has(fx.fixture.id)) {
          await sleep(250);
          const c = await getCornersTotal(fx.fixture.id);
          const ca = await getCardsTotal(fx.fixture.id);
          fixtureData.set(fx.fixture.id, { c, ca });
        }

        const d = fixtureData.get(fx.fixture.id)!;

        const isHome = team.teamId === fx.teams.home.id;
        const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;

        matches.push({
          fixtureId: fx.fixture.id,
          date: fx.fixture.date,
          opponent,
          isHome,
          goalsTotal: (fx.goals.home ?? 0) + (fx.goals.away ?? 0),
          cornersTotal: d.c,
          cardsTotal: d.ca,
        });
      }

      while (matches.length < 7) matches.push(blankMatch());

      team.matches = matches;
    }

    out.push({
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      seasonUsed: season,
      teams,
    });
  }

  return out;
}
