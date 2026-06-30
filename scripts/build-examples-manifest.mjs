#!/usr/bin/env node
// Build examples_manifest.json — the verified-JSON artifact the docs site consumes.
//
// Each file in examples/ is a real, compile-checked (and where possible run-checked)
// module. A `// #region <key>` ... `// #endregion` block delimits the snippet shown in
// the docs; everything outside it (imports, the `example(wf)` wrapper) is harness and
// never shipped. `<key>` is usually an operationId, but any string works — e.g.
// `guides/quickstart` — which is how the same pipeline serves arbitrary guide snippets.
//
// This is the LANGUAGE-AGNOSTIC contract: wefunder-python / wefunder-ruby emit a manifest
// with this exact shape (different `lang`/`label`, language-appropriate comment markers).
// See examples/README.md.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const EXAMPLES_DIR = resolve(ROOT, "examples");
const OUT = resolve(ROOT, "examples_manifest.json");

const REGION = /^\s*\/\/\s*#region\s+(\S+)\s*$/;
const ENDREGION = /^\s*\/\/\s*#endregion\b/;

// Strip the common leading indentation from a block, trimming blank edge lines.
function dedent(lines) {
  const body = [...lines];
  while (body.length && body[0].trim() === "") body.shift();
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  const indents = body.filter((l) => l.trim() !== "").map((l) => l.match(/^\s*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return body.map((l) => l.slice(min)).join("\n");
}

// Extract every #region block from one file → { key: source }.
function extractRegions(text) {
  const out = {};
  const lines = text.split("\n");
  let key = null;
  let buf = [];
  for (const line of lines) {
    const open = line.match(REGION);
    if (open) {
      if (key) throw new Error(`nested #region (${open[1]}) inside ${key}`);
      key = open[1];
      buf = [];
      continue;
    }
    if (ENDREGION.test(line)) {
      if (!key) throw new Error("#endregion without #region");
      if (out[key]) throw new Error(`duplicate region key: ${key}`);
      out[key] = dedent(buf);
      key = null;
      continue;
    }
    if (key) buf.push(line);
  }
  if (key) throw new Error(`unterminated #region: ${key}`);
  return out;
}

function readApiVersion() {
  // Tag examples with the API version the SDK actually pins.
  const client = readFileSync(resolve(ROOT, "src/client.ts"), "utf8");
  const m = client.match(/DEFAULT_API_VERSION\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

export function buildManifest() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  const files = readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
    .sort();

  const samples = {};
  const skipped = [];
  for (const file of files) {
    const regions = extractRegions(readFileSync(resolve(EXAMPLES_DIR, file), "utf8"));
    if (Object.keys(regions).length === 0) {
      // A file with no #region is a runnable illustration (e.g. a framework-integration
      // script), not a doc snippet. Skip it, but surface it so it's never silently lost.
      skipped.push(file);
      continue;
    }
    for (const [key, source] of Object.entries(regions)) {
      if (samples[key]) throw new Error(`duplicate sample key across files: ${key} (in ${basename(file)})`);
      samples[key] = source;
    }
  }
  if (skipped.length) {
    console.warn(`build-examples-manifest: no #region in ${skipped.join(", ")} — not in manifest (runnable illustration only)`);
  }

  // Deterministic key order so the committed file diffs cleanly.
  const ordered = Object.fromEntries(Object.keys(samples).sort().map((k) => [k, samples[k]]));
  return {
    manifestVersion: 1,
    lang: "JavaScript", // MUST equal the Docusaurus/postman tab label, or the merge no-ops.
    label: "@wefunder/sdk",
    sdkVersion: pkg.version,
    apiVersion: readApiVersion(),
    generatedBy: "scripts/build-examples-manifest.mjs",
    samples: ordered,
  };
}

// Stable serialization shared by the writer and the freshness gate.
export function serialize(manifest) {
  return JSON.stringify(manifest, null, 2) + "\n";
}

// Write when run directly.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, serialize(buildManifest()));
  console.log(`wrote ${OUT}`);
}
