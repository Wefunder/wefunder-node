#!/usr/bin/env node
// Writes conformance/manifest.json: a SHA-256 per vector file. The test suite fails when a
// vector changes without this being re-run, and other SDKs use the same hashes to detect a
// stale vendored copy. `--check` exits 1 instead of writing when the manifest is stale.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("../conformance/", import.meta.url).pathname;
const CONFORMANCE_VERSION = 1;

export function buildManifest() {
  const files = {};
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .sort()) {
    files[name] = createHash("sha256")
      .update(readFileSync(join(dir, name)))
      .digest("hex");
  }
  return { conformance_version: CONFORMANCE_VERSION, files };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const manifest = JSON.stringify(buildManifest(), null, 2) + "\n";
  const target = join(dir, "manifest.json");
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {
      /* missing */
    }
    if (current !== manifest) {
      console.error(
        "conformance/manifest.json is stale — run `npm run build:conformance`.",
      );
      process.exit(1);
    }
    console.log("conformance/manifest.json is fresh");
  } else {
    writeFileSync(target, manifest);
    console.log(
      `wrote ${target} (${Object.keys(JSON.parse(manifest).files).length} files)`,
    );
  }
}
