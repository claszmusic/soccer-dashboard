// src/lib/leagueData.ts
// Google Sheets CSV backend -> LeagueBoard[]
// Reads SHEET_CSV_URL (published CSV from Matches sheet)
// Groups by league/team, sorts by date desc, returns last 7 per team.
// Stable: no live sports API calls during page load.

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
  logo: string; // optional; can be blank if not stored
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
  // logo not in your sheet yet; can be added later
};

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

function safeNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function safeInt(v: string | undefined): number {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function safeBool(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// Minimal CSV parser that supports quoted fields with commas/newlines
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }

    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (c === "\r") continue;

    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }

    field += c;
  }

  // last field
  row.push(field);
  rows.push(row);

  // drop trailing empty row
  if (rows.length && rows[rows.length - 1].every((x) => x.trim() === "")) rows.pop();

  return rows;
}

async function fetchSheetCSV(): Promise<{ ok: true; rows: CsvRow[] } | { ok: false; error: string }> {
  const url = process.env.SHEET_CSV_URL;
  if (!url) return { ok: false, error: "Missing SHEET_CSV_URL env var in Vercel." };

  try {
    const r = await fetch(url, {
      // Sheets publish endpoint is public; cache helps stability + speed
      next: { revalidate: 60 }, // refresh up to once per minute
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { ok: false, error: `CSV fetch failed (${r.status}): ${t || r.statusText}` };
    }

    const csvText = await r.text();
    const table = parseCSV(csvText);
    if (table.length < 2) return { ok: true, rows: [] };

    const header = table[0].map((h) => h.trim());
    const idx = (name: string) => header.indexOf(name);

    const iLeagueId = idx("leagueId");
    const iLeagueName = idx("leagueName");
    const iTeamId = idx("teamId");
    const iTeamName = idx("teamName");
    const iFixtureId = idx("fixtureId");
    const iDate = idx("date");
    const iOpponent = idx("opponent");
    const iIsHome = idx("isHome");
    const iGoalsTotal = idx("goalsTotal");
    const iCornersTotal = idx("cornersTotal");
    const iCardsTotal = idx("cardsTotal");

    const required = [iLeagueId, iLeagueName, iTeamId, iTeamName, iFixtureId, iDate, iOpponent, iIsHome, iGoalsTotal];
    if (required.some((x) => x === -1)) {
      return { ok: false, error: "CSV headers do not match expected columns. Re-check your Matches header row." };
    }

    const rows: CsvRow[] = [];

    for (let r = 1; r < table.length; r++) {
      const line = table[r];

      const leagueId = safeInt(line[iLeagueId]);
      const leagueName = String(line[iLeagueName] ?? "").trim();
      const teamId = safeInt(line[iTeamId]);
      const teamName = String(line[iTeamName] ?? "").trim();
      const fixtureId = safeInt(line[iFixtureId]);
      const date = String(line[iDate] ?? "").trim();
      const opponent = String(line[iOpponent] ?? "").trim();
      const isHome = safeBool(line[iIsHome]);

      // totals can be blank if script didn’t fill yet
      const goalsTotal = safeNum(line[iGoalsTotal]);
      const cornersTotal = iCornersTotal === -1 ? null : safeNum(line[iCornersTotal]);
      const cardsTotal = iCardsTotal === -1 ? null : safeNum(line[iCardsTotal]);

      if (!leagueId || !teamId || !fixtureId || !date) continue;

      rows.push({
        leagueId,
        leagueName,
        teamId,
        teamName,
        fixtureId,
        date,
        opponent: opponent || "-",
        isHome,
        goalsTotal,
        cornersTotal,
        cardsTotal,
      });
    }

    return { ok: true, rows };
  } catch (e: any) {
    return { ok: false, error: `CSV fetch error: ${e?.message ?? String(e)}` };
  }
}

export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  const res = await fetchSheetCSV();
  if (!res.ok) {
    // return skeleton leagues so UI still renders
    return [
      { leagueId: 262, leagueName: "Liga MX", error: res.error, teams: [] },
      { leagueId: 39, leagueName: "Premier League", error: res.error, teams: [] },
      { leagueId: 78, leagueName: "Bundesliga", error: res.error, teams: [] },
      { leagueId: 140, leagueName: "La Liga", error: res.error, teams: [] },
      { leagueId: 135, leagueName: "Serie A", error: res.error, teams: [] },
    ];
  }

  // Group: league -> team -> matches
  const leagueMap = new Map<number, { leagueId: number; leagueName: string; teamMap: Map<number, TeamBoard> }>();

  // Dedup by team+fixture
  const seen = new Set<string>();

  for (const row of res.rows) {
    const key = `${row.teamId}|${row.fixtureId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let league = leagueMap.get(row.leagueId);
    if (!league) {
      league = { leagueId: row.leagueId, leagueName: row.leagueName || `League ${row.leagueId}`, teamMap: new Map() };
      leagueMap.set(row.leagueId, league);
    }

    let team = league.teamMap.get(row.teamId);
    if (!team) {
      team = { teamId: row.teamId, name: row.teamName || `Team ${row.teamId}`, logo: "", matches: [] };
      league.teamMap.set(row.teamId, team);
    }

    team.matches.push({
      fixtureId: row.fixtureId,
      date: row.date,
      opponent: row.opponent || "-",
      isHome: row.isHome,
      goalsTotal: row.goalsTotal,
      cornersTotal: row.cornersTotal,
      cardsTotal: row.cardsTotal,
    });
  }

  // Build boards with last 7, always 7 slots
  const boards: LeagueBoard[] = Array.from(leagueMap.values()).map((L) => {
    const teams = Array.from(L.teamMap.values()).map((t) => {
      const sorted = t.matches
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .slice(0, 7);

      while (sorted.length < 7) sorted.push(blankMatch());

      return { ...t, matches: sorted };
    });

    // sort teams alphabetically for stable UI
    teams.sort((a, b) => a.name.localeCompare(b.name));

    return {
      leagueId: L.leagueId,
      leagueName: L.leagueName,
      teams,
    };
  });

  // Keep your preferred league order even if sheet rows are missing
  const preferredOrder = [262, 39, 78, 140, 135];
  boards.sort((a, b) => preferredOrder.indexOf(a.leagueId) - preferredOrder.indexOf(b.leagueId));

  return boards;
}
