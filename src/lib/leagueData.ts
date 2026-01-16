// src/lib/leagueData.ts
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
  teams: TeamBoard[];
  error?: string;
};

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function normalizeName(n: string) {
  return (n ?? "")
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

function cleanHeader(s: string) {
  // removes BOM, trims, lowercases
  return (s ?? "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

function cleanCell(s: string) {
  return (s ?? "").trim();
}

function numOrNull(v: string): number | null {
  const t = cleanCell(v);
  if (t === "") return null; // keep null so you can visually see truly-missing stats if you want
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function bool(v: string) {
  return cleanCell(v).toLowerCase() === "true";
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

export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  try {
    const url = mustEnv("SHEET_CSV_URL");
    const csv = await fetch(url, { cache: "no-store" }).then((r) => r.text());

    const table = parseCsv(csv);
    if (!table.length) return [];

    const rawHeaders = table[0] ?? [];
    const headerToIndex = new Map<string, number>();
    for (let i = 0; i < rawHeaders.length; i++) {
      headerToIndex.set(cleanHeader(rawHeaders[i]), i);
    }

    const at = (row: string[], name: string) => {
      const i = headerToIndex.get(cleanHeader(name));
      if (i === undefined) return "";
      return row[i] ?? "";
    };

    const rows = table.slice(1);

    // leagueId -> {name, teamsByNameKey}
    const leagues = new Map<number, { name: string; teams: Map<string, TeamBoard> }>();

    for (const r of rows) {
      if (!r || r.length === 0) continue;

      const leagueId = Number(cleanCell(at(r, "leagueId")));
      const leagueName = cleanCell(at(r, "leagueName"));
      const teamId = Number(cleanCell(at(r, "teamId")));
      const teamName = cleanCell(at(r, "teamName"));
      const teamKey = normalizeName(teamName);

      const fixtureId = Number(cleanCell(at(r, "fixtureId")));
      const date = cleanCell(at(r, "date"));
      const opponent = cleanCell(at(r, "opponent"));
      const isHome = bool(at(r, "isHome"));

      if (!leagueId || !teamName || !fixtureId) continue;

      const goalsTotal = numOrNull(at(r, "goalsTotal"));
      const cornersTotal = numOrNull(at(r, "cornersTotal"));
      const cardsTotal = numOrNull(at(r, "cardsTotal"));

      if (!leagues.has(leagueId)) {
        leagues.set(leagueId, { name: leagueName || `League ${leagueId}`, teams: new Map() });
      }

      const L = leagues.get(leagueId)!;

      if (!L.teams.has(teamKey)) {
        L.teams.set(teamKey, {
          teamId: Number.isFinite(teamId) && teamId > 0 ? teamId : Math.abs(hash(teamKey)),
          name: teamName,
          logo: "",
          matches: [],
        });
      }

      L.teams.get(teamKey)!.matches.push({
        fixtureId,
        date,
        opponent,
        isHome,
        goalsTotal,
        cornersTotal,
        cardsTotal,
      });
    }

    const out: LeagueBoard[] = [];

    for (const [leagueId, L] of leagues.entries()) {
      const teams: TeamBoard[] = [];

      for (const T of L.teams.values()) {
        // dedupe by fixtureId
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

      out.push({
        leagueId,
        leagueName: L.name,
        teams,
      });
    }

    out.sort((a, b) => a.leagueId - b.leagueId);
    return out;
  } catch (e: any) {
    return [
      {
        leagueId: 0,
        leagueName: "Error",
        error: e?.message ?? String(e),
        teams: [],
      },
    ];
  }
}

// stable hash so we can generate a fallback numeric id
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
