export async function apiFootball<T>(
  path: string,
  params: Record<string, any>,
  cacheSeconds = 60
): Promise<T> {
  const key = process.env.APISPORTS_KEY;

  if (!key) {
    // Don't crash the whole app — return an empty-like object by throwing a friendly error
    throw new Error("Missing APISPORTS_KEY env var in this environment (Vercel Production?)");
  }

  const url = new URL(`https://v3.football.api-sports.io${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": key },
    // keep it simple/stable on Vercel:
    cache: "no-store",
  });

  // If API returns an error, we throw (and we will catch it in page.tsx)
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API-Football error ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as T;
}
