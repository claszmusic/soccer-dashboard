// src/lib/leagueData.ts
// SofaScore (unofficial JSON) backend for last 7 finished matches per team
// Totals:
// - goalsTotal = home + away
// - cornersTotal = home + away
// - cardsTotal = (yellow + red) home + away
//
// NOTE: These are unofficial endpoints and may change.

export type MatchRow = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;
  goalsTotal: number;
  cornersTotal: number;
  cardsTotal: number;
};

export type TeamBlock = {
  teamId: number;
  name: string;
  logo: string;
  matches: MatchRow[];
};

export type LeagueBlock = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  error?: string;
  teams: TeamBlock[];
};

export type LeagueBoard = {
  ok: boolean;
  data: LeagueBlock[];
  error?: string;
};

const SOFA_BASE = "https://api.sofascore.com/api/v1";
const IMG_TEAM = "https://img.sofascore.com/api/v1/team";
const DAY_SECONDS = 60 * 60 * 24;

function buildTeamLogo(teamId: number) {
  return `${IMG_TEAM}/${teamId}/image`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson<T>(
  url: string,
  opts?: { cache24h?: boolean; tries?: number; delayMs?: number }
): Promise<T> {
  const tries = opts?.tries ?? 3;
  const delayMs = opts?.delayMs ?? 350;

  let lastErr: any = null;

  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        cache: opts?.cache24h ? "force-cache" : "no-store",
        next: opts?.cache24h ? { revalidate: DAY_SECONDS } : undefined,
        headers: {
          // These headers matter: SofaScore often blocks “empty” serverless requests.
          "user-agent": "Mozilla/5.0",
          accept: "application/json,text/plain,*/*",
          "accept-language": "en-US,en;q=0.9",
          referer: "https://www.sofascore.com/",
        },
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url} :: ${t.slice(0, 200)}`);
      }

      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      await sleep(delayMs * (i + 1));
    }
  }

  throw lastErr ?? new Error("fetch failed");
}

// ---------- helpers ----------
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeDateISO(ev: any): string {
  const ts = Number(ev?.startTimestamp);
  if (Number.isFinite(ts) && ts > 0) return new Date(ts * 1000).toISOString();
  if (ev?.startDate) return new Date(ev.startDate).toISOString();
  return new Date().toISOString();
}

function goalsTotalFromEvent(ev: any): number {
  const h = num(ev?.homeScore?.current);
  const a = num(ev?.awayScore?.current);
  return h + a;
}

function opponentFromEvent(ev: any, teamId: number): { name: string; isHome: boolean } {
  const homeId = num(ev?.homeTeam?.id);
  const awayId = num(ev?.awayTeam?.id);
  const isHome = homeId === teamId;
  const opp = isHome ? ev?.awayTeam?.name : ev?.homeTeam?.name;
  return { name: String(opp ?? "-"), isHome };
}

function statusType(ev: any): string {
  // usually: ev.status.type === "finished"
  const t = ev?.status?.type ?? ev?.status;
  return String(t ?? "").toLowerCase();
}

// ---------- core endpoints ----------
async function getLatestSeasonId(uniqueTournamentId: number): Promise<number> {
  const j = await fetchJson<any>(`${SOFA_BASE}/unique-tournament/${uniqueTournamentId}/seasons`);
  const seasons: any[] = Array.isArray(j?.seasons) ? j.seasons : [];
  if (!seasons.length) throw new Error(`No seasons for tournament ${uniqueTournamentId}`);

  const sorted = [...seasons].sort((a, b) => num(b?.year) - num(a?.year));
  const pick = sorted[0] ?? seasons[seasons.length - 1];
  if (!pick?.id) throw new Error(`Bad seasons payload for tournament ${uniqueTournamentId}`);
  return num(pick.id);
}

async function getTeamsFromStandings(uniqueTournamentId: number, seasonId: number) {
  const j = await fetchJson<any>(
    `${SOFA_BASE}/unique-tournament/${uniqueTournamentId}/season/${seasonId}/standings/total`
  );

  const standings = Array.isArray(j?.standings) ? j.standings : [];
  const rows = Array.isArray(standings?.[0]?.rows) ? standings[0].rows : [];

  const teams = rows
    .map((r: any) => r?.team)
    .filter(Boolean)
    .map((t: any) => ({ id: num(t.id), name: String(t.name ?? "Unknown") }))
    .filter((t: any) => t.id > 0);

  const seen = new Set<number>();
  return teams.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

async function getLastFinishedEvents(teamId: number, need: number): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; page < 6 && out.length < need; page++) {
    const j = await fetchJson<any>(`${SOFA_BASE}/team/${teamId}/events/last/${page}`, {
      tries: 3,
      delayMs: 400,
    });
    const events: any[] = Array.isArray(j?.events) ? j.events : [];

    for (const ev of events) {
      const st = statusType(ev);
      if (st === "finished") out.push(ev);
      if (out.length >= need) break;
    }
  }
  return out.slice(0, need);
}

// ---------- stats parsing ----------
function flattenStatItems(statsJson: any): any[] {
  const blocks: any[] = Array.isArray(statsJson?.statistics) ? statsJson.statistics : [];
  const all = blocks.find((b) => String(b?.period).toUpperCase() === "ALL") ?? blocks[0];
  const groups: any[] = Array.isArray(all?.groups) ? all.groups : [];
  const items = groups.flatMap((g) => (Array.isArray(g?.statisticsItems) ? g.statisticsItems : []));
  return items;
}

function findStat(items: any[], predicate: (it: any) => boolean) {
  return items.find(predicate);
}

async function getCornersTotal(eventId: number): Promise<number> {
  try {
    const j = await fetchJson<any>(`${SOFA_BASE}/event/${eventId}/statistics`, {
      cache24h: true,
      tries: 3,
      delayMs: 450,
    });

    const items = flattenStatItems(j);

    // match by name OR key (both exist depending on event)
    const cornerItem =
      findStat(items, (it) => String(it?.name ?? "").toLowerCase() === "corner kicks") ||
      findStat(items, (it) => String(it?.name ?? "").toLowerCase() === "corners") ||
      findStat(items, (it) => String(it?.key ?? "").toLowerCase() === "corners") ||
      findStat(items, (it) => String(it?.name ?? "").toLowerCase().includes("corner"));

    const home = num(cornerItem?.home ?? cornerItem?.homeValue);
    const away = num(cornerItem?.away ?? cornerItem?.awayValue);
    return home + away;
  } catch {
    return 0;
  }
}

async function getCardsTotalFromStatistics(eventId: number): Promise<number | null> {
  try {
    const j = await fetchJson<any>(`${SOFA_BASE}/event/${eventId}/statistics`, {
      cache24h: true,
      tries: 3,
      delayMs: 450,
    });

    const items = flattenStatItems(j);

    const yellow =
      findStat(items, (it) => String(it?.name ?? "").toLowerCase() === "yellow cards") ||
      findStat(items, (it) => String(it?.key ?? "").toLowerCase() === "yellowCards".toLowerCase());

    const red =
      findStat(items, (it) => String(it?.name ?? "").toLowerCase() === "red cards") ||
      findStat(items, (it) => String(it?.key ?? "").toLowerCase() === "redCards".toLowerCase());

    // If neither exists, stats payload might not include card counts
    if (!yellow && !red) return null;

    const yHome = num(yellow?.home ?? yellow?.homeValue);
    const yAway = num(yellow?.away ?? yellow?.awayValue);
    const rHome = num(red?.home ?? red?.homeValue);
    const rAway = num(red?.away ?? red?.awayValue);

    return yHome + yAway + rHome + rAway;
  } catch {
    return null;
  }
}

async function getCardsTotal(eventId: number): Promise<number> {
  // Prefer statistics (stable, clean)
  const fromStats = await getCardsTotalFromStatistics(eventId);
  if (fromStats !== null) return fromStats;

  // Fallback: incidents (naming varies)
  try {
    const j = await fetchJson<any>(`${SOFA_BASE}/event/${eventId}/incidents`, {
      cache24h: true,
      tries: 3,
      delayMs: 450,
    });

    const inc: any[] = Array.isArray(j?.incidents) ? j.incidents : [];
    let total = 0;

    for (const x of inc) {
      const t = String(x?.incidentType ?? x?.type ?? "").toLowerCase();
      // common variations
      if (t.includes("yellow") || t.includes("red") || t.includes("card")) total += 1;
    }

    return total;
  } catch {
    return 0;
  }
}

// ---------- main ----------
export async function getLeagueBoard(args: {
  leagues: Array<{ leagueId: number; leagueName: string }>;
}): Promise<LeagueBoard> {
  try {
    const blocks: LeagueBlock[] = [];

    for (const L of args.leagues) {
      try {
        const seasonId = await getLatestSeasonId(L.leagueId);
        const teams = await getTeamsFromStandings(L.leagueId, seasonId);

        const teamBlocks: TeamBlock[] = [];

        for (const t of teams) {
          const events = await getLastFinishedEvents(t.id, 7);

          const matches: MatchRow[] = [];
          for (const ev of events) {
            const eventId = num(ev?.id);
            const { name: opp, isHome } = opponentFromEvent(ev, t.id);

            // Always numbers
            const goalsTotal = goalsTotalFromEvent(ev);
            const cornersTotal = await getCornersTotal(eventId);
            const cardsTotal = await getCardsTotal(eventId);

            matches.push({
              fixtureId: eventId,
              date: safeDateISO(ev),
              opponent: opp,
              isHome,
              goalsTotal,
              cornersTotal,
              cardsTotal,
            });
          }

          // If SofaScore returns fewer than 7 finished matches, pad with blanks
          while (matches.length < 7) {
            matches.push({
              fixtureId: 0,
              date: "",
              opponent: "-",
              isHome: true,
              goalsTotal: 0,
              cornersTotal: 0,
              cardsTotal: 0,
            });
          }

          teamBlocks.push({
            teamId: t.id,
            name: t.name,
            logo: buildTeamLogo(t.id),
            matches: matches.slice(0, 7),
          });
        }

        blocks.push({
          leagueId: L.leagueId,
          leagueName: L.leagueName,
          seasonUsed: seasonId,
          teams: teamBlocks,
        });
      } catch (e: any) {
        blocks.push({
          leagueId: L.leagueId,
          leagueName: L.leagueName,
          error: e?.message ?? String(e),
          teams: [],
        });
      }
    }

    return { ok: true, data: blocks };
  } catch (e: any) {
    return { ok: false, data: [], error: e?.message ?? String(e) };
  }
}
