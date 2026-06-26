import { describe, it, expect, vi } from "vitest";
import { createFetch, rateLimitWaitMs } from "../src/http.js";
import { json } from "./helpers.js";

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
