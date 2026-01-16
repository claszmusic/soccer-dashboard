import { buildLeagueBoard, LeagueBoard } from "@/lib/leagueData";

const LEAGUES = [
  { title: "Liga MX", country: "Mexico", leagueName: "Liga MX" },
  { title: "Premier League", country: "England", leagueName: "Premier League" },
  { title: "Bundesliga", country: "Germany", leagueName: "Bundesliga" },
  { title: "La Liga", country: "Spain", leagueName: "La Liga" },
  { title: "Serie A", country: "Italy", leagueName: "Serie A" },
];

function statColor(type: "G" | "C" | "CK", value: number) {
  // Your rules
  if (type === "G") return value <= 2 ? "text-red-600" : "text-green-600";
  if (type === "C") return value <= 4 ? "text-red-600" : "text-green-600";
  // corners: greener when higher
  return value >= 8 ? "text-green-600" : value >= 5 ? "text-green-500" : "text-red-600";
}

function MatchCard({
  opponent,
  homeAway,
  ck,
  g,
  c,
}: {
  opponent: string;
  homeAway: "H" | "A";
  ck: number;
  g: number;
  c: number;
}) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-3 w-[120px]">
      <div className="text-xs font-semibold text-slate-800 mb-2 leading-tight">
        {opponent} ({homeAway})
      </div>

      <div className="flex justify-between text-sm">
        <span className="font-semibold text-red-600">CK</span>
        <span className={`font-bold ${statColor("CK", ck)}`}>{ck}</span>
      </div>

      <div className="flex justify-between text-sm">
        <span className="font-semibold text-slate-600">G</span>
        <span className={`font-bold ${statColor("G", g)}`}>{g}</span>
      </div>

      <div className="flex justify-between text-sm">
        <span className="font-semibold text-slate-600">C</span>
        <span className={`font-bold ${statColor("C", c)}`}>{c}</span>
      </div>
    </div>
  );
}

function EmptyCard() {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-3 w-[120px]">
      <div className="text-xs font-semibold text-slate-800 mb-2">—</div>
      <div className="flex justify-between text-sm">
        <span className="font-semibold text-red-600">CK</span>
        <span className="font-bold text-slate-400">-</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="font-semibold text-slate-600">G</span>
        <span className="font-bold text-slate-400">-</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="font-semibold text-slate-600">C</span>
        <span className="font-bold text-slate-400">-</span>
      </div>
    </div>
  );
}

function LeagueSection({ title, board }: { title: string; board: LeagueBoard }) {
  return (
    <section className="mb-12">
      <h2 className="text-4xl font-extrabold text-slate-900">{title}</h2>
      <div className="h-1 w-24 bg-blue-600 rounded mt-2 mb-6" />

      {/* If league returns no teams, show message but DO NOT crash */}
      {board.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-slate-600">
          No data returned for this league right now.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          {/* header */}
          <div className="min-w-[980px] grid grid-cols-[220px_repeat(7,140px)] gap-0 border-b border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
            <div>Team</div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="text-center">
                Match {i + 1}
              </div>
            ))}
          </div>

          {/* rows */}
          <div className="min-w-[980px]">
            {board.rows.map((row) => (
              <div
                key={row.teamId}
                className="grid grid-cols-[220px_repeat(7,140px)] p-4 border-b border-slate-100"
              >
                <div className="font-bold text-slate-900 flex items-center">
                  {row.teamName}
                </div>

                {Array.from({ length: 7 }).map((_, i) => {
                  const m = row.matches[i];
                  return (
                    <div key={i} className="flex justify-center">
                      {m ? (
                        <MatchCard
                          opponent={m.opponent}
                          homeAway={m.homeAway}
                          ck={m.ck}
                          g={m.g}
                          c={m.c}
                        />
                      ) : (
                        <EmptyCard />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default async function Page() {
  // IMPORTANT: we fetch on the server; errors handled so UI never disappears
  const boards = await Promise.all(
    LEAGUES.map(async (l) => {
      try {
        const board = await buildLeagueBoard({
          leagueName: l.leagueName,
          country: l.country,
        });
        return { title: l.title, board };
      } catch {
        return { title: l.title, board: { leagueTitle: l.title, rows: [] } as LeagueBoard };
      }
    })
  );

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900">Soccer Dashboard</h1>
      <p className="text-slate-600 mt-1">CK = Corner Kicks · G = Goals · C = Cards</p>
      <p className="text-slate-500 text-sm mt-1">
        Goals: red ≤ 2, green ≥ 3 · Cards: red ≤ 4, green ≥ 5 · Corners: greener when higher
      </p>

      <div className="mt-10">
        {boards.map(({ title, board }) => (
          <LeagueSection key={title} title={title} board={board} />
        ))}
      </div>
    </main>
  );
}
