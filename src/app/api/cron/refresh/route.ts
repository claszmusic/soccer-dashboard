// src/app/api/cron/refresh/route.ts
import { put } from "@vercel/blob";
import { buildAllBoards } from "../../../../lib/buildBoards";

export const runtime = "nodejs";

function isAuthorized(req: Request) {
  const expected = process.env.CRON_SECRET || "";
  if (!expected) return false;

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  // Allow: /api/cron/refresh?token=YOUR_SECRET
  return token === expected;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!process.env.APISPORTS_KEY) {
    return new Response("Missing APISPORTS_KEY", { status: 500 });
  }

  const payload = await buildAllBoards();

  const blob = await put("data/boards.json", JSON.stringify(payload), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });

  return Response.json({
    ok: true,
    updatedAt: payload.updatedAt,
    blobUrl: blob.url,
  });
}
