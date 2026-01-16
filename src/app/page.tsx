"use client";

import { useEffect, useMemo, useState } from "react";

type MatchCard = {
  fixtureId: number;
  date: string;
  opponent: string;
  isHome: boolean;
  goalsTotal: number | null;
  cornersTotal: number | null;
  cardsTotal: number | null;
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

function valOrDash(v: number | null | undefined) {
  return v === null || v === undefined ? "-" : String(v);
}

function goalsClass(g: number) {
  return g >= 3 ? "text-green-600" : "text-red-600";
}

function cardsClass(c: number) {
  return c >= 5 ? "text-green-600" : "text-red-600";
}

function cornersClass(ck: number) {
  if (ck >= 12) return "text-green-700";
  if (ck >= 9) return "text-green-600";
  if (ck >= 6) return "text-green-500";
  return "text-red-600";
}

function isBlankMatch(m: MatchCard | null) {
  return !m || m.fixtureId === 0;
}

function countBlankTeams(leagues: LeagueBoard[]) {
  let blanks = 0;
  for (const l of leagues) {
    for (const t of l.teams ?? []) {
      const allBlank = (t.matches ?? []).every((m) => m.fixtureId === 0);
      if (allBlank) blanks++;
    }
  }
  return blanks;
}

async function fetchBoardsOnce(): Promise<LeagueBoard[]> {
  const r = await fetch("/api/leagueBoards", { cache: "no-store" });
  const j = await r.json();
  if (!j?.ok) throw new Error(j?.error ?? "Failed to load league boards");
  return j.leagues as LeagueBoard[];
}

/**
 * Try until complete:
 * - Retries until blankTeams === 0
 * - Or until maxMs time budget is reached
 */
async function fetchBoardsTryUntilComplete(opts?: {
  maxMs?: number;
  delayMs?: number;
  backoff?: boolean;
}): Promise<{ leagues: LeagueBoard[]; tries: number; complete: boolean }> {
  const maxMs = opts?.maxMs ?? 25_000;    // up to 25s total
  const delayMs = opts?.delayMs ?? 900;  // initial delay between tries
  const backoff = opts?.backoff ?? true;

  const start = Date.now();
  let tries = 0;
  let last: LeagueBoard[] = [];

  while (Date.now() - start < maxMs) {
    tries++;
    last = await fetchBoardsOnce();
    const blanks = countBlankTeams(last);
    if (blanks === 0) return { leagues: last, tries, complete: true };

    const wait = backoff ? Math.min(5000, delayMs * tries) : delayMs;
    await new Promise((r) => setTimeout(r, wait));
  }

  return { leagues: last, tries, complete: countBlankTeams(last) === 0 };
}

export default function Page() {
  const [leagues, setLeagues] = useState<LeagueBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");

  const blankTeams = useMemo(() => countBlankTeams(leagues), [leagues]);

  async function refreshTryUntilComplete() {
    setLoading(true);
    setStatus("Refreshing… (trying until complete)");
    try {
      const res = await fetchBoardsTryUntilComplete({
        maxMs: 25_000,
        delayMs: 900,
        backoff: true,
      });

      setLeagues(res.leagues);

      const blanks = countBlankTeams(res.leagues);
      if (blanks === 0) {
        setStatus(`Complete ✅ (tries: ${res.tries})`);
      } else {
        setStatus(`Stopped (time limit). Still blank teams: ${blanks} (tries: ${res.tries})`);
      }
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshTryUntilComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="p-6 space-y-12">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Soccer Dashboard</h1>
            <div className="text-sm text-gray-600">
              CK = Corner Kicks • G = Goals • C = Cards
            </div>
            <div className="text-xs text-gray-500">
              Goals: red ≤ 2, green ≥ 3 • Cards: red ≤ 4, green ≥ 5 • Corners: greener when higher
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              onClick={refreshTryUntilComplete}
              disabled={loading}
              className={`rounded-lg px-4 py-2 text-sm font-semibold border ${
                loading
                  ? "bg-gray-100 text-gray-400 border-gray-200"
                  : "bg-white hover:bg-gray-50 text-gray-900 border-gray-300"
              }`}
            >
              {loading ? "Trying…" : "Refresh (Try until complete)"}
            </button>

            <div className="text-xs text-gray-500">
              {status}
              {blankTeams > 0 ? ` • Blank teams: ${blankTeams}` : ""}
            </div>
          </div>
        </div>
      </div>

      {leagues.map((league) => (
        <section key={league.leagueId} className="space-y-4">
          <div className="flex items-end justify-between">
            <h2 className="text-4xl font-bold">{league.leagueName}</h2>
            {league.seasonUsed && (
              <div className="text-sm text-gray-500">Season: {league.seasonUsed}</div>
            )}
          </div>

          {league.error && (
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
              {league.error}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead>
                <tr className="text-left text-sm text-gray-600 border-b">
                  <th className="p-4 w-[260px]">Team</th>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <th key={i} className="p-4 min-w-[190px]">
                      Match {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {!league.teams?.length ? (
                  <tr>
                    <td className="p-6 text-gray-500" colSpan={8}>
                      No data returned for this league right now.
                    </td>
                  </tr>
                ) : (
                  league.teams.map((team) => {
                    const slots = Array.from({ length: 7 }).map((_, i) => team.matches?.[i] ?? null);

                    return (
                      <tr key={team.teamId} className="border-b last:border-0">
                        <td className="p-4 align-middle">
                          <div className="flex items-center gap-3">
                            <img src={team.logo} alt="" className="h-7 w-7 rounded" loading="lazy" />
                            <div className="font-semibold text-gray-900">{team.name}</div>
                          </div>
                        </td>

                        {slots.map((m, idx) => {
                          const blank = isBlankMatch(m);

                          const title = blank ? "-" : `${m!.opponent} (${m!.isHome ? "H" : "A"})`;
                          const date = blank ? "" : m!.date.slice(0, 10);

                          const g = blank ? null : m!.goalsTotal;
                          const ck = blank ? null : m!.cornersTotal;
                          const c = blank ? null : m!.cardsTotal;

                          return (
                            <td key={idx} className="p-4 align-top">
                              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-semibold text-sm text-gray-900 leading-snug">
                                    {title}
                                  </div>
                                  <div className="text-xs text-gray-500">{date}</div>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                                  <div className="text-gray-700 font-semibold">CK</div>
                                  <div
                                    className={
                                      ck === null || ck === undefined
                                        ? "text-gray-400 text-right"
                                        : `${cornersClass(ck)} text-right font-semibold`
                                    }
                                  >
                                    {valOrDash(ck)}
                                  </div>

                                  <div className="text-gray-700 font-semibold">G</div>
                                  <div
                                    className={
                                      g === null || g === undefined
                                        ? "text-gray-400 text-right"
                                        : `${goalsClass(g)} text-right font-semibold`
                                    }
                                  >
                                    {valOrDash(g)}
                                  </div>

                                  <div className="text-gray-700 font-semibold">C</div>
                                  <div
                                    className={
                                      c === null || c === undefined
                                        ? "text-gray-400 text-right"
                                        : `${cardsClass(c)} text-right font-semibold`
                                    }
                                  >
                                    {valOrDash(c)}
                                  </div>
                                </div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}
