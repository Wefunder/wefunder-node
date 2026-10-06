// `wf.installations` + `wf.offerings.stats`: paths, bodies, envelope handling, and the
// already-installed fallback (409 already_installed → mint for details.installation, same scopes).
import { describe, it, expect } from "vitest";
import { Wefunder, WefunderError } from "../src/index.js";
import { makeFetch, json, noSleep } from "./helpers.js";

const install = {
  id: "ins_1",
  type: "installation",
  attributes: {
    target: { type: "syndicate", id: "syn_1" },
    status: "active",
    scopes: ["read:syndicates"],
  },
};
const mk = (fetch: typeof globalThis.fetch) =>
  new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep });

describe("offerings.stats", () => {
  it("GETs /offerings/{id}/stats and unwraps data", async () => {
    const { fetch, calls } = makeFetch(() =>
      json({
        data: { offering: "ofr_1", total: { count: 3, raised_cents: 1000 } },
        meta: { source: "published" },
      }),
    );
    const stats = await mk(fetch).offerings.stats("ofr_1");
    expect(new URL(calls[0]!.url).pathname).toBe("/offerings/ofr_1/stats");
    expect(stats.total?.count).toBe(3);
  });
});

describe("installations namespace", () => {
  it("eligibleTargets forwards target_type and returns the rows (empty list, not an error, for an investor)", async () => {
    const { fetch, calls } = makeFetch((c) =>
      json({
        data: c.url.includes("company")
          ? [{ type: "company", id: "co_1", name: "Acme", installed: false }]
          : [],
      }),
    );
    const wf = mk(fetch);
    const rows = await wf.installations.eligibleTargets({
      target_type: "company",
    });
    expect(new URL(calls[0]!.url).pathname).toBe("/installations/eligible");
    expect(new URL(calls[0]!.url).searchParams.get("target_type")).toBe(
      "company",
    );
    expect(rows.map((r) => r.id)).toEqual(["co_1"]);
    expect(
      await wf.installations.eligibleTargets({ target_type: "syndicate" }),
    ).toEqual([]);
  });

  it("list returns the envelope (meta.count); get and revoke unwrap data from the right paths", async () => {
    const { fetch, calls } = makeFetch((c) => {
      if (c.method === "DELETE")
        return json({
          data: {
            ...install,
            attributes: { ...install.attributes, status: "revoked" },
          },
        });
      if (c.url.endsWith("/installations"))
        return json({ data: [install], meta: { count: 1 } });
      return json({ data: install });
    });
    const wf = mk(fetch);
    const list = await wf.installations.list();
    expect(list.meta?.count).toBe(1);
    expect((await wf.installations.get("ins_1")).id).toBe("ins_1");
    expect((await wf.installations.revoke("ins_1")).attributes?.status).toBe(
      "revoked",
    );
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /installations",
      "GET /installations/ins_1",
      "DELETE /installations/ins_1",
    ]);
  });

  it("create POSTs the body and keeps the one-time token beside data", async () => {
    const { fetch, calls } = makeFetch(() =>
      json(
        {
          data: install,
          token: { access_token: "at_live_INSTALL", installation: "ins_1" },
        },
        { status: 201 },
      ),
    );
    const created = await mk(fetch).installations.create({
      target_type: "syndicate",
      target_id: "syn_1",
      scopes: ["read:syndicates"],
    });
    expect(calls[0]!.method).toBe("POST");
    expect(new URL(calls[0]!.url).pathname).toBe("/installations");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      target_type: "syndicate",
      target_id: "syn_1",
      scopes: ["read:syndicates"],
    });
    expect(created.data?.id).toBe("ins_1");
    expect(created.token?.access_token).toBe("at_live_INSTALL");
  });

  it("mintToken sends scopes when given and NO body when omitted (omit = the install's ceiling)", async () => {
    const { fetch, calls } = makeFetch(() =>
      json(
        { data: install, token: { access_token: "at_live_MINT" } },
        { status: 201 },
      ),
    );
    const wf = mk(fetch);
    await wf.installations.mintToken("ins_1", ["read:investments"]);
    await wf.installations.mintToken("ins_1");
    expect(new URL(calls[0]!.url).pathname).toBe("/installations/ins_1/tokens");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      scopes: ["read:investments"],
    });
    expect(calls[1]!.body).toBeUndefined();
  });

  it("installOrMintToken: 409 already_installed → mints for details.installation with the SAME scopes", async () => {
    const { fetch, calls } = makeFetch((c) => {
      const path = new URL(c.url).pathname;
      if (path === "/installations")
        return json(
          {
            error: {
              type: "already_installed",
              message: "already",
              details: { installation: "ins_existing" },
              request_id: "req_1",
            },
          },
          { status: 409 },
        );
      if (path === "/installations/ins_existing/tokens")
        return json(
          {
            data: { ...install, id: "ins_existing" },
            token: { access_token: "at_live_MINT" },
          },
          { status: 201 },
        );
      throw new Error(`unexpected ${path}`);
    });
    const result = await mk(fetch).installations.installOrMintToken({
      target_type: "syndicate",
      target_id: "syn_1",
      scopes: ["read:syndicates"],
    });
    expect(result.token?.access_token).toBe("at_live_MINT");
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /installations",
      "POST /installations/ins_existing/tokens",
    ]);
    expect(JSON.parse(calls[1]!.body!)).toEqual({
      scopes: ["read:syndicates"],
    });
  });

  it("installOrMintToken: a fresh install returns the create response without a second call", async () => {
    const { fetch, calls } = makeFetch(() =>
      json(
        { data: install, token: { access_token: "at_live_NEW" } },
        { status: 201 },
      ),
    );
    const result = await mk(fetch).installations.installOrMintToken({
      target_type: "syndicate",
      target_id: "syn_1",
    });
    expect(result.token?.access_token).toBe("at_live_NEW");
    expect(calls).toHaveLength(1);
  });

  it("installOrMintToken: any other error (installation_revoked, or a 409 with no details) still surfaces", async () => {
    const revoked = makeFetch(() =>
      json(
        {
          error: {
            type: "installation_revoked",
            message: "revoked",
            request_id: "req_2",
          },
        },
        { status: 409 },
      ),
    );
    await expect(
      mk(revoked.fetch).installations.installOrMintToken({
        target_type: "syndicate",
        target_id: "syn_1",
      }),
    ).rejects.toMatchObject({ status: 409, type: "installation_revoked" });

    const noDetails = makeFetch(() =>
      json(
        {
          error: {
            type: "already_installed",
            message: "already",
            request_id: "req_3",
          },
        },
        { status: 409 },
      ),
    );
    const err = await mk(noDetails.fetch)
      .installations.installOrMintToken({
        target_type: "syndicate",
        target_id: "syn_1",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WefunderError);
    expect(err.type).toBe("already_installed");
    expect(noDetails.calls).toHaveLength(1);
  });
});
