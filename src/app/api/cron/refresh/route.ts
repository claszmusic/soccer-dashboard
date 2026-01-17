// src/app/api/cron/refresh/route.ts
import { put } from "@vercel/blob";
import { buildAllBoards } from "@/lib/buildBoards";

export const runtime = "nodejs";

function isAuthorized(req: Request) {
  const expected = process.env.CRON_SECRET || "";
  if (!expected) return false;

  // Allow either Authorization header OR ?token=...
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${expected}`) return true;

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token === expected) return true;

  return false;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!process.env.APISPORTS_KEY) {
    return new Response("Missing APISPORTS_KEY", { status: 500 });
  }

  // NOTE: depending on Vercel UI, this may be auto-injected as BLOB_READ_WRITE_TOKEN.
  // If your project uses the prefix version (BLOB_READ_WRITE_TOKEN), Vercel handles it.
  // The SDK reads from env automatically.
  const payload = await buildAllBoards();

  const blob = await put("data/boards.json", JSON.stringify(payload), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false
  });

  return Response.json({
    ok: true,
    updatedAt: payload.updatedAt,
    blobUrl: blob.url
  });
}
