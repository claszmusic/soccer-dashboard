import "server-only";

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

const CSV_URL = process.env.SHEET_CSV_URL!;

function parseCSV(text: string): string[][] {
  return text
    .trim()
    .split("\n")
    .map((l) =>
      l
        .split(",")
        .map((v) => v.replace(/^"|"$/g, "").trim())
    );
}

export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  if (!CSV_URL) throw new Error("Missing SHEET_CSV_URL env var");

  const res = await fetch(CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch CSV");

  const csv = await res.text();
  const rows = parseCSV(csv);

  const header = rows.shift(); // remove header row

  const leagues = new Map<number, LeagueBoard>();

  for (const r of rows) {
    const [
      leagueId,
      leagueName,
      teamId,
      teamName,
      fixtureId,
      date,
      opponent,
      isHome,
      goalsTotal,
      cornersTotal,
      cardsTotal,
    ] = r;

    const lid = Number(leagueId);
    const tid = Number(teamId);

    if (!leagues.has(lid)) {
      leagues.set(lid, {
        leagueId: lid,
        leagueName,
        seasonUsed: new Date(date).getFullYear(),
        teams: [],
      });
    }

    const league = leagues.get(lid)!;

    let team = league.teams.find((t) => t.teamId === tid);
    if (!team) {
      team = {
        teamId: tid,
        name: teamName,
        logo: `https://media.api-sports.io/football/teams/${tid}.png`,
        matches: [],
      };
      league.teams.push(team);
    }

    team.matches.push({
      fixtureId: Number(fixtureId),
      date,
      opponent,
      isHome: isHome === "TRUE",
      goalsTotal: goalsTotal ? Number(goalsTotal) : null,
      cornersTotal: cornersTotal ? Number(cornersTotal) : null,
      cardsTotal: cardsTotal ? Number(cardsTotal) : null,
    });
  }

  // sort & cut to last 7
  for (const league of leagues.values()) {
    for (const team of league.teams) {
      team.matches.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      team.matches = team.matches.slice(0, 7);
    }

    // sort teams alphabetically
    league.teams.sort((a, b) => a.name.localeCompare(b.name));
  }

  return Array.from(leagues.values()).sort(
    (a, b) => a.leagueName.localeCompare(b.leagueName)
  );
}
