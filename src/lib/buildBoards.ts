// src/lib/buildBoards.ts
import { apiFootball } from "./apifootball";

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
  seasonUsed: number;
  teams: TeamBoard[];
};

type TeamResponse = {
  team: { id: number; name: string; logo: string };
};

type FixtureResponse = {
  fixture: { id: number; date: string; status: { short: string } };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
};

type StatisticsResponse = Array<{
  team: { id: number; name: string };
  statistics: Array<{ type: string; value: number | string | null }>;
}>;

type EventResponse = Array<{
  type: string;
  detail: string;
  team: { id: number; name: string };
}>;

function isFinished(short: string) {
  return ["FT", "AET", "PEN"].includes(short);
}

function toNum(v: number | string | null | undefined): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}

function cornersTotalFromStats(stats: StatisticsResponse): number | null {
  const vals: number[] = [];
  for (const side of stats || []) {
    const item = (side.statistics || []).find((x) => x.type === "Corner Kicks");
    const n = toNum(item?.value ?? null);
    if (n !== null) vals.push(n);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0);
}

function cardsTotalFromEvents(events: EventResponse): number | null {
  if (!Array.isArray(events)) return null;
  // We call /fixtures/events with type=Card, so each item is a card
  return events.length;
}

export async function buildAllBoards(): Promise<{ updatedAt: string; boards: LeagueBoard[] }> {
  // You can change seasons later; we just need this to compile + run.
  const leagues = [
    { leagueId: 39, leagueName: "Premier League", season: 2025 },
    { leagueId: 140, leagueName: "La Liga", season: 2025 },
    { leagueId: 135, leagueName: "Serie A", season: 2025 },
    { leagueId: 78, leagueName: "Bundesliga", season: 2025 },
    { leagueId: 262, leagueName: "Liga MX", season: 2025 },
  ];

  const boards: LeagueBoard[] = [];

  for (const l of leagues) {
    const teamsResp = await apiFootball<TeamResponse[]>("/teams", {
      league: l.leagueId,
      season: l.season,
    });

    const fixturesResp = await apiFootball<FixtureResponse[]>("/fixtures", {
      league: l.leagueId,
      season: l.season,
      last: 300,
    });

    const finished = (fixturesResp || [])
      .filter((f) => isFinished(f.fixture.status.short))
      .sort((a, b) => (a.fixture.date < b.fixture.date ? 1 : -1)); // newest first

    const teams: TeamBoard[] = [];

    for (const t of teamsResp) {
      const teamId = t.team.id;

      const last7 = finished
        .filter((f) => f.teams.home.id === teamId || f.teams.away.id === teamId)
        .slice(0, 7);

      const matches: MatchCard[] = await Promise.all(
        last7.map(async (fx) => {
          const fixtureId = fx.fixture.id;

          const goalsHome = typeof fx.goals.home === "number" ? fx.goals.home : 0;
          const goalsAway = typeof fx.goals.away === "number" ? fx.goals.away : 0;

          const isHome = fx.teams.home.id === teamId;
          const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;

          // corners + cards from extra endpoints
          const [stats, events] = await Promise.all([
            apiFootball<StatisticsResponse>("/fixtures/statistics", { fixture: fixtureId }).catch(() => [] as StatisticsResponse),
            apiFootball<EventResponse>("/fixtures/events", { fixture: fixtureId, type: "Card" }).catch(() => [] as EventResponse),
          ]);

          return {
            fixtureId,
            date: fx.fixture.date,
            opponent,
            isHome,
            goalsTotal: goalsHome + goalsAway,
            cornersTotal: cornersTotalFromStats(stats),
            cardsTotal: cardsTotalFromEvents(events),
          };
        })
      );

      teams.push({
        teamId,
        name: t.team.name,
        logo: t.team.logo,
        matches,
      });
    }

    boards.push({
      leagueId: l.leagueId,
      leagueName: l.leagueName,
      seasonUsed: l.season,
      teams,
    });
  }

  return {
    updatedAt: new Date().toISOString(),
    boards,
  };
}
