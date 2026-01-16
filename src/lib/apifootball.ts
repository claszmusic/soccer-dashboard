// src/lib/apiFootball.ts
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; status?: number; details?: unknown };
export type ApiResult<T> = ApiOk<T> | ApiErr;

const BASE_URL = "https://v3.football.api-sports.io";

function getKey(): string {
  const key = process.env.APISPORTS_KEY || process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("Missing env var: APISPORTS_KEY (or API_FOOTBALL_KEY)");
  return key;
}

export async function apiGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  opts: { noStore?: boolean } = {}
): Promise<ApiResult<T>> {
  let url = `${BASE_URL}${path}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    qs.set(k, String(v));
  }
  if ([...qs.keys()].length) url += `?${qs.toString()}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-apisports-key": getKey(),
      },
      // Avoid “sometimes empty” caching on Vercel
      cache: opts.noStore ? "no-store" : "force-cache",
      // If you want auto refresh, you can also use:
      // next: { revalidate: 60 },
    });

    const status = res.status;
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // ignore
    }

    if (!res.ok) {
      const msg =
        json?.errors
          ? `API error: ${JSON.stringify(json.errors)}`
          : json?.message
            ? `API message: ${json.message}`
            : `HTTP ${status}`;
      return { ok: false, error: msg, status, details: json };
    }

    // API-Football typically uses: { response: ... , errors: ... }
    if (json?.errors && Object.keys(json.errors).length > 0) {
      return { ok: false, error: `API errors: ${JSON.stringify(json.errors)}`, status, details: json };
    }

    return { ok: true, data: json as T };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Network error", details: e };
  }
}
