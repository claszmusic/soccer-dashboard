export const dynamic = "force-dynamic";

async function fetchBoards() {
  const res = await fetch("/api/leagueboards", {
    cache: "no-store",
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {}

  if (!res.ok || !json?.ok) {
    return { ok: false as const, error: json?.error ?? `HTTP ${res.status}` };
  }

  return { ok: true as const, data: json.data };
}

export default async function HomePage() {
  const result = await fetchBoards();

  if (!result.ok) {
    return (
      <main className="p-6">
        <h1 className="text-3xl font-bold">Soccer Dashboard</h1>
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          Error loading boards: {result.error}
        </div>
      </main>
    );
  }

  const boards = result.data;

  return (
    <main className="p-6">
      <h1 className="text-3xl font-bold">Soccer Dashboard</h1>

      {boards.map((board: any) => (
        <section key={board.leagueId} className="mt-10">
          <h2 className="text-4xl font-black">{board.leagueName}</h2>

          {board.error && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
              {board.error}
            </div>
          )}

          {!board.teams?.length ? (
            <div className="mt-4 rounded-lg border p-4 text-gray-600">
              No data returned for this league right now.
            </div>
          ) : (
            <div className="mt-4 text-green-700">
              Data received for {board.teams.length} teams.
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
