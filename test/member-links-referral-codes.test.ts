// `wf.memberLinks` + `wf.referralCodes` (new in Wefunder-Version 2026-10-15): paths, bodies,
// headers, envelope handling, pagination.
import { describe, it, expect } from "vitest";
import { Wefunder, DEFAULT_API_VERSION } from "../src/index.js";
import { makeFetch, json, noSleep } from "./helpers.js";

const mk = (fetch: typeof globalThis.fetch) => new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });
const link = { id: "il_1", type: "member_link", attributes: { reference: "member_8812", state: "created", url: "https://wefunder.com/x?invite_token=t" } };
const code = { id: "ref_1", type: "referral_code", attributes: { label: "October", active: true, link_parameter: "wfr=ref_1" } };

describe("default API version", () => {
  it("is 2026-10-15 and is sent on every request", async () => {
    const { fetch, calls } = makeFetch(() => json({ data: { id: "usr_1" } }));
    await mk(fetch).users.me();
    expect(DEFAULT_API_VERSION).toBe("2026-10-15");
    expect(calls[0]!.headers["wefunder-version"]).toBe("2026-10-15");
  });
});

describe("memberLinks namespace", () => {
  it("list/all page an offering's links; create sends the body and Idempotency-Key; get/cancel hit their paths", async () => {
    const { fetch, calls } = makeFetch((c) => {
      const u = new URL(c.url);
      if (c.method === "POST" && u.pathname === "/offerings/ofr_1/member_links") return json({ data: link }, { status: 201 });
      if (u.pathname === "/offerings/ofr_1/member_links")
        return u.searchParams.get("cursor") ? json({ data: [{ ...link, id: "il_2" }], meta: { has_more: false, next_cursor: null } }) : json({ data: [link], meta: { has_more: true, next_cursor: "c2" } });
      if (u.pathname === "/member_links/il_1/cancel") return json({ data: { ...link, attributes: { ...link.attributes, state: "canceled" } } });
      return json({ data: link });
    });
    const wf = mk(fetch);
    const ids: string[] = [];
    for await (const l of wf.memberLinks.all("ofr_1")) ids.push(l.id!);
    expect(ids).toEqual(["il_1", "il_2"]);
    const created = await wf.memberLinks.create("ofr_1", { reference: "member_8812" }, { idempotencyKey: "k1" });
    expect(created.id).toBe("il_1");
    expect((await wf.memberLinks.get("il_1")).id).toBe("il_1");
    expect((await wf.memberLinks.cancel("il_1")).attributes?.state).toBe("canceled");
    const seen = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
    expect(seen).toEqual([
      "GET /offerings/ofr_1/member_links", "GET /offerings/ofr_1/member_links",
      "POST /offerings/ofr_1/member_links", "GET /member_links/il_1", "POST /member_links/il_1/cancel",
    ]);
    expect(JSON.parse(calls[2]!.body!)).toEqual({ member_link: { reference: "member_8812" } });
    expect(calls[2]!.headers["idempotency-key"]).toBe("k1");
  });

  it("create without input sends no body", async () => {
    const { fetch, calls } = makeFetch(() => json({ data: link }, { status: 201 }));
    await mk(fetch).memberLinks.create("ofr_1");
    expect(calls[0]!.body).toBeUndefined();
    expect(calls[0]!.headers["idempotency-key"]).toBeUndefined();
  });
});

describe("referralCodes namespace", () => {
  it("list forwards filters; create/update send bodies; get/stats hit their paths and stats keeps the envelope", async () => {
    const { fetch, calls } = makeFetch((c) => {
      const u = new URL(c.url);
      if (u.pathname === "/referral_codes" && c.method === "GET") return json({ data: [code], meta: { has_more: false, next_cursor: null, active_limit: 50 } });
      if (u.pathname === "/referral_codes/ref_1/stats")
        return json({ data: { id: "ref_1", type: "referral_code_stats", attributes: { label: "October", companies: [{ company: "co_1", level: "anonymized", weeks: [] }] } }, meta: { has_more: false, next_cursor: null } });
      return json({ data: code }, { status: c.method === "POST" ? 201 : 200 });
    });
    const wf = mk(fetch);
    expect((await wf.referralCodes.list({ active: true, per_page: 10 })).data?.[0]?.id).toBe("ref_1");
    expect(new URL(calls[0]!.url).searchParams.get("active")).toBe("true");
    const created = await wf.referralCodes.create({ label: "October", company_id: "co_1", utm: { source: "newsletter" } });
    expect(created.attributes?.link_parameter).toBe("wfr=ref_1");
    await wf.referralCodes.get("ref_1");
    await wf.referralCodes.update("ref_1", { active: false });
    const stats = await wf.referralCodes.stats("ref_1", { company_id: "co_1" });
    expect(stats.data?.attributes?.companies?.[0]?.company).toBe("co_1");
    expect(stats.meta?.has_more).toBe(false);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /referral_codes", "POST /referral_codes", "GET /referral_codes/ref_1", "PATCH /referral_codes/ref_1", "GET /referral_codes/ref_1/stats",
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ label: "October", company_id: "co_1", utm: { source: "newsletter" } });
    expect(JSON.parse(calls[3]!.body!)).toEqual({ active: false });
    expect(new URL(calls[4]!.url).searchParams.get("company_id")).toBe("co_1");
  });
});
