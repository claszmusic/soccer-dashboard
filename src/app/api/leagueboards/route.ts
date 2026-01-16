// src/app/api/leagueboards/route.ts
import { NextResponse } from "next/server";
import { getLeagueBoards } from "@/lib/leagueData";

export const dynamic = "force-dynamic"; // don’t cache

export async function GET() {
  try {
    const data = await getLeagueBoards();
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
