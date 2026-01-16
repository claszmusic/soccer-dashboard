type AnyObj = Record<string, any>;

const BASE = "https://v3.football.api-sports.io";

export async function apiFootball<T>(
  path: string,
  params: AnyObj = {},
  cacheSeconds: number = 0
): Promise<T> {
  const key = process.env.APISPORTS_KEY;

  if (!key) {
    throw new Error(
      "Missing APISPORTS_KEY env var. Add it in Vercel Project → Settings → Environment Variables."
    );
  }

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-apisports-key": key,
    },
    // IMPORTANT: prevents build-time/static caching surprises
    cache: "no-store",
    next: cacheSeconds ? { revalidate: cacheSeconds } : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`API-Football error ${res.status}: ${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`API-Football returned non-JSON: ${text.slice(0, 200)}`);
  }
}
