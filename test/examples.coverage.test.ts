// Gates that keep doc examples honest (hermetic — no network; runs in `npm test`):
//   COVERAGE  — every public operationId has an SDK example, or is explicitly curl-only.
//   FRESHNESS — the committed examples_manifest.json matches what the builder produces.
//   SHAPE     — the manifest's `lang` is one the docs theme can actually merge onto a tab.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain ESM script, no type decls (it's build tooling).
import { buildManifest, serialize } from "../scripts/build-examples-manifest.mjs";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

// operationIds declared in the vendored public-tier spec — the surface the SDK should cover.
const specOperationIds = [...read("spec/openapi.yaml").matchAll(/^\s*operationId:\s*(\w+)/gm)].map(
  (m) => m[1] as string,
);
const manifest = JSON.parse(read("examples_manifest.json")) as {
  lang: string;
  samples: Record<string, string>;
};
const allowlist = JSON.parse(read("examples/coverage-allowlist.json")) as { curlOnly: string[] };

const exampleKeys = new Set(Object.keys(manifest.samples));
const curlOnly = new Set(allowlist.curlOnly);

describe("examples coverage", () => {
  it("every public operationId has an example or is explicitly curl-only", () => {
    const uncovered = specOperationIds.filter((id) => !exampleKeys.has(id) && !curlOnly.has(id));
    expect(uncovered, `add an example in examples/ or list these in coverage-allowlist.json`).toEqual([]);
  });

  it("no operationId is both exampled and on the curl-only allowlist", () => {
    const both = [...curlOnly].filter((id) => exampleKeys.has(id));
    expect(both, "remove these from coverage-allowlist.json — they now have examples").toEqual([]);
  });

  it("the curl-only allowlist has no stale (non-existent) operationIds", () => {
    const specSet = new Set(specOperationIds);
    const stale = [...curlOnly].filter((id) => !specSet.has(id));
    expect(stale, "these allowlist entries are not operationIds in the spec").toEqual([]);
  });
});

describe("examples manifest", () => {
  it("is up to date with examples/ (run `npm run build:examples`)", () => {
    expect(serialize(buildManifest())).toEqual(read("examples_manifest.json"));
  });

  it("declares a lang the docs theme can merge onto a tab", () => {
    // mergeCodeSampleLanguage matches x-codeSamples.lang against the postman tab label.
    expect(["JavaScript", "Python", "Ruby"]).toContain(manifest.lang);
  });
});
