// src/app/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { buildLeagueBoard, LeagueBoard, MatchCell } from "@/lib/leagueData";

function numClassGoals(g?: number) {
  if (typeof g !== "number") return "text-slate-400";
  return g <= 2 ? "text-red-600" : "text-green-600";
}
function numClassCards(c?: number) {
  if (typeof c !== "number") return "text-slate-400";
  return c <= 4 ? "text-red-600" : "text-green-600";
}
function numClassCorners(ck?: number) {
  if (typeof ck !== "number") return "text-slate-400";
  // “Greener when higher”
  if (ck >= 9) return "text-green-700";
  if (ck >= 6) return "text-green-600";
  if (ck >= 4) return "text-amber-600";
  return "text-red-600";
}

function CellCard({ cell }: { cell: MatchCell }) {
  const opponent = cell.opponent ?? "—";
  const ck = typeof cell.ck === "number" ? cell.ck : "—";
  const g = typeof cell.g === "number" ? cell.g : "—";
  const c = typeof cell.c === "number" ? cell.c : "—";

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
      <div className="mb-1 truncate text-xs font-semibold text-slate-800">{opponent}</div>

      {/* Combined line (CK / G / C together) */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-rose-700">CK</span>
        <span className={`font-semibold ${numClassCorners(cell.ck)}`}>{ck}</span>

        <span className="ml-2 font-semibold text-slate-700">G</span>
        <span className={`font-semibold ${numClassGoals(cell.g)}`}>{g}</span>

        <span className="ml-2 font-semibold text-slate-700">C</span>
        <span className={`font-semibold ${numClassCards(cell.c)}`}>{c}</span>
      </div>
    </div>
  );
}

function LeagueTable({ board }: { board: LeagueBoard }) {
  const cols = board.columns;

  return (
    <div className="mb-14">
      <h2 className="text-3xl font-extrabold tracking-tight">{board.leagueTitle}</h2>
      <div className="mt-2 h-1 w-24 rounded bg-blue-600" />

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-[1100px] w-full border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-700">
                Team
              </th>
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} className="px-3 py-3 text-center text-sm font-semibold text-slate-600">
                  Match {i + 1}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {board.rows.map((r) => (
              <tr key={r.teamId} className="border-t border-slate-100">
                <td className="sticky left-0 z-10 bg-white px-4 py-4 font-semibold text-slate-900">
                  {r.teamName}
                </td>

                {r.cells.map((cell, idx) => (
                  <td key={idx} className="px-3 py-3 align-top">
                    <CellCard cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function Page() {
  // If you want 2026 only, keep 2026.
  // If a league season isn’t available yet, the code auto-falls back to previous season for leagueId.
  const season = 2026;

  const leagues = [
    { leagueName: "Liga MX", country: "Mexico" },
    { leagueName: "Premier League", country: "England" },
    { leagueName: "Bundesliga", country: "Germany" },
    { leagueName: "La Liga", country: "Spain" },
    { leagueName: "Serie A", country: "Italy" },
  ];

  // build boards one by one (simple + reliable)
  const boards: LeagueBoard[] = [];
  for (const l of leagues) {
    try {
      const b = await buildLeagueBoard({ ...l, season, columns: 7 });
      boards.push(b);
    } catch (e) {
      // If one league errors, show empty board instead of breaking whole page
      boards.push({
        leagueTitle: l.leagueName,
        season,
        columns: 7,
        rows: [],
      });
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-extrabold tracking-tight">Soccer Dashboard</h1>
      <p className="mt-1 text-sm text-slate-600">CK = Corner Kicks · G = Goals · C = Cards</p>
      <p className="mt-1 text-xs text-slate-500">
        Goals: red ≤ 2, green ≥ 3 · Cards: red ≤ 4, green ≥ 5 · Corners: greener when higher
      </p>

      <div className="mt-8 space-y-10">
        {boards.map((b) =>
          b.rows.length ? <LeagueTable key={b.leagueTitle} board={b} /> : (
            <div key={b.leagueTitle} className="mb-14">
              <h2 className="text-3xl font-extrabold tracking-tight">{b.leagueTitle}</h2>
              <div className="mt-2 h-1 w-24 rounded bg-blue-600" />
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                No data returned for this league/season right now.
              </div>
            </div>
          )
        )}
      </div>
    </main>
  );
}
