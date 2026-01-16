import { getLeagueBoards, type MatchRow, type TeamRow } from "@/lib/leagueData";

function goalsClass(g: number) {
  // Goals: red <= 2, green >= 3
  return g >= 3 ? "text-green-700" : "text-red-700";
}

function cardsClass(c: number) {
  // Cards: red <= 4, green >= 5
  return c >= 5 ? "text-green-700" : "text-red-700";
}

function cornersClass(ck: number) {
  // Corners: "greener when higher" (simple steps)
  if (ck >= 10) return "text-green-700";
  if (ck >= 8) return "text-lime-700";
  if (ck >= 6) return "text-amber-700";
  return "text-red-700";
}

function formatDate(iso: string) {
  return iso?.slice(0, 10) ?? "";
}

function matchLabel(m: MatchRow) {
  return `${m.opponent} (${m.isHome ? "H" : "A"})`;
}

function StatLine({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-semibold">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}

function MatchCard({ m }: { m: MatchRow | null }) {
  if (!m) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
        <div className="font-semibold text-gray-600">-</div>
        <div className="mt-2 space-y-1 text-gray-400">
          <StatLine label="CK" value="-" />
          <StatLine label="G" value="-" />
          <StatLine label="C" value="-" />
        </div>
      </div>
    );
  }

  const ck = m.corners;
  const c = m.cards;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-gray-800">{matchLabel(m)}</div>
        <div className="text-xs text-gray-500">{formatDate(m.date)}</div>
      </div>

      <div className="mt-2 space-y-1">
        <StatLine
          label="CK"
          value={ck === null ? "-" : String(ck)}
          className={ck === null ? "text-gray-400" : cornersClass(ck)}
        />
        <StatLine label="G" value={String(m.goalsFor)} className={goalsClass(m.goalsFor)} />
        <StatLine
          label="C"
          value={c === null ? "-" : String(c)}
          className={c === null ? "text-gray-400" : cardsClass(c)}
        />
      </div>
    </div>
  );
}

function TeamRowGrid({ team, matchesToShow }: { team: TeamRow; matchesToShow: number }) {
  const matches = team.matches ?? [];
  const padded: (MatchRow | null)[] = Array.from({ length: matchesToShow }, (_, i) => matches[i] ?? null);

  return (
    <div className="grid grid-cols-[220px_repeat(7,minmax(160px,1fr))] gap-4 items-stretch border-t py-6">
      <div className="flex items-center gap-3">
        <img src={team.logo} alt="" className="h-8 w-8" />
        <div className="font-semibold text-gray-900">{team.name}</div>
      </div>

      {padded.map((m, idx) => (
        <MatchCard key={m?.fixtureId ?? `empty-${idx}`} m={m} />
      ))}
    </div>
  );
}

export default async function Page() {
  const leagues = await getLeagueBoards();
  const matchesToShow = 7;

  return (
    <main className="p-6 space-y-16">
      <div>
        <h1 className="text-3xl font-bold">Soccer Dashboard</h1>
        <div className="mt-2 text-sm text-gray-600">
          CK = Corner Kicks · G = Goals · C = Cards
        </div>
        <div className="mt-1 text-sm text-gray-500">
          Goals: red ≤ 2, green ≥ 3 · Cards: red ≤ 4, green ≥ 5 · Corners: greener when higher
        </div>
      </div>

      {leagues.map((league) => (
        <section key={league.leagueId} className="space-y-4">
          <div className="flex items-end justify-between">
            <h2 className="text-4xl font-black">{league.leagueName}</h2>
            {league.seasonUsed && (
              <div className="text-sm text-gray-500">Season: {league.seasonUsed}</div>
            )}
          </div>

          {league.error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
              {league.error}
            </div>
          )}

          <div className="rounded-xl border bg-white p-4 overflow-x-auto">
            <div className="grid grid-cols-[220px_repeat(7,minmax(160px,1fr))] gap-4 text-sm font-semibold text-gray-700 pb-3">
              <div>Team</div>
              {Array.from({ length: matchesToShow }, (_, i) => (
                <div key={i}>Match {i + 1}</div>
              ))}
            </div>

            {league.teams?.length ? (
              <div>
                {league.teams.map((team) => (
                  <TeamRowGrid key={team.teamId} team={team} matchesToShow={matchesToShow} />
                ))}
              </div>
            ) : (
              <div className="p-4 text-gray-600">No data returned for this league right now.</div>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
