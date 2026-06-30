// Run gate: execute the read:public-safe doc examples against the REAL sandbox, so an
// example that still compiles but no longer *works* (endpoint moved, shape changed) fails
// CI. Only examples reachable with a client_credentials read:public token run here; the
// rest are compile-gated (test/examples.coverage.test.ts) until we have richer creds.
// Auto-skips without WEFUNDER_CLIENT_ID/SECRET (same pattern as sandbox.e2e.test.ts).
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wefunder } from "../../src/index.js";
import { example as listOfferings } from "../../examples/listOfferings.js";

function loadEnv(): void {
  if (process.env.WEFUNDER_CLIENT_ID) return;
  try {
    const text = readFileSync(resolve(__dirname, "../../.env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env — suite skips */
  }
}
loadEnv();

const clientId = process.env.WEFUNDER_CLIENT_ID;
const clientSecret = process.env.WEFUNDER_CLIENT_SECRET;
const hasCreds = Boolean(clientId && clientSecret);

describe.skipIf(!hasCreds)("doc examples run against sandbox", () => {
  let wf: Wefunder;
  beforeAll(async () => {
    wf = await Wefunder.fromClientCredentials({
      clientId: clientId!,
      clientSecret: clientSecret!,
      scopes: ["read:public"],
    });
  }, 30_000);

  it("listOfferings runs and returns a well-formed page", async () => {
    // A fresh sandbox realm has no curated offerings, so assert the call succeeds and
    // the envelope is well-formed — not that the result set is non-empty.
    const page = await listOfferings(wf);
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.meta).toBeDefined();
  });
});
