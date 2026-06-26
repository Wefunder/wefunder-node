import { describe, it, expect, vi } from "vitest";
import { Wefunder, WefunderError } from "../src/index.js";
import { makeFetch, json, noSleep, type RecordedCall } from "./helpers.js";

const FAR_FUTURE = 10_000_000_000_000;
const bearer = (c: RecordedCall) => c.headers["authorization"];
const isOAuth = (c: RecordedCall) => c.url.includes("/oauth/token");

describe("mode detection (UX only — never used for host routing)", () => {
  it("maps token prefix to mode", () => {
    expect(new Wefunder({ accessToken: "at_live_x" }).mode).toBe("live");
    expect(new Wefunder({ accessToken: "at_test_x" }).mode).toBe("test");
    expect(new Wefunder({ accessToken: "opaque" }).mode).toBe("unknown");
  });

  it("uses the single API base regardless of prefix", async () => {
    const { fetch, calls } = makeFetch(() => json({ data: { id: 1 } }));
    const wf = new Wefunder({ accessToken: "at_test_x", fetch });
    await wf.users.me();
    // host is api.wefunder.com even for a test token — proxy routes by prefix
    expect(calls[0]!.url).toContain("https://api.wefunder.com/api/v2");
  });
});

describe("refresh rotation (CRITICAL — plan §9)", () => {
  it("on 401, refreshes, persists the ROTATED refresh token, retries with the new access token", async () => {
    const onTokenRefresh = vi.fn();
    const save = vi.fn();
    const { fetch, calls } = makeFetch(async (c) => {
      if (isOAuth(c)) return json({ access_token: "at_live_NEW", refresh_token: "r2" });
      // API: reject the old token, accept the new one
      return bearer(c) === "Bearer at_live_OLD" ? new Response("{}", { status: 401 }) : json({ data: { id: 99 } });
    });
    const wf = new Wefunder({
      tokens: { accessToken: "at_live_OLD", refreshToken: "r1", expiresAt: FAR_FUTURE },
      clientId: "cid",
      clientSecret: "sec",
      onTokenRefresh,
      store: { save },
      fetch,
      sleep: noSleep,
    });

    const me = (await wf.users.me()) as { id: number };
    expect(me.id).toBe(99);

    // exactly one refresh happened
    expect(calls.filter(isOAuth)).toHaveLength(1);
    // the rotated token was persisted via BOTH store and callback
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: "r2" }));
    expect(onTokenRefresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: "r2" }));
    // the retried API call used the NEW access token
    const apiCalls = calls.filter((c) => !isOAuth(c));
    expect(bearer(apiCalls[apiCalls.length - 1]!)).toBe("Bearer at_live_NEW");
    // client now reports the rotated token set
    expect(wf.tokens.refreshToken).toBe("r2");
  });

  it("coalesces concurrent 401s into a single refresh (no rotation race)", async () => {
    const { fetch, calls } = makeFetch(async (c) => {
      if (isOAuth(c)) return json({ access_token: "at_live_NEW", refresh_token: "r2" });
      return bearer(c) === "Bearer at_live_OLD" ? new Response("{}", { status: 401 }) : json({ data: { ok: true } });
    });
    const wf = new Wefunder({
      tokens: { accessToken: "at_live_OLD", refreshToken: "r1", expiresAt: FAR_FUTURE },
      clientId: "cid",
      fetch,
      sleep: noSleep,
    });
    await Promise.all([wf.users.me(), wf.users.me(), wf.users.me()]);
    expect(calls.filter(isOAuth)).toHaveLength(1); // one refresh for three concurrent 401s
  });

  it("throws WefunderAuthError when a 401 occurs and no refresh token is configured", async () => {
    const { fetch } = makeFetch(async () => new Response("{}", { status: 401 }));
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    await expect(wf.users.me()).rejects.toBeInstanceOf(WefunderError);
  });
});

describe("typed errors from the body (plan §4.1 #7)", () => {
  it("reads type/message/details/request_id/remediation from error (nested, real shape)", async () => {
    // Matches api/v2/base_controller.rb#render_error: everything nests under `error`.
    const { fetch } = makeFetch(() =>
      json(
        {
          error: {
            type: "validation_error",
            message: "amount too low",
            details: { field: "amount" },
            request_id: "req_xyz",
            remediation: "Raise the amount to at least $100.",
          },
        },
        { status: 422 },
      ),
    );
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    await wf.users.me().then(
      () => expect.fail("should have thrown"),
      (err: WefunderError) => {
        expect(err).toBeInstanceOf(WefunderError);
        expect(err.status).toBe(422);
        expect(err.type).toBe("validation_error");
        expect(err.message).toBe("amount too low");
        expect(err.requestId).toBe("req_xyz");
        expect(err.details).toEqual({ field: "amount" });
        expect(err.remediation).toBe("Raise the amount to at least $100.");
      },
    );
  });

  it("falls back to a top-level request_id if an envelope ever puts it there", async () => {
    const { fetch } = makeFetch(() => json({ error: { type: "x", message: "y" }, request_id: "req_top" }, { status: 400 }));
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    await wf.users.me().catch((err: WefunderError) => expect(err.requestId).toBe("req_top"));
  });

  it("prefers the X-Wf-Request-Id response header over the body's request_id", async () => {
    const { fetch } = makeFetch(() =>
      json(
        { error: { type: "forbidden", message: "no", request_id: "req_body" } },
        { status: 403, headers: { "content-type": "application/json", "x-wf-request-id": "req_header" } },
      ),
    );
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    await wf.users.me().catch((err: WefunderError) => expect(err.requestId).toBe("req_header"));
  });

  it("still captures request_id from the header when the body is non-JSON (edge HTML 502)", async () => {
    // The edge can return an HTML 502 with no JSON error body; the header is still set.
    const { fetch } = makeFetch(
      () => new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "x-wf-request-id": "req_edge" } }),
    );
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    await wf.users.me().then(
      () => expect.fail("should have thrown"),
      (err: WefunderError) => {
        expect(err.status).toBe(502);
        expect(err.requestId).toBe("req_edge");
      },
    );
  });
});

describe("auto-pagination through the client", () => {
  it("streams all investments across pages, treating the cursor opaquely", async () => {
    const { fetch } = makeFetch((c) => {
      const cursor = new URL(c.url).searchParams.get("cursor");
      if (!cursor) return json({ data: [{ id: 1 }, { id: 2 }], meta: { has_more: true, next_cursor: 100 } });
      return json({ data: [{ id: 3 }], meta: { has_more: false, next_cursor: null } });
    });
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    const ids: unknown[] = [];
    for await (const inv of wf.investments.all()) ids.push((inv as { id: number }).id);
    expect(ids).toEqual([1, 2, 3]);
  });
});
