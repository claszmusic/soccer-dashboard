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
  return !m || !m.fixtureId;
}

function countBlankTeams(leagues: LeagueBoard[]) {
  let blanks = 0;
  for (const l of leagues) {
    for (const t of l.teams ?? []) {
      const slots = Array.from({ length: 7 }).map((_, i) => t.matches?.[i] ?? null);
      const allBlank = slots.every((m) => isBlankMatch(m));
      if (allBlank) blanks++;
    }
  }
  return blanks;
}

async function fetchBoardsOnce(): Promise<LeagueBoard[]> {
  const r = await fetch("/api/leagueboards", { cache: "no-store" });
  const j = await r.json();
  if (!j?.ok) throw new Error(j?.error ?? "Failed to load league boards");
  return j.leagues as LeagueBoard[];
}

async function fetchBoardsTryUntilComplete(opts?: {
  maxMs?: number;
  delayMs?: number;
  backoff?: boolean;
}): Promise<{ leagues: LeagueBoard[]; tries: number; complete: boolean }> {
  const maxMs = opts?.maxMs ?? 25_000;
  const delayMs = opts?.delayMs ?? 900;
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
  }, []);

  return (
    <main className="p-6 space-y-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Soccer Dashboard</h1>
          <div className="text-sm text-gray-600">
            CK = Corner Kicks • G = Goals • C = Cards
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
            {loading ? "Trying…" : "Refresh"}
          </button>

          <div className="text-xs text-gray-500">
            {status}
            {blankTeams > 0 ? ` • Blank teams: ${blankTeams}` : ""}
          </div>
        </div>
      </div>

      {leagues.map((league) => (
        <section key={league.leagueId} className="space-y-4">
          <h2 className="text-4xl font-bold">{league.leagueName}</h2>

          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full min-w-[1100px]">
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
                {league.teams.map((team) => {
                  const slots = Array.from({ length: 7 }).map(
                    (_, i) => team.matches?.[i] ?? null
                  );

                  return (
                    <tr key={team.teamId} className="border-b last:border-0">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <img src={team.logo} className="h-7 w-7 rounded" />
                          <div className="font-semibold">{team.name}</div>
                        </div>
                      </td>

                      {slots.map((m, idx) => {
                        const blank = isBlankMatch(m);

                        const g = blank ? null : m!.goalsTotal;
                        const ck = blank ? null : m!.cornersTotal;
                        const c = blank ? null : m!.cardsTotal;

                        return (
                          <td key={idx} className="p-4">
                            <div className="rounded-xl border p-3 bg-red-50">
                              <div className="grid grid-cols-2 text-sm gap-y-1">
                                <div>CK</div>
                                <div className={ck === null ? "" : cornersClass(ck)}>
                                  {valOrDash(ck)}
                                </div>

                                <div>G</div>
                                <div className={g === null ? "" : goalsClass(g)}>
                                  {valOrDash(g)}
                                </div>

                                <div>C</div>
                                <div className={c === null ? "" : cardsClass(c)}>
                                  {valOrDash(c)}
                                </div>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}
