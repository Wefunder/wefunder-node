// The retry/refresh fetch wrapper passed to the generated client. Centralizes the
// three contract-driven behaviors (plan §4.1 #6, §9):
//   - 401 -> refresh the token (rotation, via TokenManager) and retry ONCE
//   - 429 -> honor X-RateLimit-Reset (NOT Retry-After) and retry (safe: request was
//            rejected, not processed)
//   - 5xx / network error -> retry IDEMPOTENT requests only (GET/HEAD) with
//            exponential backoff + jitter. Writes are never auto-retried (no
//            universal idempotency key).

import type { TokenManager } from "./token-manager.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface HttpDeps {
  tokenManager?: TokenManager;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Deterministic jitter source for tests; defaults to Math.random. */
  random?: () => number;
  retry?: RetryOptions;
}

type FetchInput = Parameters<typeof fetch>[0];

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS"]);

function methodOf(input: FetchInput, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

/**
 * Compute how long to wait for a 429, reading X-RateLimit-Reset. The header may be
 * either an absolute epoch-seconds timestamp or a delta in seconds — handle both.
 * Bounded so a misbehaving header can't hang the caller.
 */
export function rateLimitWaitMs(response: Response, now: number, maxDelayMs: number): number {
  const raw = response.headers.get("x-ratelimit-reset");
  if (!raw) return Math.min(1000, maxDelayMs);
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.min(1000, maxDelayMs);
  // Heuristic: values larger than ~now-in-seconds are absolute epoch timestamps.
  const wait = n > 1_000_000_000 ? n * 1000 - now : n * 1000;
  return Math.max(0, Math.min(wait, maxDelayMs));
}

function backoffMs(attempt: number, opts: Required<RetryOptions>, random: () => number): number {
  const exp = opts.baseDelayMs * 2 ** attempt;
  const jitter = exp * 0.5 * random();
  return Math.min(exp + jitter, opts.maxDelayMs);
}

export function createFetch(deps: HttpDeps): typeof fetch {
  const baseFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const retry: Required<RetryOptions> = {
    maxRetries: deps.retry?.maxRetries ?? 2,
    baseDelayMs: deps.retry?.baseDelayMs ?? 250,
    maxDelayMs: deps.retry?.maxDelayMs ?? 60_000,
  };

  return async function wrappedFetch(input: FetchInput, init?: RequestInit): Promise<Response> {
    const method = methodOf(input, init);
    const idempotent = IDEMPOTENT.has(method);
    const isRequest = input instanceof Request;
    let refreshed = false;
    let attempt = 0;
    let retryToken: string | undefined; // set after a refresh, applied to the next attempt

    // Issue the request for one attempt. CRITICAL: a `Request` body is a single-use
    // stream — the hey-api client hands us a `Request`, and the first fetch consumes
    // it, so we must NOT re-dispatch the same object on a retry. Clone per attempt
    // (leaving `input` pristine), overriding the bearer after a refresh. For the
    // (url, init) form, a string body is freely re-sendable.
    const dispatch = (authToken?: string): Promise<Response> => {
      if (isRequest) {
        const fresh = (input as Request).clone();
        if (authToken === undefined) return baseFetch(fresh);
        const headers = new Headers(fresh.headers);
        headers.set("Authorization", `Bearer ${authToken}`);
        return baseFetch(new Request(fresh, { headers }));
      }
      const nextInit =
        authToken === undefined
          ? init
          : (() => {
              const headers = new Headers(init?.headers);
              headers.set("Authorization", `Bearer ${authToken}`);
              return { ...init, headers };
            })();
      return baseFetch(input, nextInit);
    };

    for (;;) {
      let response: Response | undefined;
      let networkError: unknown;
      try {
        response = await dispatch(retryToken);
      } catch (err) {
        networkError = err;
      }

      // --- 401: refresh once, then retry (any method — a 401 means the request was
      // rejected before processing, so re-sending is safe; the per-attempt clone makes
      // body-bearing writes replayable). ---
      if (response?.status === 401 && !refreshed && deps.tokenManager?.canRefresh) {
        refreshed = true;
        const next = await deps.tokenManager.refresh();
        retryToken = next.accessToken;
        continue;
      }

      // --- 429: honor X-RateLimit-Reset, retry (bounded) ---
      if (response?.status === 429 && attempt < retry.maxRetries) {
        attempt++;
        await sleep(rateLimitWaitMs(response, now(), retry.maxDelayMs));
        continue;
      }

      // --- 5xx / network: retry idempotent only ---
      const transient = networkError !== undefined || (response !== undefined && response.status >= 500);
      if (transient && idempotent && attempt < retry.maxRetries) {
        attempt++;
        await sleep(backoffMs(attempt, retry, random));
        continue;
      }

      if (response) return response;
      throw networkError;
    }
  };
}
