import { NextResponse } from "next/server";
import { getLeagueBoards } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export async function GET() {
  const leagues = await getLeagueBoards();
  return NextResponse.json({ ok: true, leagues });
}
