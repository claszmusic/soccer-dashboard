type FetchOptions = Record<string, string | number | boolean | undefined>;

const BASE = "https://v3.football.api-sports.io";

function qs(params: FetchOptions) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export async function apiFootball<T>(
  path: string,
  params: FetchOptions,
  revalidateSeconds = 60 * 60 * 6 // refresh a few times/day
) {
  const key = process.env.APISPORTS_KEY;
  if (!key) throw new Error("Missing APISPORTS_KEY. Add it in Vercel Env Vars (recommended) or .env.local for local dev.");

  const url = `${BASE}${path}?${qs(params)}`;

  const res = await fetch(url, {
    headers: { "x-apisports-key": key },
    next: { revalidate: revalidateSeconds },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API-Football error ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}
