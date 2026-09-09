import { describe, it, expect } from "vitest";
import { Wefunder } from "../src/index.js";
import { makeFetch, json } from "./helpers.js";

const client = (fetch: typeof globalThis.fetch) => new Wefunder({ accessToken: "at_test_x", fetch });

describe("partner.spvs — single-resource ergonomics", () => {
  it("get() builds the prefixed path and unwraps to the bare SPV", async () => {
    const { fetch, calls } = makeFetch(() =>
      json({ data: { id: "ofr_x", attributes: { status: "open" } }, meta: { request_id: "req_1" } }),
    );
    const spv = await client(fetch).partner.spvs.get("ofr_x");
    expect(new URL(calls[0]!.url).pathname).toBe("/partner/spvs/ofr_x");
    expect(spv.attributes?.status).toBe("open");
  });

  it("create() wraps the body under `spv`, sends the Idempotency-Key, returns the bare SPV", async () => {
    const { fetch, calls } = makeFetch(() =>
      json({ data: { id: "ofr_new", attributes: { status: "draft" } } }, { status: 201 }),
    );
    const spv = await client(fetch).partner.spvs.create(
      {
        name: "Demo SPV",
        terms: {
          structure: "safe",
          valuation_cap_cents: 1,
          minimum_investment_cents: 1,
          target_raise_cents: 1,
        },
      },
      { idempotencyKey: "key-1" },
    );
    expect(spv.id).toBe("ofr_new");
    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ spv: expect.objectContaining({ name: "Demo SPV" }) });
    expect(calls[0]!.headers["idempotency-key"]).toBe("key-1");
  });

  it("close() returns { spv, intent } sourced from meta.disburse_intent", async () => {
    const { fetch, calls } = makeFetch(() =>
      json({
        data: { id: "ofr_x", attributes: { status: "closing" } },
        meta: { request_id: "req_2", disburse_intent: { id: "int_1", status: "pending", review_url: "https://wf/approve/int_1" } },
      }),
    );
    const { spv, intent } = await client(fetch).partner.spvs.close("ofr_x");
    expect(new URL(calls[0]!.url).pathname).toBe("/partner/spvs/ofr_x/close");
    expect(spv.attributes?.status).toBe("closing");
    expect(intent?.review_url).toBe("https://wf/approve/int_1");
  });

  it("cancel() sends the reason body and returns { spv, intent } from meta.cancel_intent", async () => {
    const { fetch, calls } = makeFetch(() =>
      json({
        data: { id: "ofr_x", attributes: { status: "open" } },
        meta: { cancel_intent: { id: "int_2", review_url: "https://wf/approve/int_2" } },
      }),
    );
    const { intent } = await client(fetch).partner.spvs.cancel("ofr_x", { reason: "lead withdrew" });
    expect(new URL(calls[0]!.url).pathname).toBe("/partner/spvs/ofr_x/cancel");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ reason: "lead withdrew" });
    expect(intent?.id).toBe("int_2");
  });
});

describe("partner.spvs.inviteLinks — nested path building", () => {
  it("get() threads both the SPV id and the invite-link id into the path", async () => {
    const { fetch, calls } = makeFetch(() => json({ data: { id: "il_y", attributes: { status: "pending" } } }));
    await client(fetch).partner.spvs.inviteLinks.get("ofr_x", "il_y");
    expect(new URL(calls[0]!.url).pathname).toBe("/partner/spvs/ofr_x/invite_links/il_y");
  });

  it("bulkCreate() posts to /bulk and returns the full envelope (data + errors + meta)", async () => {
    const { fetch, calls } = makeFetch(() =>
      json(
        {
          data: [{ id: "il_1", attributes: { email: "a@example.com" } }],
          errors: [{ index: 1, type: "validation_error", detail: "bad email" }],
          meta: { created: 1, failed: 1 },
        },
        { status: 207 },
      ),
    );
    const res = await client(fetch).partner.spvs.inviteLinks.bulkCreate("ofr_x", {
      invite_links: [{ email: "a@example.com" }, { email: "nope" }],
    });
    expect(new URL(calls[0]!.url).pathname).toBe("/partner/spvs/ofr_x/invite_links/bulk");
    expect(res.data).toHaveLength(1);
    expect(res.errors?.[0]?.index).toBe(1);
    expect(res.meta).toEqual({ created: 1, failed: 1 });
  });
});

describe("partner id-scoped pagination", () => {
  it("investments.all() threads per_page + cursor across pages on the SPV-scoped path", async () => {
    const seen: URL[] = [];
    const { fetch } = makeFetch((c) => {
      const u = new URL(c.url);
      seen.push(u);
      return u.searchParams.get("cursor")
        ? json({ data: [{ id: "inv_2" }], meta: { has_more: false, next_cursor: null } })
        : json({ data: [{ id: "inv_1" }], meta: { has_more: true, next_cursor: 99 } });
    });
    const ids: unknown[] = [];
    for await (const inv of client(fetch).partner.spvs.investments.all("ofr_x", { per_page: 10 })) {
      ids.push(inv.id);
    }
    expect(ids).toEqual(["inv_1", "inv_2"]);
    expect(seen.map((u) => u.pathname)).toEqual([
      "/partner/spvs/ofr_x/investments",
      "/partner/spvs/ofr_x/investments",
    ]);
    expect(seen.map((u) => u.searchParams.get("per_page"))).toEqual(["10", "10"]);
    expect(seen[1]!.searchParams.get("cursor")).toBe("99");
  });
});

describe("partner.investmentSessions", () => {
  it("list() forwards spv_id and status filters", async () => {
    const { fetch, calls } = makeFetch(() => json({ data: [], meta: {} }));
    await client(fetch).partner.investmentSessions.list({ spv_id: "ofr_x", status: "completed" });
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/partner/investment_sessions");
    expect(u.searchParams.get("spv_id")).toBe("ofr_x");
    expect(u.searchParams.get("status")).toBe("completed");
  });

  it("create() wraps the body under `investment_session`", async () => {
    const { fetch, calls } = makeFetch(() =>
      json({ data: { id: "is_1", attributes: { status: "pending", url: "https://wf/s/is_1" } } }, { status: 201 }),
    );
    const session = await client(fetch).partner.investmentSessions.create({
      spv_id: "ofr_x",
      email: "investor@example.com",
    });
    expect(session.attributes?.url).toBe("https://wf/s/is_1");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      investment_session: { spv_id: "ofr_x", email: "investor@example.com" },
    });
  });
});
