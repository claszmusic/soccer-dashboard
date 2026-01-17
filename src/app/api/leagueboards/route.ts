// src/app/api/leagueboards/route.ts

export const runtime = "nodejs";

type BlobPayload = {
  updatedAt?: string;
  boards?: any[];
};

export async function GET() {
  const url = process.env.BOARDS_JSON_URL;

  if (!url) {
    return Response.json(
      {
        ok: false,
        error:
          "Missing BOARDS_JSON_URL env var. Set it to your Blob boards.json URL (the blobUrl returned by /api/cron/refresh).",
      },
      { status: 500 }
    );
  }

  const res = await fetch(url, {
    // Always pull the latest snapshot from Blob
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return Response.json(
      {
        ok: false,
        error: `Failed to fetch boards.json (${res.status}). ${txt.slice(0, 200)}`,
      },
      { status: 502 }
    );
  }

  const payload = (await res.json()) as BlobPayload;

  return Response.json({
    ok: true,
    updatedAt: payload.updatedAt ?? null,
    leagues: payload.boards ?? [],
  });
}
