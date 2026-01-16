"use client";

import { useEffect, useState } from "react";

type LeagueBoard = {
  leagueId: number;
  leagueName: string;
  seasonUsed?: number;
  teams: any[];
  error?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ok"; data: LeagueBoard[] };

export default function HomePage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/leagueboards", { cache: "no-store" });
        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok) {
          const msg = json?.error ?? `HTTP ${res.status} from /api/leagueboards`;
          if (!cancelled) setState({ status: "error", error: msg });
          return;
        }

        if (!cancelled) setState({ status: "ok", data: json.data });
      } catch (e: any) {
        if (!cancelled) setState({ status: "error", error: e?.message ?? "Fetch failed" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="p-6">
      <h1 className="text-3xl font-bold">Soccer Dashboard</h1>

      {/* BIG marker so we KNOW this new file is deployed */}
      <div className="mt-2 text-sm text-gray-500">
        DEBUG BUILD MARKER: page.tsx updated ✅
      </div>

      {state.status === "loading" && (
        <div className="mt-6 rounded-lg border p-4 text-gray-600">Loading league boards…</div>
      )}

      {state.status === "error" && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{state.error}</div>
          <div className="mt-2 text-sm">
            Open <span className="font-mono">/api/leagueboards</span> in your browser to see the raw JSON error.
          </div>
        </div>
      )}

      {state.status === "ok" &&
        state.data.map((board) => (
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
              <div className="mt-4 rounded-lg border p-4 text-green-700">
                Data received for <b>{board.teams.length}</b> teams.
              </div>
            )}
          </section>
        ))}
    </main>
  );
}
