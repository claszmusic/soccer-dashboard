import { buildLeagueBoard } from "../lib/leagueData";

function numOrDash(v?: number) {
  return typeof v === "number" ? v : "-";
}

// Goals: red ≤ 2, green ≥ 3
function goalClass(g?: number) {
  if (typeof g !== "number") return "text-slate-400";
  return g >= 3 ? "text-green-600" : "text-red-600";
}

// Cards: red ≤ 4, green ≥ 5
function cardsClass(c?: number) {
  if (typeof c !== "number") return "text-slate-400";
  return c >= 5 ? "text-green-600" : "text-red-600";
}

// Corners: greener when higher (simple steps)
function cornersClass(ck?: number) {
  if (typeof ck !== "number") return "text-slate-400";
  if (ck >= 10) return "text-green-700";
  if (ck >= 7) return "text-green-600";
  if (ck >= 5) return "text-green-500";
  return "text-red-600";
}

function cardBgClass() {
  return "bg-rose-50 border-rose-200";
}

export default async function Page() {
  const season = 2026; // your target season (leagueData.ts will fallback to previous if needed)

  const leagues = [
    { leagueName: "Liga MX", country: "Mexico" },
    { leagueName: "Premier League", country: "England" },
    { leagueName: "Bundesliga", country: "Germany" },
    { leagueName: "La Liga", country: "Spain" },
    { leagueName: "Serie A", country: "Italy" },
  ];

  const boards = await Promise.all(
    leagues.map((l) =>
      buildLeagueBoard({
        leagueName: l.leagueName,
        country: l.country,
        season,
        columns: 7, // last 7 FT matches
      })
    )
  );

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Soccer Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          CK = Corner Kicks · G = Goals · C = Cards
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Goals: red ≤ 2, green ≥ 3 · Cards: red ≤ 4, green ≥ 5 · Corners: greener when higher
        </p>

        <div className="mt-8 space-y-12">
          {boards.map((board) => (
            <section key={board.leagueTitle}>
              <h2 className="text-3xl font-extrabold text-slate-900">{board.leagueTitle}</h2>
              <div className="mt-2 h-1 w-24 rounded bg-blue-600" />

              <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200">
                <div className="min-w-[980px]">
                  {/* Header row */}
                  <div className="grid grid-cols-[220px_repeat(7,1fr)] gap-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-sm font-semibold text-slate-700">Team</div>
                    {Array.from({ length: 7 }).map((_, i) => (
                      <div key={i} className="text-center text-xs font-semibold text-slate-600">
                        Match {i + 1}
                      </div>
                    ))}
                  </div>

                  {/* Rows */}
                  {board.rows.map((row) => (
                    <div
                      key={row.teamId}
                      className="grid grid-cols-[220px_repeat(7,1fr)] gap-0 border-b border-slate-100 px-4 py-4"
                    >
                      <div className="flex items-center pr-4 text-sm font-semibold text-slate-900">
                        {row.teamName}
                      </div>

                      {row.cells.map((cell, idx) => {
                        const topLabel =
                          cell.opponent && cell.homeAway
                            ? `${cell.opponent} (${cell.homeAway})`
                            : "-";

                        return (
                          <div key={idx} className="flex items-center justify-center">
                            <div
                              className={`w-[110px] rounded-2xl border p-3 text-xs ${cardBgClass()}`}
                            >
                              <div className="mb-2 text-[11px] font-semibold text-slate-800">
                                {topLabel}
                              </div>

                              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                                <div className="font-semibold text-rose-700">CK</div>
                                <div className={`text-right font-semibold ${cornersClass(cell.ck)}`}>
                                  {numOrDash(cell.ck)}
                                </div>

                                <div className="font-semibold text-slate-600">G</div>
                                <div className={`text-right font-semibold ${goalClass(cell.g)}`}>
                                  {numOrDash(cell.g)}
                                </div>

                                <div className="font-semibold text-slate-600">C</div>
                                <div className={`text-right font-semibold ${cardsClass(cell.c)}`}>
                                  {numOrDash(cell.c)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
