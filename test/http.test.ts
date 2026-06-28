import { describe, it, expect, vi } from "vitest";
import { createFetch, rateLimitWaitMs } from "../src/http.js";
import { TokenManager } from "../src/token-manager.js";
import { json, makeFetch, noSleep } from "./helpers.js";

describe("rateLimitWaitMs", () => {
  it("reads X-RateLimit-Reset as an absolute epoch-seconds timestamp", () => {
    const nowMs = 1_700_000_000_000;
    const resetEpoch = 1_700_000_005; // 5s in the future
    const r = new Response(null, { status: 429, headers: { "x-ratelimit-reset": String(resetEpoch) } });
    expect(rateLimitWaitMs(r, nowMs, 60_000)).toBe(5000);
  });

  it("reads a small value as a delta in seconds", () => {
    const r = new Response(null, { status: 429, headers: { "x-ratelimit-reset": "3" } });
    expect(rateLimitWaitMs(r, 0, 60_000)).toBe(3000);
  });

  it("falls back to a short wait when the header is absent", () => {
    const r = new Response(null, { status: 429 });
    expect(rateLimitWaitMs(r, 0, 60_000)).toBe(1000);
  });
});

describe("createFetch retry behavior", () => {
  it("retries a 429 honoring X-RateLimit-Reset, then succeeds", async () => {
    let n = 0;
    const base = (async () => {
      n++;
      if (n === 1) return new Response("{}", { status: 429, headers: { "x-ratelimit-reset": "2" } });
      return json({ ok: true });
    }) as typeof fetch;
    const sleep = vi.fn(async () => {});
    const wrapped = createFetch({ fetch: base, sleep, now: () => 0 });
    const res = await wrapped("https://api.test/x");
    expect(res.status).toBe(200);
    expect(n).toBe(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("retries idempotent GET on 5xx with backoff", async () => {
    let n = 0;
    const base = (async () => {
      n++;
      return n < 2 ? new Response("", { status: 503 }) : json({ ok: true });
    }) as typeof fetch;
    const sleep = vi.fn(async () => {});
    const wrapped = createFetch({ fetch: base, sleep, random: () => 0, retry: { baseDelayMs: 100, maxRetries: 3, maxDelayMs: 9999 } });
    const res = await wrapped("https://api.test/x", { method: "GET" });
    expect(res.status).toBe(200);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a non-idempotent POST on 5xx", async () => {
    let n = 0;
    const base = (async () => {
      n++;
      return new Response("", { status: 503 });
    }) as typeof fetch;
    const wrapped = createFetch({ fetch: base, sleep: async () => {} });
    const res = await wrapped("https://api.test/x", { method: "POST" });
    expect(res.status).toBe(503);
    expect(n).toBe(1); // tried once, no retry
  });

  it("retries a GET on network error, then rethrows if it never recovers", async () => {
    const base = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const wrapped = createFetch({ fetch: base, sleep: async () => {}, random: () => 0, retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 } });
    await expect(wrapped("https://api.test/x", { method: "GET" })).rejects.toThrow(/ECONNRESET/);
  });
});

// Regression: the generated client hands the wrapper a `Request` (not url+init), whose
// body is a single-use stream. Retries must clone per attempt or the body is gone on
// the second send. (Found by adversarial review; broke 401-refresh + 429 for all writes.)
describe("retries preserve a body-bearing Request (clone per attempt)", () => {
  it("401 → refresh → retry keeps the body AND uses the new bearer", async () => {
    const oauth = makeFetch(() => json({ access_token: "at_live_NEW", refresh_token: "r2" }));
    const tm = new TokenManager({
      tokens: { accessToken: "at_live_OLD", refreshToken: "r1" },
      clientId: "c",
      fetch: oauth.fetch,
    });
    const seen: Array<{ auth: string | null; body: string }> = [];
    let n = 0;
    const base = (async (req: Request) => {
      n++;
      seen.push({ auth: req.headers.get("authorization"), body: await req.text() });
      return n === 1 ? new Response("{}", { status: 401 }) : json({ ok: true });
    }) as unknown as typeof fetch;
    const wrapped = createFetch({ fetch: base, tokenManager: tm, sleep: noSleep });

    const res = await wrapped(
      new Request("https://api.test/intents", {
        method: "POST",
        headers: { Authorization: "Bearer at_live_OLD", "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 100 }),
      }),
    );

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ auth: "Bearer at_live_OLD", body: '{"amount":100}' });
    expect(seen[1]!.auth).toBe("Bearer at_live_NEW"); // retried with the refreshed token
    expect(seen[1]!.body).toBe('{"amount":100}'); // and the body survived the first send
  });

  it("429 → retry keeps the body of a POST", async () => {
    const bodies: string[] = [];
    let n = 0;
    const base = (async (req: Request) => {
      n++;
      bodies.push(await req.text());
      return n === 1 ? new Response("", { status: 429, headers: { "x-ratelimit-reset": "1" } }) : json({ ok: true });
    }) as unknown as typeof fetch;
    const wrapped = createFetch({ fetch: base, sleep: noSleep });
    const res = await wrapped(new Request("https://api.test/x", { method: "POST", body: "hello" }));
    expect(res.status).toBe(200);
    expect(bodies).toEqual(["hello", "hello"]);
  });
});
