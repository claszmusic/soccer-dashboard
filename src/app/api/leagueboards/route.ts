import { NextResponse } from "next/server";
import { getLeagueBoard } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const leagues = [
      { leagueId: 262, leagueName: "Liga MX" },
      { leagueId: 39, leagueName: "Premier League" },
      { leagueId: 140, leagueName: "La Liga" },
      { leagueId: 78, leagueName: "Bundesliga" },
      { leagueId: 135, leagueName: "Serie A" },
    ];

    const board = await getLeagueBoard({ leagues });

    if (!board.ok) {
      return NextResponse.json(
        { ok: false, error: board.error ?? "Unknown error" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      leagues: board.data,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
