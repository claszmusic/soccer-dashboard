import { buildLeagueBoard } from "@/lib/leagueData";

function colorForCards(v?: number) {
  if (v == null) return "text-slate-400";
  return v >= 5 ? "text-green-600" : "text-red-600";
}
function colorForGoals(v?: number) {
  if (v == null) return "text-slate-400";
  return v >= 3 ? "text-green-600" : "text-red-600";
}
function colorForCorners(v?: number) {
  if (v == null) return "text-slate-400";
  return v >= 8 ? "text-green-600" : "text-red-600";
}

function Cell({ cell }: any) {
  const opp = cell?.opponent ?? "-";
  const ck = cell?.ck;
  const g = cell?.g;
  const c = cell?.c;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 w-[120px]">
      <div className="text-xs font-semibold text-slate-700 mb-1">{opp}</div>

      <div className="flex justify-between text-sm">
        <span className="font-semibold text-red-600">CK</span>
        <span className={`font-bold ${colorForCorners(ck)}`}>{ck ?? "-"}</span>
      </div>

      <div className="flex justify-between text-sm">
        <span className="font-semibold text-slate-700">G</span>
        <span className={`font-bold ${colorForGoals(g)}`}>{g ?? "-"}</span>
      </div>

      <div className="flex justify-between text-sm">
        <span className="font-semibold text-slate-700">C</span>
        <span className={`font-bold ${colorForCards(c)}`}>{c ?? "-"}</span>
      </div>
    </div>
  );
}

async function LeagueSection({ title, country }: { title: string; country: string }) {
  const board = await buildLeagueBoard({ leagueName: title, country, columns: 7 });

  // If API returns nothing, show message
  if (!board.rows || board.rows.length === 0) {
    return (
      <section className="mb-14">
        <h2 className="text-4xl font-black mb-2">{title}</h2>
        <div className="h-1 w-24 bg-blue-600 rounded mb-6" />
        <div className="rounded-xl border p-4 text-slate-600">
          No data returned for this league right now.
        </div>
      </section>
    );
  }

  const headers = ["Match 1","Match 2","Match 3","Match 4","Match 5","Match 6","Match 7"];

  return (
    <section className="mb-14">
      <h2 className="text-4xl font-black mb-2">{title}</h2>
      <div className="h-1 w-24 bg-blue-600 rounded mb-6" />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-[980px] w-full">
          <thead className="bg-slate-50">
            <tr className="text-left text-sm text-slate-700">
              <th className="p-4 w-[220px]">Team</th>
              {headers.map((h) => (
                <th key={h} className="p-4">{h}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {board.rows.map((r) => (
              <tr key={r.teamId} className="border-t">
