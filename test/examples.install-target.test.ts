// The install-target guide must survive the API's "already installed" answer: createInstallation
// returns 409 already_installed (details.installation = the existing id) and the example has to
// mint a token for THAT install and continue — not surface the 409. (Review finding on PR #18.)
import { describe, it, expect, vi, afterEach } from "vitest";
import { Wefunder, WefunderError } from "../src/index.js";
import { example } from "../examples/install-target.js";
import { makeFetch, json, noSleep } from "./helpers.js";

const target = (id: string) => ({
  type: "syndicate",
  id,
  name: "Example Syndicate",
  installed: true,
});

// The example builds a SECOND client for the installation token with `new Wefunder({ accessToken })`,
// which picks up global fetch — route that through the same fake.
const useFake = (fetch: typeof globalThis.fetch) =>
  vi.stubGlobal("fetch", fetch);
afterEach(() => vi.unstubAllGlobals());

describe("examples/install-target.ts", () => {
  it("already installed: 409 already_installed → mints for details.installation → first request as the install", async () => {
    const { fetch, calls } = makeFetch((c) => {
      const url = new URL(c.url);
      if (url.pathname === "/installations/eligible")
        return json({ data: [target("syn_1")] });
      if (url.pathname === "/installations" && c.method === "POST") {
        return json(
          {
            error: {
              type: "already_installed",
              message: "This app is already installed here",
              details: { installation: "ins_existing" },
              request_id: "req_1",
            },
          },
          { status: 409 },
        );
      }
      if (url.pathname === "/installations/ins_existing/tokens") {
        return json(
          {
            data: { id: "ins_existing" },
            token: { access_token: "at_live_INSTALL" },
          },
          { status: 201 },
        );
      }
      if (url.pathname === "/syndicates/syn_1/deals")
        return json({ data: [{ id: "deal_1" }], meta: {} });
      throw new Error(`unexpected ${c.method} ${url.pathname}`);
    });
    useFake(fetch);
    const wf = new Wefunder({
      accessToken: "at_live_USER",
      fetch,
      sleep: noSleep,
    });

    const deals = await example(wf, "syn_1");

    expect(deals.data).toEqual([{ id: "deal_1" }]);
    const seen = calls.map(
      (c) =>
        `${c.method} ${new URL(c.url).pathname} ${c.headers["authorization"]}`,
    );
    expect(seen).toEqual([
      "GET /installations/eligible Bearer at_live_USER",
      "POST /installations Bearer at_live_USER",
      "POST /installations/ins_existing/tokens Bearer at_live_USER",
      "GET /syndicates/syn_1/deals Bearer at_live_INSTALL", // the deals call runs AS the installation
    ]);
    // The mint for the existing install asks for the SAME read-only scope as the install itself.
    expect(JSON.parse(calls[2]!.body!)).toEqual({
      scopes: ["read:syndicates"],
    });
  });

  it("fresh install: uses the token from the create response, never lists or re-mints", async () => {
    const { fetch, calls } = makeFetch((c) => {
      const url = new URL(c.url);
      if (url.pathname === "/installations/eligible") return json({ data: [] });
      if (url.pathname === "/installations")
        return json(
          { data: { id: "ins_new" }, token: { access_token: "at_live_NEW" } },
          { status: 201 },
        );
      if (url.pathname === "/syndicates/syn_1/deals")
        return json({ data: [], meta: {} });
      throw new Error(`unexpected ${c.method} ${url.pathname}`);
    });
    useFake(fetch);
    const wf = new Wefunder({
      accessToken: "at_live_USER",
      fetch,
      sleep: noSleep,
    });
    await example(wf, "syn_1");
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/installations/eligible",
      "/installations",
      "/syndicates/syn_1/deals",
    ]);
    expect(calls[2]!.headers["authorization"]).toBe("Bearer at_live_NEW");
  });

  it("any other 409 (e.g. installation_revoked) still surfaces", async () => {
    const { fetch } = makeFetch((c) => {
      const url = new URL(c.url);
      if (url.pathname === "/installations/eligible") return json({ data: [] });
      return json(
        {
          error: {
            type: "installation_revoked",
            message: "revoked",
            request_id: "req_2",
          },
        },
        { status: 409 },
      );
    });
    const wf = new Wefunder({
      accessToken: "at_live_USER",
      fetch,
      sleep: noSleep,
    });
    await expect(example(wf, "syn_1")).rejects.toMatchObject({
      status: 409,
      type: "installation_revoked",
    });
    await expect(example(wf, "syn_1")).rejects.toBeInstanceOf(WefunderError);
  });
});
