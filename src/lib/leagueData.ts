// src/lib/leagueData.ts
// Data source: Google Sheets published CSV (SHEET_CSV_URL)
// Returns: LeagueBoard[] (same shape your UI already expects)
// Behavior: store everything in sheet, WEBSITE selects last 7 per team by date (newest first)

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
  logo: string; // CSV doesn’t include logos; UI should tolerate empty string
  matches: MatchCard[];
};

export type LeagueBoard = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  error?: string;
  teams: TeamBoard[];
};

type CsvRow = {
  leagueId: number;
  leagueName: string;
  teamId: number;
  teamName: string;
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;
  goalsTotal: number | null;
  cornersTotal: number | null;
  cardsTotal: number | null;
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

// Minimal CSV parser that handles quoted fields, commas, and newlines in quotes
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // Escaped quote
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    // not in quotes
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }

    if (c === "\r") {
      // ignore
      i++;
      continue;
    }

    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }

    field += c;
    i++;
  }

  // last field
  row.push(field);
  rows.push(row);

  // remove possible trailing empty row
  if (rows.length && rows[rows.length - 1].every((x) => x === "")) rows.pop();

  return rows;
}

function toNumOrNull(v: string): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toNumOr0(v: string): number {
  const s = (v ?? "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toBool(v: string): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function safeDateKey(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

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

async function fetchCsvText(): Promise<string> {
  const url = mustEnv("SHEET_CSV_URL");

  const r = await fetch(url, {
    cache: "no-store",
    headers: { "accept": "text/csv,*/*" },
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`CSV fetch failed ${r.status}: ${t || r.statusText}`);
  }

  return await r.text();
}

function csvToRows(csv: string): CsvRow[] {
  const table = parseCsv(csv);
  if (table.length < 2) return [];

  const header = table[0].map((h) => (h ?? "").trim());
  const idx = (name: string) => header.indexOf(name);

  const iLeagueId = idx("leagueId");
  const iLeagueName = idx("leagueName");
  const iTeamId = idx("teamId");
  const iTeamName = idx("teamName");
  const iFixtureId = idx("fixtureId");
  const iDate = idx("date");
  const iOpponent = idx("opponent");
  const iIsHome = idx("isHome");
  const iGoals = idx("goalsTotal");
  const iCorners = idx("cornersTotal");
  const iCards = idx("cardsTotal");

  // If header mismatch, return empty with safety
  const required = [
    iLeagueId, iLeagueName, iTeamId, iTeamName, iFixtureId,
    iDate, iOpponent, iIsHome, iGoals, iCorners, iCards,
  ];
  if (required.some((x) => x < 0)) return [];

  const out: CsvRow[] = [];

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (!row || row.length === 0) continue;

    const leagueId = toNumOr0(row[iLeagueId]);
    const leagueName = (row[iLeagueName] ?? "").trim();
    const teamId = toNumOr0(row[iTeamId]);
    const teamName = (row[iTeamName] ?? "").trim();
    const fixtureId = toNumOr0(row[iFixtureId]);
    const date = (row[iDate] ?? "").trim();
    const opponent = (row[iOpponent] ?? "").trim();
    const isHome = toBool(row[iIsHome]);

    if (!leagueId || !teamId || !fixtureId) continue;

    out.push({
      leagueId,
      leagueName,
      teamId,
      teamName,
      fixtureId,
      date,
      opponent,
      isHome,
      goalsTotal: toNumOrNull(row[iGoals]),
      cornersTotal: toNumOrNull(row[iCorners]),
      cardsTotal: toNumOrNull(row[iCards]),
    });
  }

  return out;
}

export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  try {
    const csv = await fetchCsvText();
    const rows = csvToRows(csv);

    if (!rows.length) {
      return [
        {
          leagueId: 0,
          leagueName: "Soccer Dashboard",
          error: "No rows found in CSV (or header mismatch).",
          teams: [],
        },
      ];
    }

    // Group -> league -> team
    const leagues = new Map<number, { leagueName: string; teams: Map<number, TeamBoard> }>();

    for (const r of rows) {
      let L = leagues.get(r.leagueId);
      if (!L) {
        L = { leagueName: r.leagueName || `League ${r.leagueId}`, teams: new Map() };
        leagues.set(r.leagueId, L);
      }

      let T = L.teams.get(r.teamId);
      if (!T) {
        T = { teamId: r.teamId, name: r.teamName || `Team ${r.teamId}`, logo: "", matches: [] };
        L.teams.set(r.teamId, T);
      }

      T.matches.push({
        fixtureId: r.fixtureId,
        date: r.date,
        opponent: r.opponent || "-",
        isHome: r.isHome,
        goalsTotal: r.goalsTotal,
        cornersTotal: r.cornersTotal,
        cardsTotal: r.cardsTotal,
      });
    }

    // Build final LeagueBoard[] with:
    // - newest->oldest per team
    // - pick last 7
    // - always 7 slots (pads blanks)
    const out: LeagueBoard[] = [];

    const leagueEntries = Array.from(leagues.entries()).sort((a, b) => a[0] - b[0]);

    for (const [leagueId, L] of leagueEntries) {
      const teams: TeamBoard[] = Array.from(L.teams.values()).map((t) => {
        const dedup = new Map<number, MatchCard>();
        for (const m of t.matches) dedup.set(m.fixtureId, m);

        const sorted = Array.from(dedup.values()).sort(
          (a, b) => safeDateKey(b.date) - safeDateKey(a.date)
        );

        const last7 = sorted.slice(0, 7);
        while (last7.length < 7) last7.push(blankMatch());

        return { ...t, matches: last7 };
      });

      // Sort teams A-Z for stable UI
      teams.sort((a, b) => a.name.localeCompare(b.name));

      out.push({
        leagueId,
        leagueName: L.leagueName,
        teams,
      });
    }

    return out;
  } catch (e: any) {
    return [
      {
        leagueId: 0,
        leagueName: "Soccer Dashboard",
        error: e?.message ?? String(e),
        teams: [],
      },
    ];
  }
}
