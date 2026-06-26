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

  it("lists offerings with a populated data + meta envelope", async () => {
    const page = await wf.offerings.list();
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.data!.length).toBeGreaterThan(0);
    expect(page.meta).toBeDefined();
    const first = page.data![0] as { id: unknown };
    expect(first.id).toBeDefined();
  });

  it("auto-paginates across at least one page boundary (opaque cursor)", async () => {
    const seen: unknown[] = [];
    const LIMIT = 30; // first page is 25 — forces a second fetch
    for await (const offering of wf.offerings.all()) {
      seen.push((offering as { id: unknown }).id);
      if (seen.length >= LIMIT) break;
    }
    expect(seen.length).toBe(LIMIT);
    expect(new Set(seen).size).toBe(LIMIT); // no duplicates across the boundary
  }, 30_000);

  it("fetches a single offering by external id", async () => {
    const page = await wf.offerings.list();
    const id = (page.data![0] as { id: string }).id;
    const offering = await wf.offerings.get(id);
    expect((offering as { id: string }).id).toBe(id);
  }, 30_000);

  it("surfaces a typed WefunderError for an unknown offering id", async () => {
    await expect(wf.offerings.get("ofr_does_not_exist_zzz")).rejects.toSatisfy(
      (e: unknown) => e instanceof WefunderError && (e as WefunderError).status >= 400,
    );
  }, 30_000);

  it("rejects a read:profile call (client_credentials may only hold read:public)", async () => {
    // users/me requires read:profile; a client_credentials token can't have it.
    await expect(wf.users.me()).rejects.toBeInstanceOf(WefunderError);
  }, 30_000);
});
