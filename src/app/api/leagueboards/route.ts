// src/app/api/leagueboards/route.ts
import { NextResponse } from "next/server";
import { getLeagueBoards } from "@/lib/leagueData";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const leagues = await getLeagueBoards();
    return NextResponse.json({ ok: true, leagues }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
