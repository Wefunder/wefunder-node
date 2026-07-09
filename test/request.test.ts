// The `wf.request()` escape hatch: arbitrary paths through the SDK's full
// envelope — auth attach + 401 re-mint, Wefunder-Version pinning, query/body
// serialization, custom headers (Idempotency-Key), typed WefunderError.
import { describe, it, expect } from "vitest";
import { Wefunder, WefunderError } from "../src/index.js";
import { makeFetch, json, noSleep, type RecordedCall } from "./helpers.js";

const isOAuth = (c: RecordedCall) => c.url.includes("/oauth/token");

describe("wf.request escape hatch", () => {
  it("GET: serializes query, attaches the bearer token and pinned version header", async () => {
    const { fetch, calls } = makeFetch(() => json({ data: [], meta: { has_more: false } }));
    const wf = new Wefunder({ accessToken: "at_test_x", fetch });

    const out = await wf.request<{ data: unknown[] }>("GET", "/partner/spvs", {
      query: { cursor: 25, limit: 10 },
    });

    // Full body returned as-is — no { data } stripping (envelopes vary off-surface).
    expect(out).toEqual({ data: [], meta: { has_more: false } });
    const c = calls[0]!;
    expect(c.url).toBe("https://api.wefunder.com/partner/spvs?cursor=25&limit=10");
    expect(c.headers["authorization"]).toBe("Bearer at_test_x");
    expect(c.headers["wefunder-version"]).toBeDefined();
  });

  it("POST: JSON-serializes the body, defaults Content-Type, passes custom headers through", async () => {
    const { fetch, calls } = makeFetch(() => json({ data: { id: "is_x", url: "https://…" } }, { status: 201 }));
    const wf = new Wefunder({ accessToken: "at_test_x", fetch });

    await wf.request("POST", "/partner/spvs/ofr_1/investment_sessions", {
      body: { investment_session: { email: "alex@example.com", allocation_cents: 500000 } },
      headers: { "Idempotency-Key": "demo-1" },
    });

    const c = calls[0]!;
    expect(c.method).toBe("POST");
    expect(JSON.parse(c.body!)).toEqual({
      investment_session: { email: "alex@example.com", allocation_cents: 500000 },
    });
    expect(c.headers["content-type"]).toBe("application/json");
    expect(c.headers["idempotency-key"]).toBe("demo-1");
  });

  it("caller headers win over the Content-Type default", async () => {
    const { fetch, calls } = makeFetch(() => json({ ok: true }));
    const wf = new Wefunder({ accessToken: "at_test_x", fetch });

    await wf.request("POST", "/x", { body: "a,b\n1,2", headers: { "Content-Type": "text/csv" } });

    expect(calls[0]!.headers["content-type"]).toBe("text/csv");
  });

  it("non-2xx throws a typed WefunderError with the nested request_id", async () => {
    const { fetch } = makeFetch(() =>
      json(
        { error: { type: "not_found", message: "No such SPV", details: {}, request_id: "req_123" } },
        { status: 404 },
      ),
    );
    const wf = new Wefunder({ accessToken: "at_test_x", fetch });

    const err = await wf.request("GET", "/partner/spvs/ofr_nope").catch((e) => e);
    expect(err).toBeInstanceOf(WefunderError);
    expect(err.status).toBe(404);
    expect(err.type).toBe("not_found");
    expect(err.requestId).toBe("req_123");
  });

  it("gets the FULL auth envelope: a 401 triggers client_credentials re-mint and a retry", async () => {
    const { fetch, calls } = makeFetch(async (c) => {
      if (isOAuth(c)) return json({ access_token: "at_test_NEW", expires_in: 7200 });
      return c.headers["authorization"] === "Bearer at_test_NEW"
        ? json({ data: { ok: true } })
        : new Response("{}", { status: 401 });
    });
    const wf = new Wefunder({
      accessToken: "at_test_OLD",
      clientId: "pk_test_c",
      clientSecret: "sk_test_s",
      clientCredentials: { scopes: ["read:offerings"] },
      fetch,
      sleep: noSleep,
    });

    const out = await wf.request<{ data: { ok: boolean } }>("GET", "/partner/spvs");
    expect(out.data.ok).toBe(true);
    expect(calls.filter(isOAuth)).toHaveLength(1); // exactly one re-mint
  });
});
