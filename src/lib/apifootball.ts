type CacheEntry<T> = { t: number; v: T };
const mem = new Map<string, CacheEntry<any>>();

export async function apiFootball<T>(
  path: string,
  params: Record<string, any>,
  ttlSeconds = 0
): Promise<T> {
  const key = `${path}?${new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
      if (v === undefined || v === null) return acc;
      acc[k] = String(v);
      return acc;
    }, {})
  ).toString()}`;

  const useCache = ttlSeconds > 0;
  if (useCache) {
    const hit = mem.get(key);
    if (hit && Date.now() - hit.t < ttlSeconds * 1000) return hit.v;
  }

  const apiKey = process.env.APISPORTS_KEY;
  if (!apiKey) {
    throw new Error("Missing APISPORTS_KEY in environment variables (Vercel Settings → Env Vars).");
  }

  const url = `https://v3.football.api-sports.io${key}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-apisports-key": apiKey,
    },
    // IMPORTANT: avoid Next.js caching a failed response
    cache: "no-store",
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`API-Football non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json?.errors ? JSON.stringify(json.errors) : json?.message || text;
    throw new Error(`API-Football error ${res.status}: ${msg}`);
  }

  if (useCache) mem.set(key, { t: Date.now(), v: json });
  return json as T;
}
