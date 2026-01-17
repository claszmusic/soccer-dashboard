// src/lib/apifootball.ts
type ApiFootballEnvelope<T> = {
  get?: string;
  parameters?: any;
  errors?: any;
  results?: number;
  paging?: any;
  response: T;
};

const API_BASE = "https://v3.football.api-sports.io";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function apiFootball<TResponse>(
  path: string,
  params: Record<string, string | number | boolean | undefined>
): Promise<TResponse> {
  const key = process.env.APISPORTS_KEY;
  if (!key) throw new Error("Missing APISPORTS_KEY");

  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }

  // Basic retry for 429 / transient errors
  let lastErr: any = null;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: {
          "x-apisports-key": key,
        },
        cache: "no-store",
      });

      if (res.status === 429) {
        // Backoff
        await sleep(800 * attempt);
        continue;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`API-Football ${res.status}: ${txt.slice(0, 200)}`);
      }

      const json = (await res.json()) as ApiFootballEnvelope<TResponse>;

      // API-Football always returns { response: [...] }
      return json.response;
    } catch (e: any) {
      lastErr = e;
      await sleep(300 * attempt);
    }
  }

  throw lastErr ?? new Error("API-Football request failed");
}
