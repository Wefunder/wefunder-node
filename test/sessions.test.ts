// `wf.joinSessions` + `wf.investmentSessions` (beta since wefunder #24129): paths, bodies, headers,
// envelope handling, pagination.
import { describe, it, expect } from "vitest";
import { Wefunder } from "../src/index.js";
import { makeFetch, json, noSleep } from "./helpers.js";

const mk = (fetch: typeof globalThis.fetch) => new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
const js = { id: "js_1", type: "join_session", attributes: { status: "pending", email: "m@example.com", url: "https://wefunder.com/join/session/js_1" } };
const is = { id: "is_1", type: "investment_session", attributes: { status: "pending", url: "https://wefunder.com/invest/session/is_1" } };

describe("joinSessions namespace", () => {
  it("list/all page a syndicate's sessions; create wraps the body; get hits the nested path", async () => {
    const { fetch, calls } = makeFetch((c) => {
      const u = new URL(c.url);
      if (c.method === "POST") return json({ data: js }, { status: 201 });
      if (u.pathname === "/syndicates/syn_1/join_sessions")
        return u.searchParams.get("cursor") ? json({ data: [{ ...js, id: "js_2" }], meta: { has_more: false } }) : json({ data: [js], meta: { has_more: true, next_cursor: "c2" } });
      return json({ data: js });
    });
    const wf = mk(fetch);
    const ids: string[] = [];
    for await (const s of wf.joinSessions.all("syn_1", { per_page: 1 })) ids.push(s.id);
    expect(ids).toEqual(["js_1", "js_2"]);
    const created = await wf.joinSessions.create("syn_1", { email: "m@example.com", require_approval: true });
    expect(created.attributes.url).toMatch(/join\/session/);
    expect((await wf.joinSessions.get("syn_1", "js_1")).id).toBe("js_1");
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /syndicates/syn_1/join_sessions", "GET /syndicates/syn_1/join_sessions",
      "POST /syndicates/syn_1/join_sessions", "GET /syndicates/syn_1/join_sessions/js_1",
    ]);
    expect(new URL(calls[0]!.url).searchParams.get("per_page")).toBe("1");
    expect(JSON.parse(calls[2]!.body!)).toEqual({ join_session: { email: "m@example.com", require_approval: true } });
  });
});

describe("investmentSessions namespace", () => {
  it("list forwards filters; listForOffering/allForOffering page one offering; create wraps the body and sends Idempotency-Key; get/cancel hit their paths", async () => {
    const { fetch, calls } = makeFetch((c) => {
      const u = new URL(c.url);
      if (c.method === "POST") return json({ data: is }, { status: 201 });
      if (c.method === "DELETE") return json({ data: { ...is, attributes: { ...is.attributes, status: "canceled" } } });
      if (u.pathname === "/investment_sessions") return json({ data: [is], meta: { has_more: false } });
      if (u.pathname === "/offerings/ofr_1/investment_sessions")
        return u.searchParams.get("cursor") ? json({ data: [{ ...is, id: "is_2" }], meta: { has_more: false } }) : json({ data: [is], meta: { has_more: true, next_cursor: 9 } });
      return json({ data: is });
    });
    const wf = mk(fetch);
    expect((await wf.investmentSessions.list({ status: "in_progress", spv_id: "spv_1" })).data?.[0]?.id).toBe("is_1");
    expect(new URL(calls[0]!.url).searchParams.get("status")).toBe("in_progress");
    const ids: string[] = [];
    for await (const s of wf.investmentSessions.allForOffering("ofr_1", { status: "completed" })) ids.push(s.id!);
    expect(ids).toEqual(["is_1", "is_2"]);
    expect(new URL(calls[2]!.url).searchParams.get("status")).toBe("completed");
    const created = await wf.investmentSessions.create("ofr_1", { email: "i@example.com", allocation_cents: 250000 }, { idempotencyKey: "k1" });
    expect(created.id).toBe("is_1");
    expect((await wf.investmentSessions.get("is_1")).id).toBe("is_1");
    expect((await wf.investmentSessions.cancel("is_1")).attributes?.status).toBe("canceled");
    expect(calls.slice(3).map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /offerings/ofr_1/investment_sessions", "GET /investment_sessions/is_1", "DELETE /investment_sessions/is_1",
    ]);
    expect(JSON.parse(calls[3]!.body!)).toEqual({ investment_session: { email: "i@example.com", allocation_cents: 250000 } });
    expect(calls[3]!.headers["idempotency-key"]).toBe("k1");
  });
});
