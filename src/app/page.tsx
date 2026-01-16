import { buildLeagueBoard } from "@/lib/leagueData";

function statClass(value: number | undefined, kind: "ck" | "g" | "c") {
  if (value === undefined) return "text-slate-400";

  if (kind === "g") return value <= 2 ? "text-red-600" : "text-green-600";
  if (kind === "c") return value <= 4 ? "text-red-600" : "text-green-600";

  // CK: greener when higher
  if (value >= 10) return "text-green-700";
  if (value >= 8) return "text-green-600";
  if (value >= 6) return "text-green-500";
  return "text-red-600";
}

function Card({ cell }: { cell: any }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm w-[92px]">
      <div className="mb-1 text-[11px] font-semibold text-slate-700 leading-tight">
        {cell?.opponent ? (
          <>
            {cell.opponent}
            {cell.homeAway ? <span className="text-slate-500"> ({cell.homeAway})</span> : null}
          </>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-semibold text-red-600">CK</span>
        <span className={statClass(cell?.ck, "ck")}>{cell?.ck ?? "-"}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-600">G</span>
        <span className={statClass(cell?.g, "g")}>{cell?.g ?? "-"}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-600">C</span>
        <span className={statClass(cell?.c, "c")}>{cell?.c ?? "-"}</span>
      </div>
    </div>
  );
}

function LeagueTable({ board }: { board: Awaited<ReturnType<typeof buildLeagueBoard>> }) {
  const cols = Array.from({ length: board.columns }, (_, i) => i + 1);

  return (
    <section className="mb-10">
      <h2 className="text-3xl font-extrabold tracking-tight">{board.leagueTitle}</h2>
      <div className="mt-2 h-1 w-24 bg-blue-600 rounded" />

      <div className="mt-4 overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-[980px] w-full">
          <thead>
            <tr className="text-left text-slate-600 text-sm">
              <th className="px-6 py-4 w-[240px]">Team</th>
              {cols.map((n) => (
                <th key={n} className="px-3 py-4 text-center">
                  {n}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {board.rows.map((r) => (
              <tr key={r.teamId} className="border-t">
                <td className="px-6 py-6 font-semibold text-slate-900">{r.teamName}</td>
                {r.cells.map((cell: any, idx: number) => (
                  <td key={idx} className="px-3 py-4 align-top">
                    <Card cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-xs text-slate-500">
        Columns = last {board.columns} matches per team. (H)=Home, (A)=Away. CK/C usually appear after FT.
      </div>
    </section>
  );
}

export default async function Page() {
  const season = 2026;

  const leagues = [
    { leagueName: "Liga MX", country: "Mexico" },
    { leagueName: "Premier League", country: "England" },
    { leagueName: "Bundesliga", country: "Germany" },
    { leagueName: "La Liga", country: "Spain" },
    { leagueName: "Serie A", country: "Italy" },
  ];

  const boards = await Promise.all(
    leagues.map((l) => buildLeagueBoard({ ...l, season, columns: 7 }))
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-4xl font-extrabold tracking-tight">Soccer Dashboard</h1>
      <p className="mt-1 text-slate-600">CK = Corner Kicks · G = Goals · C = Cards</p>
      <p className="text-xs text-slate-500 mt-1">
        Goals: red ≤ 2, green ≥ 3 · Cards: red ≤ 4, green ≥ 5 · Corner kicks: greener when higher
      </p>

      <div className="mt-10 space-y-10">
        {boards.map((b) => (
          <LeagueTable key={b.leagueTitle} board={b} />
        ))}
      </div>
    </main>
  );
}
