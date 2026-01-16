import { NextResponse } from "next/server";
import { getLeagueBoard } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const leagues = [
      { leagueId: 352, leagueName: "Liga MX" },        // sofascore.com/.../liga-mx/352 :contentReference[oaicite:8]{index=8}
      { leagueId: 17, leagueName: "Premier League" },  // .../premier-league/17 :contentReference[oaicite:9]{index=9}
      { leagueId: 8, leagueName: "La Liga" },          // .../laliga/8 :contentReference[oaicite:10]{index=10}
      { leagueId: 35, leagueName: "Bundesliga" },      // .../bundesliga/35 :contentReference[oaicite:11]{index=11}
      { leagueId: 23, leagueName: "Serie A" },         // .../serie-a/23 :contentReference[oaicite:12]{index=12}
    ];

    const board = await getLeagueBoard({ leagues });

    if (!board.ok) {
      return NextResponse.json({ ok: false, error: board.error ?? "Unknown error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, leagues: board.data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
