import type { Api, ApiResponse } from "./api.ts";

/**
 * Spec 16 final review — the CLI's own requests (seed and cleanup, for up to 150 accounts) must stay under the API's
 * per-IP limit (600 a minute), or a 429 mid-cleanup leaves accounts dirty. One shared spacing for every wrapped
 * account, and a 429 waits for `Retry-After` (else 1 s) and retries. These requests are bookkeeping, never measured,
 * so retrying hides nothing.
 */
export interface PoliteOptions {
  minIntervalMs: number;
  maxRetries: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export function politeApis(apis: Api[], opts: PoliteOptions): Api[] {
  let nextAt = -Infinity;

  const turn = async () => {
    const wait = nextAt - opts.now();
    if (wait > 0) await opts.sleep(wait);
    nextAt = opts.now() + opts.minIntervalMs;
  };

  const polite = async <R extends { status: number; retryAfterS?: number }>(call: () => Promise<R>): Promise<R> => {
    for (let attempt = 0; ; attempt += 1) {
      await turn();
      const res = await call();
      if (res.status !== 429 || attempt >= opts.maxRetries) return res;
      const backoffMs = (res.retryAfterS ?? 1) * 1000;
      nextAt = Math.max(nextAt, opts.now() + backoffMs);
    }
  };

  return apis.map(
    (api): Api => ({
      get: (path) => polite<ApiResponse>(() => api.get(path)),
      post: (path, body) => polite<ApiResponse>(() => api.post(path, body)),
      patch: (path, body) => polite<ApiResponse>(() => api.patch(path, body)),
      del: (path) => polite(() => api.del(path)),
    }),
  );
}
