import { buildLeagueBoard, MatchCell } from "@/lib/leagueData";

const SEASON = new Date().getFullYear(); // will fallback inside leagueData.ts if needed


const LEAGUES = [
  { leagueName: "Liga MX", country: "Mexico" },
  { leagueName: "Premier League", country: "England" },
  { leagueName: "Bundesliga", country: "Germany" },
  { leagueName: "La Liga", country: "Spain" },
  { leagueName: "Serie A", country: "Italy" },
];

function ckTier(ck?: number) {
  if (ck === undefined) return 0;
  if (ck >= 10) return 4;
  if (ck >= 7) return 3;
  if (ck >= 4) return 2;
  return 1;
}

function ckStyles(ck?: number) {
  // Higher CK => greener
  const tier = ckTier(ck);
  switch (tier) {
    case 4:
      return { bg: "bg-emerald-100 border-emerald-200", ck: "text-emerald-800" };
    case 3:
      return { bg: "bg-emerald-50 border-emerald-200", ck: "text-emerald-700" };
    case 2:
      return { bg: "bg-amber-50 border-amber-200", ck: "text-amber-700" };
    default:
      return { bg: "bg-rose-50 border-rose-200", ck: "text-rose-700" };
  }
}

function goalsColor(g?: number) {
  // 2 or less red, 3+ green
  if (g === undefined) return "text-slate-500";
  return g >= 3 ? "text-emerald-700" : "text-rose-700";
}

function cardsColor(c?: number) {
  // 4 or less red, 5+ green
  if (c === undefined) return "text-slate-500";
  return c >= 5 ? "text-emerald-700" : "text-rose-700";
}

function CellCard({ cell }: { cell: MatchCell }) {
  const s = ckStyles(cell.ck);

  return (
    <div className={`w-20 rounded-xl border ${s.bg} px-3 py-2 text-sm leading-5`}>
      <div className={`font-semibold ${s.ck}`}>
        CK <span className="float-right">{cell.ck ?? "-"}</span>
      </div>
      <div className={`font-semibold ${goalsColor(cell.g)}`}>
        G <span className="float-right">{cell.g ?? "-"}</span>
      </div>
      <div className={`font-semibold ${cardsColor(cell.c)}`}>
        C <span className="float-right">{cell.c ?? "-"}</span>
      </div>
    </div>
  );
}

export default async function Home() {
  const boards = await Promise.all(
    LEAGUES.map((l) =>
      buildLeagueBoard({
        leagueName: l.leagueName,
        country: l.country,
        season: SEASON,
        columns: 7,
      })
    )
  );

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="text-2xl font-bold">Soccer Dashboard</h1>
      <p className="text-sm text-slate-600">CK = Corner Kicks · G = Goals · C = Cards</p>
      <p className="mt-1 text-xs text-slate-500">
        Goals: red ≤ 2, green ≥ 3 · Cards: red ≤ 4, green ≥ 5 · Corner kicks: greener when higher
      </p>

      <div className="mt-6 space-y-10">
        {boards.map((board) => (
          <section key={board.leagueTitle}>
            <div className="mb-3">
              <h2 className="text-3xl font-extrabold">{board.leagueTitle}</h2>
              <div className="mt-2 h-1 w-24 rounded bg-blue-600" />
            </div>

            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="min-w-full border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-sm text-slate-600">
                    <th className="sticky left-0 z-10 bg-white px-4 py-3">Team</th>
                    {board.dateColumns.map((d) => (
                      <th key={d} className="px-4 py-3">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {board.rows.map((r) => (
                    <tr key={r.teamId} className="border-t">
                      <td className="sticky left-0 z-10 bg-white px-4 py-5 font-semibold">
                        {r.teamName}
                      </td>

                      {r.cells.map((cell) => (
                        <td key={`${r.teamId}-${cell.dateLabel}`} className="px-4 py-4 align-top">
                          <CellCard cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
