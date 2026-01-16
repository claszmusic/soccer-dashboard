import { NextResponse } from "next/server";
import { getLeagueBoards } from "@/lib/leagueData";

export const dynamic = "force-dynamic"; // always run fresh on request

export async function GET() {
  try {
    const leagues = await getLeagueBoards();
    return NextResponse.json({ ok: true, leagues });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
