#!/usr/bin/env node
// Sync spec/openapi.yaml from the canonical Wefunder swagger.
//
// The SDK ships the PUBLIC tier only (stable + beta). Filtering is owned by the
// wefunder repo's api-docs/scripts/build-filtered-spec.js (the single source of
// truth for which x-wf-stability tiers are public) — we run it and copy its output
// rather than reimplementing the filter here, so the two can never diverge.
//
// Usage:
//   WEFUNDER_REPO=/path/to/wefunder npm run sync-spec
//   npm run sync-spec -- /path/to/wefunder
//
// After syncing, run `npm run generate` and commit both spec/ and src/generated/.
// NOTE: this is a maintainer step (needs a local wefunder checkout). The SDK's CI
// can only verify that src/generated matches the committed spec — it cannot reach
// the private canonical swagger. Run this before cutting a release. (Future: have
// the wefunder repo publish the public spec as a fetchable artifact so this can be
// fully automated / CI-gated.)

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const repoArg = process.env.WEFUNDER_REPO || process.argv[2];
if (!repoArg) {
  console.error("error: set WEFUNDER_REPO=/path/to/wefunder (or pass it as an argument).");
  process.exit(1);
}
const repo = resolve(repoArg);
const builder = join(repo, "api-docs", "scripts", "build-filtered-spec.js");
if (!existsSync(builder)) {
  console.error(`error: ${builder} not found — is ${repo} a wefunder checkout?`);
  process.exit(1);
}

// Regenerate the public-tier spec in the canonical repo (writes swagger.public.yaml).
console.log("→ building public-tier spec via the canonical filter…");
execFileSync("node", ["scripts/build-filtered-spec.js"], {
  cwd: join(repo, "api-docs"),
  stdio: "inherit",
});

const src = join(repo, "swagger", "v2", "swagger.public.yaml");
if (!existsSync(src)) {
  console.error(`error: expected ${src} after build — did the builder change its output path?`);
  process.exit(1);
}
const dest = resolve("spec/openapi.yaml");
copyFileSync(src, dest);

const ops = (readFileSync(dest, "utf8").match(/^\s+operationId:/gm) || []).length;
console.log(`✓ wrote spec/openapi.yaml (${ops} public operations)`);
console.log("  next: npm run generate && git add spec src/generated");
