import { getLeagueBoards } from "@/lib/leagueData";

function valOrDash(v: number | null | undefined) {
  return v === null || v === undefined ? "-" : String(v);
}

function goalsClass(g: number) {
  // Goals: red ≤ 2, green ≥ 3
  return g >= 3 ? "text-green-600" : "text-red-600";
}

function cardsClass(c: number) {
  // Cards: red ≤ 4, green ≥ 5
  return c >= 5 ? "text-green-600" : "text-red-600";
}

function cornersClass(ck: number) {
  // Corners: "greener when higher"
  // simple tiers:
  if (ck >= 12) return "text-green-700";
  if (ck >= 9) return "text-green-600";
  if (ck >= 6) return "text-green-500";
  return "text-red-600";
}

export default async function Page() {
  const leagues = await getLeagueBoards();

  return (
    <main className="p-6 space-y-12">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Soccer Dashboard</h1>
        <div className="text-sm text-gray-600">
          CK = Corner Kicks • G = Goals • C = Cards
        </div>
        <div className="text-xs text-gray-500">
          Goals: red ≤ 2, green ≥ 3 • Cards: red ≤ 4, green ≥ 5 • Corners: greener when higher
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
                        {/* Team cell */}
                        <td className="p-4 align-middle">
                          <div className="flex items-center gap-3">
                            <img
                              src={team.logo}
                              alt=""
                              className="h-7 w-7 rounded"
                              loading="lazy"
                            />
                            <div className="font-semibold text-gray-900">{team.name}</div>
                          </div>
                        </td>

                        {/* Match cards */}
                        {slots.map((m, idx) => {
                          const title = m ? `${m.opponent} (${m.isHome ? "H" : "A"})` : "-";
                          const date = m ? m.date.slice(0, 10) : "";

                          const g = m ? m.goalsTotal : null;
                          const ck = m ? m.cornersTotal : null;
                          const c = m ? m.cardsTotal : null;

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
