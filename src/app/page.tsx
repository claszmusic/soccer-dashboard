import { getLeagueBoards } from "@/lib/leagueData";

export default async function Page() {
  const leagues = await getLeagueBoards();

  return (
    <main className="p-6 space-y-12">
      <h1 className="text-3xl font-bold">Soccer Dashboard</h1>
      <p className="text-sm text-gray-500">
        CK = Corners • G = Goals • C = Cards
      </p>

      {leagues.map((league) => (
        <section key={league.leagueId} className="space-y-4">
          <h2 className="text-2xl font-semibold border-b pb-1">
            {league.leagueName}
          </h2>

          {league.error && (
            <div className="text-red-600">{league.error}</div>
          )}

          {!league.teams.length && (
            <div className="text-gray-500">No teams returned.</div>
          )}

          {league.teams.map((team) => (
            <div key={team.teamId} className="border rounded-lg p-3">
              <div className="flex items-center gap-3 mb-2">
                <img src={team.logo} alt="" className="w-6 h-6" />
                <span className="font-semibold">{team.name}</span>
              </div>

              {!team.matches.length && (
                <div className="text-sm text-gray-500">
                  No matches found.
                </div>
              )}

              {team.matches.length > 0 && (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left border-b">
                      <th>Date</th>
                      <th>Opponent</th>
                      <th>H/A</th>
                      <th>G</th>
                      <th>CK</th>
                      <th>C</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.matches.map((m) => (
                      <tr key={m.fixtureId} className="border-b last:border-0">
                        <td>{m.date.slice(0, 10)}</td>
                        <td>{m.opponent}</td>
                        <td>{m.isHome ? "H" : "A"}</td>
                        <td>{m.goalsFor}</td>
                        <td>{m.corners}</td>
                        <td>{m.cards}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
