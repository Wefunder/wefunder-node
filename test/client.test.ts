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
    // host is api.wefunder.com even for a test token — the gateway routes by prefix.
    // Version-free base: /users/me, not /api/v2/users/me.
    expect(calls[0]!.url).toBe("https://api.wefunder.com/users/me");
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

describe("portfolio namespace", () => {
  it("unwraps the portfolio summary and forwards filters", async () => {
    const { fetch, calls } = makeFetch(() =>
      json({
        data: {
          type: "portfolio_summary",
          attributes: { total_current_value_cents: 123_45 },
        },
      }),
    );
    const wf = new Wefunder({ accessToken: "at_live_x", fetch });

    const summary = await wf.portfolio.get({ status: "active", company: "co_123" });

    expect(summary.attributes?.total_current_value_cents).toBe(123_45);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/portfolio");
    expect(url.searchParams.get("status")).toBe("active");
    expect(url.searchParams.get("company")).toBe("co_123");
  });

  it("streams positions and preserves filters across pages", async () => {
    const calls: URL[] = [];
    const { fetch } = makeFetch((call) => {
      const url = new URL(call.url);
      calls.push(url);
      return url.searchParams.has("cursor")
        ? json({ data: [{ id: "ofr_2" }], meta: { has_more: false, next_cursor: null } })
        : json({ data: [{ id: "ofr_1" }], meta: { has_more: true, next_cursor: 42 } });
    });
    const wf = new Wefunder({ accessToken: "at_live_x", fetch });
    const ids: unknown[] = [];

    for await (const position of wf.portfolio.positions.all({
      status: "exited",
      company: "co_123",
      per_page: 10,
    })) {
      ids.push(position.id);
    }

    expect(ids).toEqual(["ofr_1", "ofr_2"]);
    expect(calls.map((url) => url.pathname)).toEqual([
      "/portfolio/positions",
      "/portfolio/positions",
    ]);
    expect(calls.map((url) => url.searchParams.get("status"))).toEqual([
      "exited",
      "exited",
    ]);
    expect(calls.map((url) => url.searchParams.get("company"))).toEqual([
      "co_123",
      "co_123",
    ]);
    expect(calls.map((url) => url.searchParams.get("per_page"))).toEqual(["10", "10"]);
    expect(calls[1]!.searchParams.get("cursor")).toBe("42");
  });
});

describe("client_credentials auto-re-mint (stress-test A)", () => {
  it("re-mints on 401 using the stored grant inputs, then retries", async () => {
    let mints = 0;
    const { fetch, calls } = makeFetch(async (c) => {
      if (isOAuth(c)) {
        mints++;
        return json({ access_token: mints === 1 ? "at_test_OLD" : "at_test_NEW", expires_in: 7200 });
      }
      return bearer(c) === "Bearer at_test_OLD" ? new Response("{}", { status: 401 }) : json({ data: [{ id: 1 }], meta: {} });
    });
    const wf = await Wefunder.fromClientCredentials({ clientId: "c", clientSecret: "s", scopes: ["read:public"], fetch });
    const page = await wf.offerings.list();
    expect(page.data).toEqual([{ id: 1 }]);
    // one initial mint + one re-mint (NOT a refresh_token grant — cc has none)
    expect(calls.filter(isOAuth)).toHaveLength(2);
    const grant = new URLSearchParams(calls.filter(isOAuth)[1]!.body).get("grant_type");
    expect(grant).toBe("client_credentials");
    expect(wf.tokens.accessToken).toBe("at_test_NEW");
  });

  it("coalesces concurrent re-mints into one", async () => {
    let mints = 0;
    const { fetch, calls } = makeFetch(async (c) => {
      if (isOAuth(c)) {
        mints++;
        return json({ access_token: mints === 1 ? "at_test_OLD" : "at_test_NEW" });
      }
      return bearer(c) === "Bearer at_test_OLD" ? new Response("{}", { status: 401 }) : json({ data: [], meta: {} });
    });
    const wf = await Wefunder.fromClientCredentials({ clientId: "c", clientSecret: "s", fetch });
    await Promise.all([wf.offerings.list(), wf.offerings.list(), wf.offerings.list()]);
    expect(calls.filter(isOAuth)).toHaveLength(2); // 1 initial + 1 coalesced re-mint
  });
});

describe("ergonomic list forwards query params (stress-test B)", () => {
  it("offerings.list({ sort }) forwards sort to the request", async () => {
    const { fetch, calls } = makeFetch(() => json({ data: [], meta: {} }));
    const wf = new Wefunder({ accessToken: "at_test_x", fetch });
    await wf.offerings.list({ sort: "most_raised" });
    const u = new URL(calls.find((c) => c.url.includes("/explore"))!.url);
    expect(u.searchParams.get("sort")).toBe("most_raised");
  });

  it("offerings.all({ sort }) preserves sort across every page", async () => {
    const sortsSeen: (string | null)[] = [];
    const { fetch } = makeFetch((c) => {
      const u = new URL(c.url);
      sortsSeen.push(u.searchParams.get("sort"));
      return u.searchParams.get("cursor")
        ? json({ data: [{ id: 2 }], meta: { has_more: false, next_cursor: null } })
        : json({ data: [{ id: 1 }], meta: { has_more: true, next_cursor: 2 } });
    });
    const wf = new Wefunder({ accessToken: "at_test_x", fetch });
    const ids: unknown[] = [];
    for await (const o of wf.offerings.all({ sort: "newest" })) ids.push((o as { id: number }).id);
    expect(ids).toEqual([1, 2]);
    expect(sortsSeen).toEqual(["newest", "newest"]);
  });
});

describe("public unwrap for raw ops (stress-test C)", () => {
  it("returns the body on success and throws a typed error (with request_id) on failure", async () => {
    const ok = makeFetch(() => json({ data: [{ id: 7 }], meta: {} }));
    const wf1 = new Wefunder({ accessToken: "at_test_x", fetch: ok.fetch });
    const page = (await wf1.unwrap(wf1.raw.listOfferings({ query: { sort: "newest" } }))) as { data?: { id: number }[] };
    expect(page.data).toEqual([{ id: 7 }]);

    const bad = makeFetch(() => json({ error: { type: "forbidden", message: "no", request_id: "req_z" } }, { status: 403 }));
    const wf2 = new Wefunder({ accessToken: "at_test_x", fetch: bad.fetch, sleep: noSleep });
    await wf2.unwrap(wf2.raw.listOfferings({})).then(
      () => expect.fail("should throw"),
      (e: WefunderError) => {
        expect(e).toBeInstanceOf(WefunderError);
        expect(e.status).toBe(403);
        expect(e.requestId).toBe("req_z");
      },
    );
  });
});

describe("webhookEndpoints namespace", () => {
  const endpoint = {
    id: "whe_1",
    type: "webhook_endpoint",
    attributes: { url: "https://example.com/hooks", mode: "live", events: ["offering.opened"], enabled: true },
  };

  it("create POSTs the body, unwraps data, and surfaces the one-time secret", async () => {
    const { fetch, calls } = makeFetch(() =>
      json({ data: { ...endpoint, attributes: { ...endpoint.attributes, secret: "whsec_once" } } }, { status: 201 }),
    );
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    const created = await wf.webhookEndpoints.create({
      url: "https://example.com/hooks",
      events: ["offering.opened", "investment.executed"],
      mode: "live",
    });
    expect(calls[0]!.method).toBe("POST");
    expect(new URL(calls[0]!.url).pathname).toBe("/webhook_endpoints");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      url: "https://example.com/hooks",
      events: ["offering.opened", "investment.executed"],
      mode: "live",
    });
    expect(created.attributes?.secret).toBe("whsec_once");
  });

  it("list returns the envelope (meta.quota), get/update/remove/rotateSecret/reenable hit the right paths", async () => {
    const { fetch, calls } = makeFetch((c) => {
      if (c.method === "DELETE") return json({ data: { id: "whe_1", type: "webhook_endpoint", removed: true } });
      if (c.url.endsWith("/webhook_endpoints")) return json({ data: [endpoint], meta: { count: 1, quota: 10 } });
      return json({ data: endpoint });
    });
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });

    const list = await wf.webhookEndpoints.list();
    expect(list.data).toHaveLength(1);
    expect(list.meta?.quota).toBe(10);

    expect((await wf.webhookEndpoints.get("whe_1")).id).toBe("whe_1");
    await wf.webhookEndpoints.update("whe_1", { events: ["investment.executed"] });
    await wf.webhookEndpoints.rotateSecret("whe_1");
    await wf.webhookEndpoints.reenable("whe_1");
    expect((await wf.webhookEndpoints.remove("whe_1")).removed).toBe(true);

    const seen = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
    expect(seen).toEqual([
      "GET /webhook_endpoints",
      "GET /webhook_endpoints/whe_1",
      "PATCH /webhook_endpoints/whe_1",
      "POST /webhook_endpoints/whe_1/rotate_secret",
      "POST /webhook_endpoints/whe_1/reenable",
      "DELETE /webhook_endpoints/whe_1",
    ]);
    expect(JSON.parse(calls[2]!.body!)).toEqual({ events: ["investment.executed"] });
  });

  it("test sends the optional event and unwraps the outcome", async () => {
    const { fetch, calls } = makeFetch(() =>
      json({ data: { type: "webhook_test", delivered: true, response_code: 200, error: null, event: "offering.opened" } }),
    );
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    const outcome = await wf.webhookEndpoints.test("whe_1", "offering.opened");
    expect(outcome.delivered).toBe(true);
    expect(new URL(calls[0]!.url).pathname).toBe("/webhook_endpoints/whe_1/test");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ event: "offering.opened" });

    await wf.webhookEndpoints.test("whe_1");
    expect(calls[1]!.body ?? "").toBe("");
  });

  it("surfaces the sandbox write refusal as a typed WefunderError", async () => {
    const { fetch } = makeFetch(() =>
      json(
        { error: { type: "manage_endpoints_on_live_api", message: "Manage them through the live API", request_id: "req_1" } },
        { status: 403 },
      ),
    );
    const wf = new Wefunder({ accessToken: "at_test_x", fetch, sleep: noSleep });
    await expect(
      wf.webhookEndpoints.create({ url: "https://example.com/h", events: ["offering.opened"], mode: "test" }),
    ).rejects.toMatchObject({ status: 403, type: "manage_endpoints_on_live_api", requestId: "req_1" });
  });
});

describe("investments namespace (delta API)", () => {
  it("forwards filters, stops on has_more=false even though next_cursor is always present", async () => {
    const { fetch, calls } = makeFetch((c) => {
      const cursor = new URL(c.url).searchParams.get("cursor");
      if (!cursor) return json({ data: [{ id: "inv_1", visible: true }], meta: { mode: "delta", has_more: true, next_cursor: "c1" } });
      return json({ data: [{ id: "inv_2", visible: false }], meta: { mode: "delta", has_more: false, next_cursor: "c2" } });
    });
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    const ids = (await wf.investments.collect({ company_id: "co_1", updated_since: "2026-09-01T00:00:00Z" })).map((i) => i.id);
    expect(ids).toEqual(["inv_1", "inv_2"]);
    expect(calls).toHaveLength(2);
    const q = new URL(calls[1]!.url).searchParams;
    expect(q.get("company_id")).toBe("co_1");
    expect(q.get("updated_since")).toBe("2026-09-01T00:00:00Z");
    expect(q.get("cursor")).toBe("c1");
  });

  it("get fetches one record by inv_ id", async () => {
    const { fetch, calls } = makeFetch(() => json({ data: { id: "inv_9", visible: true }, meta: { source: "current" } }));
    const wf = new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
    expect((await wf.investments.get("inv_9")).id).toBe("inv_9");
    expect(new URL(calls[0]!.url).pathname).toBe("/investments/inv_9");
  });
});
