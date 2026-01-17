// src/app/api/leagueboards/route.ts
import { head, get } from "@vercel/blob";

export const runtime = "nodejs";

export async function GET() {
  try {
    // This is the key your cron route is writing:
    // put("data/boards.json", ...)
    const pathname = "data/boards.json";

    // Ensure it exists in THIS project's Blob store
    const meta = await head(pathname);

    // Fetch JSON content from the Blob URL we just confirmed exists
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return Response.json(
        { ok: false, error: `Failed to read boards.json (${res.status}). ${txt.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const payload = await res.json();

    // Expected payload shape from your cron refresh:
    // { ok:true, updatedAt: "...", blobUrl: "...", boards: [...] }
    // or { updatedAt, boards }
    const leagues = (payload?.boards ?? payload?.leagues ?? []) as any[];

    return Response.json({
      ok: true,
      updatedAt: payload?.updatedAt ?? null,
      leagues,
      blobUrl: meta.url,
    });
  } catch (e: any) {
    return Response.json(
      {
        ok: false,
        error: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}
