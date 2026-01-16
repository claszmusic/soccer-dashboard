// src/lib/leagueData.ts

export type MatchCard = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;
  goalsTotal: number;
  cornersTotal: number;
  cardsTotal: number;
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
  teams: TeamBoard[];
  error?: string;
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function normalizeName(n: string) {
  return n
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function num(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bool(v: string) {
  return String(v).toLowerCase() === "true";
}

function blankMatch(): MatchCard {
  return {
    fixtureId: 0,
    date: "",
    opponent: "-",
    isHome: true,
    goalsTotal: 0,
    cornersTotal: 0,
    cardsTotal: 0,
  };
}

export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  try {
    const url = mustEnv("SHEET_CSV_URL");
    const csv = await fetch(url, { cache: "no-store" }).then(r => r.text());
    const table = parseCsv(csv);

    const h = table[0];
    const idx = (n: string) => h.indexOf(n);

    const rows = table.slice(1);

    const leagues = new Map<number, { name: string; teams: Map<string, TeamBoard> }>();

    for (const r of rows) {
      if (!r.length) continue;

      const leagueId = Number(r[idx("leagueId")]);
      const leagueName = r[idx("leagueName")];
      const teamId = Number(r[idx("teamId")]);
      const teamName = r[idx("teamName")];
      const key = normalizeName(teamName);

      const fixtureId = Number(r[idx("fixtureId")]);
      const date = r[idx("date")];
      const opponent = r[idx("opponent")];
      const isHome = bool(r[idx("isHome")]);

      if (!leagueId || !teamName || !fixtureId) continue;

      const goalsTotal = num(r[idx("goalsTotal")]);
      const cornersTotal = num(r[idx("cornersTotal")]);
      const cardsTotal = num(r[idx("cardsTotal")]);

      if (!leagues.has(leagueId)) {
        leagues.set(leagueId, { name: leagueName, teams: new Map() });
      }

      const L = leagues.get(leagueId)!;

      if (!L.teams.has(key)) {
        L.teams.set(key, {
          teamId,
          name: teamName,
          logo: "",
          matches: [],
        });
      }

      L.teams.get(key)!.matches.push({
        fixtureId,
        date,
        opponent,
        isHome,
        goalsTotal,
        cornersTotal,
        cardsTotal,
      });
    }

    const output: LeagueBoard[] = [];

    for (const [leagueId, L] of leagues.entries()) {
      const teams: TeamBoard[] = [];

      for (const T of L.teams.values()) {
        const dedup = new Map<number, MatchCard>();
        for (const m of T.matches) dedup.set(m.fixtureId, m);

        const sorted = Array.from(dedup.values()).sort(
          (a, b) => Date.parse(b.date) - Date.parse(a.date)
        );

        const last7 = sorted.slice(0, 7);
        while (last7.length < 7) last7.push(blankMatch());

        teams.push({ ...T, matches: last7 });
      }

      teams.sort((a, b) => a.name.localeCompare(b.name));

      output.push({
        leagueId,
        leagueName: L.name,
        teams,
      });
    }

    return output.sort((a, b) => a.leagueId - b.leagueId);
  } catch (e: any) {
    return [
      {
        leagueId: 0,
        leagueName: "Error",
        error: e.message,
        teams: [],
      },
    ];
  }
}
