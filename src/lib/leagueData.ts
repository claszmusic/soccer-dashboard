// src/lib/leagueData.ts
type MatchCard = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;
  goalsTotal: number;
  cornersTotal: number;
  cardsTotal: number;
};

type TeamBoard = {
  teamId: number;
  name: string;
  logo: string;
  matches: MatchCard[];
};

type LeagueBoard = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  error?: string;
  teams: TeamBoard[];
};

type GetBoardArgs = {
  leagues: { leagueId: number; leagueName: string }[];
};

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

const SOFA_BASE = "https://api.sofascore.com/api/v1";
const IMG_TEAM = "https://img.sofascore.com/api/v1/team";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson<T>(
  url: string,
  opts?: {
    revalidateSeconds?: number;
    tries?: number;
    delayMs?: number;
  }
): Promise<T> {
  const tries = opts?.tries ?? 3;
  const delayMs = opts?.delayMs ?? 400;

  let lastErr: any = null;

  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        // cache rules:
        // - dynamic league/team lists: no-store
        // - per-event stats/incidents: revalidate ~24h
        cache: opts?.revalidateSeconds ? "force-cache" : "no-store",
        next: opts?.revalidateSeconds ? { revalidate: opts.revalidateSeconds } : undefined,
        headers: {
          "user-agent": "Mozilla/5.0",
          accept: "application/json,text/plain,*/*",
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

/**
 * Get "latest" seasonId for a tournament.
 * Unofficial API shape, but generally returns { seasons: [...] } with "year"/"id".
 */
async function getLatestSeasonId(uniqueTournamentId: number): Promise<{ seasonId: number; seasonName?: string }> {
  const j = await fetchJson<any>(`${SOFA_BASE}/unique-tournament/${uniqueTournamentId}/seasons`, {
    tries: 3,
    delayMs: 350,
  });

  const seasons: any[] = Array.isArray(j?.seasons) ? j.seasons : [];
  if (!seasons.length) throw new Error(`No seasons for tournament ${uniqueTournamentId}`);

  // pick the greatest "year" if present, else last element
  const sorted = [...seasons].sort((a, b) => (b?.year ?? 0) - (a?.year ?? 0));
  const pick = sorted[0] ?? seasons[seasons.length - 1];

  if (!pick?.id) throw new Error(`Bad seasons payload for tournament ${uniqueTournamentId}`);

  return { seasonId: Number(pick.id), seasonName: pick?.name };
}

/**
 * League standings -> list of teams (id + name)
 */
async function getTeamsFromStandings(uniqueTournamentId: number, seasonId: number): Promise<Array<{ id: number; name: string }>> {
  // common endpoint pattern used by sofascore internal API
  const j = await fetchJson<any>(`${SOFA_BASE}/unique-tournament/${uniqueTournamentId}/season/${seasonId}/standings/total`, {
    tries: 3,
    delayMs: 350,
  });

  // shape usually: { standings: [ { rows: [ { team: { id, name } } ] } ] }
  const standings = Array.isArray(j?.standings) ? j.standings : [];
  const rows = Array.isArray(standings?.[0]?.rows) ? standings[0].rows : [];

  const teams = rows
    .map((r: any) => r?.team)
    .filter(Boolean)
    .map((t: any) => ({ id: Number(t.id), name: String(t.name ?? "Unknown") }))
    .filter((t: any) => Number.isFinite(t.id));

  // de-dupe
  const seen = new Set<number>();
  return teams.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/**
 * Team events -> last finished events; returns event ids
 * Endpoint noted in public writeups: /api/v1/team/{team_id}/events/last/{page} :contentReference[oaicite:7]{index=7}
 */
async function getLastFinishedEvents(teamId: number, need: number): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; page < 5 && out.length < need; page++) {
    const j = await fetchJson<any>(`${SOFA_BASE}/team/${teamId}/events/last/${page}`, { tries: 3, delayMs: 350 });
    const events: any[] = Array.isArray(j?.events) ? j.events : [];

    for (const ev of events) {
      const status = ev?.status?.type || ev?.status;
      // typical: "finished" / "inprogress" / "notstarted"
      if (String(status).toLowerCase() === "finished") out.push(ev);
      if (out.length >= need) break;
    }
  }
  return out.slice(0, need);
}

/**
 * Event stats: corners
 * We look for a stat item named "Corner kicks" (or similar) and sum home+away.
 * Stats are cached 24h because they don't change after FT.
 */
async function getCornersTotal(eventId: number): Promise<number> {
  try {
    const j = await fetchJson<any>(`${SOFA_BASE}/event/${eventId}/statistics`, {
      revalidateSeconds: 60 * 60 * 24,
      tries: 3,
      delayMs: 350,
    });

    // Typical structure: { statistics: [ { period: "ALL", groups: [ { groupName, statisticsItems: [...] } ] } ] }
    const blocks: any[] = Array.isArray(j?.statistics) ? j.statistics : [];
    const all = blocks.find((b) => String(b?.period).toUpperCase() === "ALL") ?? blocks[0];
    const groups: any[] = Array.isArray(all?.groups) ? all.groups : [];

    const items = groups.flatMap((g) => (Array.isArray(g?.statisticsItems) ? g.statisticsItems : []));
    const cornerItem =
      items.find((it: any) => String(it?.name).toLowerCase() === "corner kicks") ??
      items.find((it: any) => String(it?.name).toLowerCase().includes("corner"));

    const home = Number(cornerItem?.home ?? cornerItem?.homeValue ?? 0) || 0;
    const away = Number(cornerItem?.away ?? cornerItem?.awayValue ?? 0) || 0;

    return home + away;
  } catch {
    return 0;
  }
}

/**
 * Event incidents: cards
 * Incidents cached 24h after FT.
 */
async function getCardsTotal(eventId: number): Promise<number> {
  try {
    const j = await fetchJson<any>(`${SOFA_BASE}/event/${eventId}/incidents`, {
      revalidateSeconds: 60 * 60 * 24,
      tries: 3,
      delayMs: 350,
    });

    const inc: any[] = Array.isArray(j?.incidents) ? j.incidents : [];

    // Count both yellow + red. (Google shows them separately; you want total.)
    // incidentType values vary; we check for "yellow"/"red" in the string.
    let total = 0;
    for (const x of inc) {
      const t = String(x?.incidentType ?? x?.type ?? "").toLowerCase();
      if (t.includes("yellow") || t.includes("red")) total += 1;
    }
    return total;
  } catch {
    return 0;
  }
}

function buildTeamLogo(teamId: number) {
  // stable image endpoint used by sofascore
  return `${IMG_TEAM}/${teamId}/image`;
}

function safeDateISO(ev: any): string {
  // sofascore usually provides startTimestamp (seconds)
  const ts = Number(ev?.startTimestamp);
  if (Number.isFinite(ts) && ts > 0) return new Date(ts * 1000).toISOString();
  // fallback if they provide startDate
  if (ev?.startDate) return new Date(ev.startDate).toISOString();
  return new Date().toISOString();
}

function getGoalsTotalFromEvent(ev: any): number {
  const home = Number(ev?.homeScore?.current ?? 0) || 0;
  const away = Number(ev?.awayScore?.current ?? 0) || 0;
  return home + away;
}

function opponentName(ev: any, teamId: number): { name: string; isHome: boolean } {
  const homeId = Number(ev?.homeTeam?.id);
  const awayId = Number(ev?.awayTeam?.id);

  const isHome = homeId === teamId;
  const opp = isHome ? ev?.awayTeam?.name : ev?.homeTeam?.name;

  return { name: String(opp ?? "-"), isHome };
}

/**
 * MAIN exported function used by your route.ts
 */
export async function getLeagueBoard(args: GetBoardArgs): Promise<Ok<LeagueBoard[]> | Err> {
  try {
    const leagues: LeagueBoard[] = [];

    for (const L of args.leagues) {
      try {
        const { seasonId } = await getLatestSeasonId(L.leagueId);
        const teams = await getTeamsFromStandings(L.leagueId, seasonId);

        const teamBoards: TeamBoard[] = [];

        for (const t of teams) {
          const events = await getLastFinishedEvents(t.id, 7);

          const matches: MatchCard[] = [];
          for (const ev of events) {
            const eventId = Number(ev?.id);
            const { name: opp, isHome } = opponentName(ev, t.id);

            const goalsTotal = getGoalsTotalFromEvent(ev);
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

          // Ensure exactly 7 slots (no blanks that crash UI)
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

          teamBoards.push({
            teamId: t.id,
            name: t.name,
            logo: buildTeamLogo(t.id),
            matches: matches.slice(0, 7),
          });
        }

        leagues.push({
          leagueId: L.leagueId,
          leagueName: L.leagueName,
          seasonUsed: seasonId,
          teams: teamBoards,
        });
      } catch (e: any) {
        leagues.push({
          leagueId: L.leagueId,
          leagueName: L.leagueName,
          error: e?.message ?? String(e),
          teams: [],
        });
      }
    }

    return { ok: true, data: leagues };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
