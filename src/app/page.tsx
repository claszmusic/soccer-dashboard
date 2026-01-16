// src/app/page.tsx
import { buildLeagueBoard } from "@/lib/leagueData";

export const dynamic = "force-dynamic"; // IMPORTANT: don't prerender + cache empty data
export const revalidate = 0;

const LEAGUES = [
  { leagueName: "Liga MX", country: "Mexico" },
  { leagueName: "Premier League", country: "England" },
  { leagueName: "Bundesliga", country: "Germany" },
  { leagueName: "La Liga", country: "Spain" },
  { leagueName: "Serie A", country: "Italy" },
];

function badgeClass(kind: "g" | "c" | "ck", val?: number) {
  if (val === undefined) return "text-slate-400";
  if (kind === "g") return val >= 3 ? "text-green-600" : "text-red-600";
  if (kind === "c") return val >= 5 ? "text-green-600" : "text-red-600";
  // corners: greener when higher
  return val >= 8 ? "text-green-600" : "text-red-600";
}

function CellCard(props: { opponent?: string; ck?: number; g?: number; c?: number }) {
  const { opponent, ck, g, c } = props;

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/60 px-3 py-2 min-h-[92px] w-[120px]">
      <div className="text-xs font-semibold text-slate-700 leading-tight min-h-[28px]">
        {opponent ?? "-"}
      </div>

      <div className="mt-1 grid grid-cols-[28px_1fr] gap-x-2 text-sm">
        <div className="text-red-600 font-bold">CK</div>
        <div className={`text-right font-bold ${badgeClass("ck", ck)}`}>{ck ?? "-"}</div>

        <div className="text-slate-600 font-bold">G</div>
        <div className={`text-right font-bold ${badgeClass("g", g)}`}>{g ?? "-"}</div>

        <div className="text-slate-600 font-bold">C</div>
        <div className={`text-right font-bold ${badgeClass("c", c)}`}>{c ?? "-"}</div>
      </div>
    </div>
  );
}

function LeagueTable({ board }: { board: Awaited<ReturnType<typeof buildLeagueBoard>> }) {
  if (board.error) {
    return (
      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <div className="font-bold">Error from API</div>
        <div className="mt-1 break-words">{board.error}</div>
        <div className="mt-2 text-xs text-red-700/80">
          (This usually means: missing APISPORTS_KEY in Vercel Production, or API returned 401/403/429)
        </div>
      </div>
    );
  }

  if (!board.rows || board.rows.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        No rows returned.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[900px] w-full">
        <thead>
          <tr className="bg-slate-50 text-left text-sm text-slate-700">
            <th className="p-4 w-[240px]">Team</th>
            {Array.from({ length: 7 }).map((_, i) => (
              <th key={i} className="p-4 text-center">
                Match {i + 1}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {board.rows.map((r) => (
            <tr key={r.teamId} className="border-t border-slate-100 align-top">
              <td className="p-4 font-semibold text-slate-900">{r.teamName}</td>
              {r.cells.map((cell, idx) => (
                <td key={idx} className="p-4">
                  <CellCard opponent={cell.opponent} ck={cell.ck} g={cell.g} c={cell.c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Page() {
  // Run all leagues safely (do not let one failure blank the whole page)
  const results = await Promise.all(
    LEAGUES.map(async (l) => {
      try {
        const board = await buildLeagueBoard({ leagueName: l.leagueName, country: l.country, columns: 7 });
        return { key: l.leagueName, board };
      } catch (e: any) {
        return {
          key: l.leagueName,
          board: {
            leagueTitle: l.leagueName,
            season: new Date().getFullYear(),
            rows: [],
            error: e?.message ?? String(e),
          },
        };
      }
    })
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900">Soccer Dashboard</h1>
      <div className="mt-2 text-sm text-slate-600">
        CK = Corner Kicks · G = Goals · C = Cards
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Goals: red ≤ 2, green ≥ 3 · Cards: red ≤ 4, green ≥ 5 · Corners: greener when higher
      </div>

      <div className="mt-10 space-y-14">
        {results.map(({ key, board }) => (
          <section key={key}>
            <h2 className="text-4xl font-extrabold text-slate-900">{board.leagueTitle}</h2>
            <div className="mt-2 h-1 w-24 rounded bg-blue-600" />
            <LeagueTable board={board as any} />
          </section>
        ))}
      </div>
    </main>
  );
}
