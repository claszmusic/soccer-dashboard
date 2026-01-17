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
  league: { id: number; name: string; season: number };
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

function pickCornerValue(stats: StatisticsResponse): number | null {
  const vals: number[] = [];
  for (const s of stats || []) {
    const v = s.statistics.find(x => x.type === "Corner Kicks")?.value;
    if (typeof v === "number") vals.push(v);
    if (typeof v === "string" && !isNaN(Number(v))) vals.push(Number(v));
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0);
}

function countCards(events: EventResponse): number | null {
  if (!Array.isArray(events)) return null;
  return events.length;
}

export async function buildAllBoards() {
  const leagues = [
    { leagueId: 39, leagueName: "Premier League", season: 2025 },
    { leagueId: 140, leagueName: "La Liga", season: 2025 },
    { leagueId: 135, leagueName: "Serie A", season: 2025 },
    { leagueId: 78, leagueName: "Bundesliga", season: 2025 },
    { leagueId: 262, leagueName: "Liga MX", season: 2025 }
  ];

  const boards: LeagueBoard[] = [];

  for (const l of leagues) {
    const teams = await apiFootball<TeamResponse[]>("/teams", {
      league: l.leagueId,
      season: l.season
    });

    const fixtures = await apiFootball<FixtureResponse[]>("/fixtures", {
      league: l.leagueId,
      season: l.season,
      last: 300
    });

    const finished = fixtures.filter(f => isFinished(f.fixture.status.short));

    const teamBoards: TeamBoard[] = [];

    for (const t of teams) {
      const matches = finished
        .filter(f => f.teams.home.id === t.team.id || f.teams.away.id === t.team.id)
        .slice(0, 7);

      const cards = await Promise.all(matches.map(async fx => {
        const stats = await apiFootball<StatisticsResponse>("/fixtures/statistics", { fixture: fx.fixture.id });
        const events = await apiFootball<EventResponse>("/fixtures/events", { fixture: fx.fixture.id, type: "Card" });

        return {
          fixtureId: fx.fixture.id,
          date: fx.fixture.date,
          opponent: fx.teams.home.id === t.team.id ? fx.teams.away.name : fx.teams.home.name,
          isHome: fx.teams.home.id === t.team.id,
          goalsTotal: (fx.goals.home ?? 0) + (fx.goals.away ?? 0),
          cornersTotal: pickCornerValue(stats),
          cardsTotal: countCards(events)
        };
      }));

      teamBoards.push({
        teamId: t.team.id,
        name: t.team.name,
        logo: t.team.logo,
        matches: cards
      });
    }

    boards.push({
      leagueId: l.leagueId,
      leagueName: l.leagueName,
      seasonUsed: l.season,
      teams: teamBoards
    });
  }

  return {
    updatedAt: new Date().toISOString(),
    boards
  };
}
