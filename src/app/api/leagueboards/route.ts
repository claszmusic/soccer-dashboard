import { NextResponse } from "next/server";
import { getLeagueBoards } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getLeagueBoards();
    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
