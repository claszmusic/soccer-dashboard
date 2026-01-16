// src/lib/leagueData.ts
// Stable last-7 matches per team across season boundaries, with robust team-name + team-id fixing.
//
// Key fixes:
// - Fetch league fixtures for season + (season-1), merge, sort newest -> oldest
// - Build alias mapping from fixtures to resolve "effectiveTeamId" when /teams IDs don't match fixture IDs
// - Match fixtures by: effectiveTeamId OR original teamId OR fuzzy name match
// - If a team still gets 0 fixtures, FORCE-SWAP to fixture teamId found by name (this fixes Toluca/Monterrey/Tijuana blanks)
// - Team fallback fetch tries ALL known IDs without season to prevent blanks
// - Corners/cards cached 24h so they don't disappear on refresh
// - Fixtures/teams/leagues remain no-store to avoid Vercel caching partial payloads

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

const API_BASE = "https://v3.football.api-sports.io";
const FINISHED = new Set(["FT", "AET", "PEN"]);

// ---------------- utils ----------------
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toQS(params: Record<string, string | number | boolean | undefined>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
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

function statNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sumNumbers(values: Array<number | null>): number | null {
  const any = values.some((x) => x !== null);
  if (!any) return null;
  return values.reduce((acc, v) => acc + (v ?? 0), 0);
}

function sortByDateDesc<T extends { fixture: { date: string } }>(arr: T[]): T[] {
  return arr
    .slice()
    .sort((a, b) => (a.fixture.date < b.fixture.date ? 1 : a.fixture.date > b.fixture.date ? -1 : 0));
}

// Normalize name for robust matching (accents/punctuation/spacing)
function normName(s: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string) {
  const t = normName(s).split(" ").filter(Boolean);
  return new Set(t);
}

// Fuzzy name match: exact, contains, or high token overlap
function nameMatches(a: string, b: string) {
  const A = normName(a);
  const B = normName(b);
  if (!A || !B) return false;
  if (A === B) return true;
  if (A.includes(B) || B.includes(A)) return true;

  const ta = tokens(A);
  const tb = tokens(B);
  if (!ta.size || !tb.size) return false;

  let common = 0;
  for (const x of ta) if (tb.has(x)) common++;

  const overlapA = common / ta.size;
  const overlapB = common / tb.size;

  return overlapA >= 0.6 || overlapB >= 0.6;
}

// ---------------- API fetch ----------------
async function apiFetch<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  fetchOpts?: { cacheMode?: RequestCache; revalidateSeconds?: number }
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const apiKey =
    process.env.APISPORTS_KEY ||
    process.env.APISPORTS_API_KEY ||
    process.env.APISPORTSKEY;

  if (!apiKey) return { ok: false as const, error: "Missing APISPORTS_KEY env var" };

  const url = `${API_BASE}${path}${toQS(params)}`;

  const cacheMode = fetchOpts?.cacheMode ?? "no-store";
  const revalidateSeconds = fetchOpts?.revalidateSeconds;

  const maxAttempts = 7;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "x-apisports-key": apiKey },
        cache: cacheMode,
        ...(revalidateSeconds !== undefined ? { next: { revalidate: revalidateSeconds } } : {}),
      });

      if (r.status === 429) {
        const wait = Math.min(20000, 1000 * Math.pow(2, attempt - 1));
        await sleep(wait);
        continue;
      }

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        return {
          ok: false as const,
          error: `API ${r.status}: ${txt || r.statusText}`,
          status: r.status,
        };
      }

      const json = (await r.json()) as T;
      return { ok: true as const, data: json };
    } catch (e: any) {
      if (attempt === maxAttempts) {
        return { ok: false as const, error: `Network error: ${e?.message ?? String(e)}` };
      }
      await sleep(Math.min(12000, 700 * Math.pow(2, attempt - 1)));
    }
  }

  return { ok: false as const, error: "Unknown error" };
}

// ---------------- API types (minimal) ----------------
type ApiLeaguesResp = {
  response: Array<{
    seasons: Array<{ year: number; current: boolean }>;
  }>;
};

type ApiTeamsResp = {
  response: Array<{ team: { id: number; name: string; logo: string } }>;
};

type ApiFixturesResp = {
  response: Array<{
    fixture: { id: number; date: string; status: { short: string } };
    teams: { home: { id: number; name: string }; away: { id: number; name: string } };
    goals: { home: number | null; away: number | null };
  }>;
};

type ApiFixtureStatsResp = {
  response: Array<{
    statistics: Array<{ type: string; value: number | string | null }>;
  }>;
};

type ApiEventsResp = {
  response: Array<{
    type: string;
    detail: string;
  }>;
};

// ---------------- core fetchers ----------------
async function getCurrentSeason(leagueId: number): Promise<number | null> {
  const r = await apiFetch<ApiLeaguesResp>("/leagues", { id: leagueId }, { cacheMode: "no-store" });
  if (!r.ok) return null;

  const seasons = r.data.response?.[0]?.seasons ?? [];
  return seasons.find((s) => s.current)?.year ?? seasons[0]?.year ?? null;
}

async function getTeamsForLeague(leagueId: number, season: number): Promise<TeamBoard[] | null> {
  const r = await apiFetch<ApiTeamsResp>(
    "/teams",
    { league: leagueId, season },
    { cacheMode: "no-store" }
  );
  if (!r.ok) return null;

  return (r.data.response ?? []).map((x) => ({
    teamId: x.team.id,
    name: x.team.name,
    logo: x.team.logo,
    matches: [],
  }));
}

// Fixtures across current + previous season, merged + deduped by fixtureId
async function getLeagueFinishedFixturesAcrossSeasons(leagueId: number, season: number) {
  const seasonsToTry = [season, season - 1];
  const all: ApiFixturesResp["response"] = [];

  for (const s of seasonsToTry) {
    const r = await apiFetch<ApiFixturesResp>(
      "/fixtures",
      { league: leagueId, season: s, last: 1000 },
      { cacheMode: "no-store" }
    );
    if (!r.ok) continue;

    const finished = (r.data.response ?? []).filter((fx) => FINISHED.has(fx.fixture.status?.short));
    all.push(...finished);
  }

  const byId = new Map<number, ApiFixturesResp["response"][number]>();
  for (const fx of all) byId.set(fx.fixture.id, fx);

  return sortByDateDesc(Array.from(byId.values()));
}

// Team fallback without season; we will call it with multiple ids if needed
async function getTeamFinishedFixturesNoSeason(teamId: number) {
  const r = await apiFetch<ApiFixturesResp>(
    "/fixtures",
    { team: teamId, last: 120 },
    { cacheMode: "no-store" }
  );
  if (!r.ok) return [];

  const finished = (r.data.response ?? []).filter((fx) => FINISHED.has(fx.fixture.status?.short));
  return finished.slice(0, 7);
}

// Corners cached 24h
async function getCornersTotal(fixtureId: number): Promise<number | null> {
  const r = await apiFetch<ApiFixtureStatsResp>(
    "/fixtures/statistics",
    { fixture: fixtureId },
    { cacheMode: "force-cache", revalidateSeconds: 24 * 60 * 60 }
  );
  if (!r.ok) return null;

  const rows = r.data.response ?? [];
  if (!rows.length) return null;

  const cornerVals: Array<number | null> = rows.map((row) => {
    const v = row.statistics.find((s) => s.type === "Corner Kicks")?.value ?? null;
    return statNumber(v);
  });

  return sumNumbers(cornerVals);
}

// Cards cached 24h
async function getCardsTotal(fixtureId: number): Promise<number | null> {
  const r = await apiFetch<ApiEventsResp>(
    "/fixtures/events",
    { fixture: fixtureId },
    { cacheMode: "force-cache", revalidateSeconds: 24 * 60 * 60 }
  );
  if (!r.ok) return null;

  const events = r.data.response ?? [];
  if (!events.length) return 0;

  let yellow = 0;
  let red = 0;

  for (const e of events) {
    if (e.type !== "Card") continue;
    const d = (e.detail ?? "").toLowerCase();
    if (d.includes("yellow")) yellow++;
    if (d.includes("red")) red++;
  }

  return yellow + red;
}

async function retryNullable<T>(
  fn: () => Promise<T | null>,
  tries: number,
  baseWaitMs: number
): Promise<T | null> {
  for (let i = 1; i <= tries; i++) {
    const v = await fn();
    if (v !== null) return v;
    if (i < tries) await sleep(baseWaitMs * i);
  }
  return null;
}

// Build alias map: normalized teamName -> set(ids found in fixtures)
function buildFixtureAliasIndex(leagueFixtures: ApiFixturesResp["response"]) {
  const nameToIds = new Map<string, Set<number>>();

  function add(name: string, id: number) {
    const n = normName(name);
    if (!n) return;
    const set = nameToIds.get(n) ?? new Set<number>();
    set.add(id);
    nameToIds.set(n, set);
  }

  for (const fx of leagueFixtures) {
    add(fx.teams.home.name, fx.teams.home.id);
    add(fx.teams.away.name, fx.teams.away.id);
  }

  return nameToIds;
}

// Resolve effective team IDs for each team (original + any fixture IDs that match its name)
function resolveEffectiveIds(team: TeamBoard, aliasIndex: Map<string, Set<number>>): number[] {
  const ids = new Set<number>([team.teamId]);

  const teamNameNorm = normName(team.name);

  // Exact normalized match first
  const exact = aliasIndex.get(teamNameNorm);
  if (exact && exact.size > 0) {
    for (const id of exact) ids.add(id);
    return Array.from(ids);
  }

  // Otherwise: fuzzy scan and grab the first matching set
  for (const [fxNameNorm, idSet] of aliasIndex.entries()) {
    if (nameMatches(teamNameNorm, fxNameNorm)) {
      for (const id of idSet) ids.add(id);
      break;
    }
  }

  return Array.from(ids);
}

// Match fixture to team using ids OR name fallback
function teamInFixture(team: TeamBoard, effectiveIds: number[], fx: ApiFixturesResp["response"][number]) {
  if (effectiveIds.includes(fx.teams.home.id) || effectiveIds.includes(fx.teams.away.id)) return true;

  return nameMatches(team.name, fx.teams.home.name) || nameMatches(team.name, fx.teams.away.name);
}

// Determine isHome reliably: prefer id match, fallback to name
function computeIsHome(team: TeamBoard, effectiveIds: number[], fx: ApiFixturesResp["response"][number]) {
  if (effectiveIds.includes(fx.teams.home.id)) return true;
  if (effectiveIds.includes(fx.teams.away.id)) return false;

  if (nameMatches(team.name, fx.teams.home.name)) return true;
  if (nameMatches(team.name, fx.teams.away.name)) return false;

  return true;
}

// ---------------- exported ----------------
export async function getLeagueBoards(): Promise<LeagueBoard[]> {
  const fxLimiter = createLimiter(2);
  const out: LeagueBoard[] = [];

  for (const league of LEAGUES) {
    const season = await getCurrentSeason(league.leagueId);
    if (!season) {
      out.push({ leagueId: league.leagueId, leagueName: league.leagueName, error: "Could not resolve season.", teams: [] });
      continue;
    }

    const teams = await getTeamsForLeague(league.leagueId, season);
    if (!teams || teams.length === 0) {
      out.push({ leagueId: league.leagueId, leagueName: league.leagueName, seasonUsed: season, error: "Could not load teams.", teams: [] });
      continue;
    }

    const leagueFinished = await getLeagueFinishedFixturesAcrossSeasons(league.leagueId, season);
    const aliasIndex = buildFixtureAliasIndex(leagueFinished);

    const teamEffectiveIds = new Map<number, number[]>();
    for (const t of teams) teamEffectiveIds.set(t.teamId, resolveEffectiveIds(t, aliasIndex));

    // For each team: take last 7 from league fixtures; if 0, FORCE-SWAP to fixture ID found by name
    const perTeamFixtures = await Promise.all(
      teams.map(async (t) => {
        const ids = teamEffectiveIds.get(t.teamId) ?? [t.teamId];

        let fromLeague = leagueFinished.filter((fx) => teamInFixture(t, ids, fx)).slice(0, 7);

        // ✅ FORCE-SWAP if empty: steal ID from fixtures by name match
        if (fromLeague.length === 0) {
          const tNorm = normName(t.name);
          const hit = leagueFinished.find(
            (fx) => nameMatches(tNorm, fx.teams.home.name) || nameMatches(tNorm, fx.teams.away.name)
          );

          if (hit) {
            const swappedId = nameMatches(tNorm, hit.teams.home.name) ? hit.teams.home.id : hit.teams.away.id;
            const swappedIds = Array.from(new Set([t.teamId, swappedId]));

            fromLeague = leagueFinished.filter((fx) => teamInFixture(t, swappedIds, fx)).slice(0, 7);

            if (fromLeague.length > 0) {
              return { team: t, effectiveIds: swappedIds, fixtures: fromLeague };
            }
          }
        }

        if (fromLeague.length > 0) return { team: t, effectiveIds: ids, fixtures: fromLeague };

        // Fallback: no-season fetch for all ids
        const merged: ApiFixturesResp["response"] = [];
        for (const id of ids) merged.push(...(await getTeamFinishedFixturesNoSeason(id)));

        const byId = new Map<number, ApiFixturesResp["response"][number]>();
        for (const fx of merged) byId.set(fx.fixture.id, fx);

        const sorted = sortByDateDesc(Array.from(byId.values())).slice(0, 7);
        return { team: t, effectiveIds: ids, fixtures: sorted };
      })
    );

    // Dedup fixture IDs for stats/events
    const fixtureIdsSet = new Set<number>();
    for (const tf of perTeamFixtures) for (const fx of tf.fixtures) fixtureIdsSet.add(fx.fixture.id);
    const fixtureIds = [...fixtureIdsSet];

    const fixtureData = new Map<number, { cornersTotal: number | null; cardsTotal: number | null }>();

    await Promise.all(
      fixtureIds.map((fixtureId) =>
        fxLimiter(async () => {
          await sleep(80);
          const cornersTotal = await retryNullable(() => getCornersTotal(fixtureId), 3, 650);
          const cardsTotal = await retryNullable(() => getCardsTotal(fixtureId), 3, 650);
          fixtureData.set(fixtureId, { cornersTotal, cardsTotal });
        })
      )
    );

    // Build TeamBoards (always 7 matches)
    const filledTeams: TeamBoard[] = perTeamFixtures.map(({ team, effectiveIds, fixtures }) => {
      const real: MatchCard[] = fixtures.map((fx) => {
        const fixtureId = fx.fixture.id;
        const date = fx.fixture.date;

        const isHome = computeIsHome(team, effectiveIds, fx);
        const opponent = isHome ? fx.teams.away.name : fx.teams.home.name;

        const homeGoals = fx.goals.home ?? 0;
        const awayGoals = fx.goals.away ?? 0;

        const d = fixtureData.get(fixtureId) ?? { cornersTotal: null, cardsTotal: null };

        return {
          fixtureId,
          date,
          opponent,
          isHome,
          goalsTotal: homeGoals + awayGoals,
          cornersTotal: d.cornersTotal,
          cardsTotal: d.cardsTotal,
        };
      });

      const matches = real.slice(0, 7);
      while (matches.length < 7) matches.push(blankMatch());

      return { ...team, matches };
    });

    out.push({ leagueId: league.leagueId, leagueName: league.leagueName, seasonUsed: season, teams: filledTeams });
    await sleep(200);
  }

  return out;
}
