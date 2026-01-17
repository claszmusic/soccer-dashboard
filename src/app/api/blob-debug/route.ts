// src/app/api/blob-debug/route.ts
import { list } from "@vercel/blob";

export const runtime = "nodejs";

export async function GET() {
  try {
    const out = await list({ prefix: "data/" });

    return Response.json({
      ok: true,
      count: out.blobs.length,
      blobs: out.blobs.map((b) => ({
        pathname: b.pathname,
        url: b.url,
        size: b.size,
        uploadedAt: b.uploadedAt,
      })),
    });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
