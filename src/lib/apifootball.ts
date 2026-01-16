// src/lib/apifootball.ts
export async function apiFootball<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const key = process.env.APISPORTS_KEY;

  if (!key) {
    throw new Error("Missing APISPORTS_KEY env var. Add it in Vercel Project → Settings → Environment Variables.");
  }

  const url = new URL(`https://v3.football.api-sports.io${path}`);

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-apisports-key": key,
    },
    // IMPORTANT: prevent Next caching
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API-Football error ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as T;
}
