// src/lib/leagueData.ts
// Data source: Google Sheets published CSV (SHEET_CSV_URL)
// Returns LeagueBoard[] exactly as your UI expects.

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

const LEAGUES: Array<{ leagueId: number; leagueName: string }> = [
  { leagueId: 262, leagueName: "Liga MX" },
  { leagueId: 39, leagueName: "Premier League" },
  { leagueId: 78, leagueName: "Bundesliga" },
  { leagueId: 140, leagueName: "La Liga" },
  { leagueId: 135, leagueName: "Serie A" },
];

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

// Parse numbers safely; if empty -> null
function parseNum(v: string | undefined | null): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// If you want missing corners/cards to show as 0 instead of "-", keep this ON.
const FILL_MISSING_TOTALS_WITH_ZERO = true;

function normalizeBool(v: string | undefined | null): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

function parseCsvLine(line: string): string[] {
  // simple CSV parser that supports quotes
  const out: string[] = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // escaped quote
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }

    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cols[j] ?? "").trim();
    }
    rows.push(row);
  }

  return rows;
}

type SheetRow = {
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
  logo?: string;
};

function toSheetRow(r: Record<string, string>): SheetRow | null {
  const leagueId = Number(r.leagueId);
  const teamId = Number(r.teamId);
  const fixtureId = Number(r.fixtureId);

  if (!Number.isFinite(leagueId) || !Number.isFinite(teamId) || !Number.isFinite(fixtureId)) return null;

  const goalsTotal = parseNum(r.goalsTotal);
  let cornersTotal = parseNum(r.cornersTotal);
  let cardsTotal = parseNum(r.cardsTotal);

  if (FILL_MISSING_TOTALS_WITH_ZERO) {
    if (cornersTotal === null) cornersTotal = 0;
    if (cardsTotal === null) cardsTotal = 0;
  }

  return {
    leagueId,
    leagueName: r.leagueName || "",
    teamId,
    teamName: r.teamName || "",
    fixtureId,
    date: r.date || "",
    opponent: r.opponent || "-",
    isHome: normalizeBool(r.isHome),
    goalsTotal: goalsTotal ?? 0, // goals should always exist, but keep stable
    cornersTotal,
    cardsTotal,
  };
}

export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  const url = process.env.SHEET_CSV_URL;
  if (!url) {
    return LEAGUES.map((l) => ({
      leagueId: l.leagueId,
      leagueName: l.leagueName,
      error: "Missing SHEET_CSV_URL env var",
      teams: [],
    }));
  }

  let csvText = "";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText}`);
    csvText = await res.text();
  } catch (e: any) {
    return LEAGUES.map((l) => ({
      leagueId: l.leagueId,
      leagueName: l.leagueName,
      error: e?.message ?? String(e),
      teams: [],
    }));
  }

  const raw = parseCsv(csvText);
  const rows: SheetRow[] = [];
  for (const r of raw) {
    const sr = toSheetRow(r);
    if (sr) rows.push(sr);
  }

  // group: league -> team -> matches
  const leagueMap = new Map<number, Map<number, SheetRow[]>>();
  for (const row of rows) {
    if (!leagueMap.has(row.leagueId)) leagueMap.set(row.leagueId, new Map());
    const teamMap = leagueMap.get(row.leagueId)!;
    if (!teamMap.has(row.teamId)) teamMap.set(row.teamId, []);
    teamMap.get(row.teamId)!.push(row);
  }

  const out: LeagueBoard[] = [];

  for (const L of LEAGUES) {
    const teamMap = leagueMap.get(L.leagueId) ?? new Map<number, SheetRow[]>();

    // Sort each team’s matches newest -> oldest, dedup by fixtureId
    const teams: TeamBoard[] = [];

    for (const [teamId, list] of teamMap.entries()) {
      const byFixture = new Map<number, SheetRow>();
      for (const r of list) byFixture.set(r.fixtureId, r);

      const unique = Array.from(byFixture.values()).sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0
      );

      const name = unique[0]?.teamName ?? `Team ${teamId}`;
      const logo = unique[0]?.logo ?? `https://media.api-sports.io/football/teams/${teamId}.png`;

      const realMatches: MatchCard[] = unique.slice(0, 7).map((r) => ({
        fixtureId: r.fixtureId,
        date: r.date,
        opponent: r.opponent,
        isHome: r.isHome,
        goalsTotal: r.goalsTotal,
        cornersTotal: r.cornersTotal,
        cardsTotal: r.cardsTotal,
      }));

      while (realMatches.length < 7) realMatches.push(blankMatch());

      teams.push({
        teamId,
        name,
        logo,
        matches: realMatches,
      });
    }

    // IMPORTANT: If a league has zero teams in the sheet yet, return empty but with error.
    out.push({
      leagueId: L.leagueId,
      leagueName: L.leagueName,
      teams,
    });
  }

  return out;
}
