// Live sandbox E2E. Hits the REAL api.wefunder.com against a sandbox app.
// Auto-skips unless WEFUNDER_CLIENT_ID / WEFUNDER_CLIENT_SECRET are present
// (so CI without creds is green). Locally it reads them from ../.env.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wefunder, WefunderError } from "../../src/index.js";

// Load ../.env into process.env if not already set (no dotenv dependency).
function loadEnv(): void {
  if (process.env.WEFUNDER_CLIENT_ID) return;
  try {
    const text = readFileSync(resolve(__dirname, "../../.env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env — fine, the suite will skip
  }
}
loadEnv();

const clientId = process.env.WEFUNDER_CLIENT_ID;
const clientSecret = process.env.WEFUNDER_CLIENT_SECRET;
const hasCreds = Boolean(clientId && clientSecret);

describe.skipIf(!hasCreds)("live sandbox E2E", () => {
  let wf: Wefunder;

  beforeAll(async () => {
    wf = await Wefunder.fromClientCredentials({
      clientId: clientId!,
      clientSecret: clientSecret!,
      scopes: ["read:public"],
    });
  }, 30_000);

  it("obtains a sandbox token (client_credentials) and reports test mode", () => {
    expect(wf.mode).toBe("test");
    expect(wf.tokens.accessToken).toMatch(/^at_test_/);
    expect(wf.tokens.scope).toContain("read:public");
  });

  // NOTE: a freshly-provisioned sandbox realm has no curated offerings, so these assert
  // envelope shape + paginator invariants rather than a non-empty result set.
  it("lists offerings: returns a well-formed data + meta envelope", async () => {
    const page = await wf.offerings.list();
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.meta).toBeDefined();
    if (page.data!.length > 0) {
      expect((page.data![0] as { id: unknown }).id).toBeDefined();
    }
  });

  it("auto-pagination terminates cleanly with no duplicate ids (opaque cursor)", async () => {
    const seen: string[] = [];
    const CAP = 60; // bound the loop; sandbox realms may be small or empty
    for await (const offering of wf.offerings.all()) {
      seen.push((offering as { id: string }).id);
      if (seen.length >= CAP) break;
    }
    expect(new Set(seen).size).toBe(seen.length); // an opaque cursor never repeats a row
  }, 30_000);

  it("fetches a single offering by external id (when the realm has any)", async () => {
    const first = (await wf.offerings.list()).data?.[0] as { id: string } | undefined;
    if (!first) return; // empty sandbox realm — nothing to fetch
    const offering = await wf.offerings.get(first.id);
    expect((offering as { id: string }).id).toBe(first.id);
  }, 30_000);

  it("surfaces a typed WefunderError for an unknown offering id", async () => {
    await expect(wf.offerings.get("ofr_does_not_exist_zzz")).rejects.toSatisfy(
      (e: unknown) => e instanceof WefunderError && (e as WefunderError).status >= 400,
    );
  }, 30_000);

  it("rejects a read:profile call with a typed 403 that carries a request_id (nested-parse)", async () => {
    // users/me requires read:profile; a client_credentials token can't have it.
    // This also proves we parse request_id from the REAL nested `error.request_id`.
    await wf.users.me().then(
      () => expect.fail("client_credentials should not reach /users/me"),
      (err: WefunderError) => {
        expect(err).toBeInstanceOf(WefunderError);
        expect(err.status).toBe(403);
        expect(err.type).toBe("insufficient_scope");
        expect(err.requestId).toBeTruthy();
      },
    );
  }, 30_000);
});
