# examples/ — the source of truth for docs code samples

The Wefunder API docs (docs.wefunder.com) show idiomatic SDK code on every operation.
Those snippets are **not** hand-transcribed into the docs site — they're authored here,
**gated against the real SDK**, and published as a verified JSON artifact the docs build
consumes. This keeps the examples from rotting: if the SDK surface changes and an example
no longer compiles (or no longer runs), CI in *this* repo goes red.

This file is the **cross-language contract**. `wefunder-python` and `wefunder-ruby` mirror
it exactly — same manifest shape, same key scheme, language-appropriate markers — so the
docs build treats all three identically.

## How it works

1. **Author** a real, compilable example here. Each file exports `example(wf)` (or is a
   runnable guide script). A `// #region <key>` … `// #endregion` block marks the snippet
   shown in the docs; everything outside it (imports, the `example(wf)` wrapper, the
   client bootstrap) is harness and is never shipped.

   ```ts
   // examples/listOfferings.ts
   import type { Wefunder } from "../src/index.js";   // harness — not shown
   export async function example(wf: Wefunder) {
     // #region listOfferings
     const page = await wf.offerings.list({ sort: "most_raised" });
     for (const offering of page.data ?? []) console.log(offering.id);
     // #endregion
     return page;
   }
   ```

2. **Build** the manifest: `npm run build:examples` → `examples_manifest.json`.

3. **Gates** (CI):
   - **Compile** — `npm run typecheck:examples` (`tsc -p tsconfig.examples.json`). A renamed
     method or changed signature breaks every affected example *in this PR's checks*.
   - **Coverage** — `test/examples.coverage.test.ts`: every public operationId in
     `spec/openapi.yaml` has an example here OR is listed in `coverage-allowlist.json`
     (curl-only). When `sync-spec` pulls a new API operation, the missing example fails CI —
     that's how an API change propagates into the SDK as a visible to-do.
   - **Freshness** — same test: the committed `examples_manifest.json` matches the builder
     output, so a stale manifest can't be merged.
   - **Run** (where possible) — `test/e2e/examples.e2e.test.ts` executes the read:public
     examples against the live sandbox, catching *behavioral* drift (still compiles, no
     longer works). Only this repo can do this (it has sandbox creds).

4. **Docs consume** the manifest. The docs build fetches `examples_manifest.json` from each
   SDK repo *by version tag* and injects it as OpenAPI `x-codeSamples`, so the SDK call
   becomes the default sample on the JavaScript/Python/Ruby tab. cURL stays
   postman-generated as the universal fallback. The docs site owns all rendering; this repo
   owns the example content and its verification.

## Manifest schema (the contract)

```jsonc
{
  "manifestVersion": 1,
  "lang": "JavaScript",        // MUST equal the docs tab label (JavaScript | Python | Ruby)
  "label": "@wefunder/sdk",    // shown on the tab
  "sdkVersion": "0.1.0-beta.5",
  "apiVersion": "2025-01-15",  // the Wefunder-Version the SDK pins
  "samples": {                 // keyed by operationId — the join key across spec + all langs
    "listOfferings": "const page = await wf.offerings.list(...);\n…"
  }
}
```

## Key scheme

- **operationId** (`listOfferings`, `createWebhookSubscription`) — binds to that operation's
  docs page automatically.
- **`guides/<name>`** (`guides/client-credentials`) — an arbitrary snippet for a narrative
  guide page, referenced explicitly by that page. Same pipeline, same gates; the only
  difference is the docs page names the key instead of the operation auto-binding to it.

## Adding an example

1. Create `examples/<operationId>.ts` exporting `example(wf)`, with a `#region <operationId>`.
2. `npm run build:examples && npm run typecheck:examples && npm test`.
3. Remove the operationId from `coverage-allowlist.json` (the coverage gate enforces this).
4. If it's read:public-safe and self-contained, add it to `test/e2e/examples.e2e.test.ts`.

## Mirroring this in another language

Produce an `examples_manifest.json` with the same shape (`lang`/`label` differ; comment
markers are language-native — `# region`/`# endregion` for Python/Ruby). Wire the same three
gates in that repo's native toolchain (pyright+pytest, sorbet/rbs+rspec). Tag the manifest
at release. The docs build needs no changes beyond adding the new version to its version map.

## Framework-integration examples (not yet gated)

`oauth-pkce-server.ts` and `webhook-receiver.ts` are runnable Express illustrations. They
pull in `express`, which we deliberately keep out of the SDK's devDeps, so they're currently
**excluded from the compile gate** (`tsconfig.examples.json`) and the manifest (no `#region`).
TODO: when wiring the guide pages, either add `express`/`@types/express` as devDeps and
`#region`-key these, or relocate them to `examples/integrations/` with their own gate.
