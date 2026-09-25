# SDK conformance vectors

This directory is the **cross-language behavioural contract** for every official Wefunder SDK
(`wefunder-node`, `wefunder-python`, `wefunder-ruby`). The files are pure data — no code — and
every SDK's test suite loads them and must pass **every case identically**. They exist so three
hand-written shells can't drift apart on the behaviours that matter most: signature verification,
token rotation, pagination termination, retry policy, and error mapping.

`wefunder-node` is the reference implementation: its runner is `test/conformance.test.ts`, and
this directory is the canonical copy. Other SDKs vendor a copy pinned to a `wefunder-node` tag
(see "Consuming from another SDK").

## Rules

1. **Vectors are frozen.** Never edit a vector to make a shell pass. A failing case means the
   shell — or the API contract — changed; fix the shell, or change the contract deliberately
   (bump `conformance_version`, update every SDK).
2. **Independently sourced where possible.** The platform-events docs vector
   (`webhooks.json#docs_vector`) is published on docs.wefunder.com and asserted against the
   app's signing code in the wefunder repo's CI. The legacy KAT and the RFC 7636 PKCE vector
   are likewise external. Everything else was generated once and committed; the generator is
   intentionally _not_ in this repo.
3. **`manifest.json` is a freshness gate.** It carries a SHA-256 per file; the TS test suite
   fails if a vector changed without `npm run build:conformance`. Consumers use the same hashes
   to detect a stale vendored copy.

## Files

| File                   | Covers                                                                                 | Key invariants                                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhooks.json`        | Platform-events signature scheme (`Wefunder-Signature: t=…,v1=…`)                      | v1 = hex HMAC-SHA256(secret, `"<t>.<raw body>"`); any `v1` matching accepts (rotation); unknown keys ignored; check order missing → malformed → tolerance → HMAC → payload; default tolerance 300s; `mode` defaults to `live`; unknown event names still verify |
| `legacy_webhooks.json` | Retired attribution scheme (`X-Wefunder-Signature: sha256=…` + `X-Wefunder-Timestamp`) | Auto-detected only when the new header is absent; never throws from the boolean verifier                                                                                                                                                                        |
| `errors.json`          | Error envelope → typed error                                                           | `request_id`/`remediation` nest under `error`; `X-Wf-Request-Id` header beats body; non-JSON bodies still yield the header request id and type `api_error`                                                                                                      |
| `pagination.json`      | Opaque-cursor auto-pagination                                                          | Cursor sent back verbatim with its JSON type; stop on `has_more=false`, null/absent `next_cursor`, or a repeated cursor; the Investment Delta API always sends `next_cursor`                                                                                    |
| `retry.json`           | Transport retry policy                                                                 | 401 → recover once, any method; 429 → `X-RateLimit-Reset` (epoch seconds if > 1e9, else delta; absent → 1s; clamped); 5xx/network → idempotent methods only; backoff `min(base·2ⁿ·(1 + 0.5·random), max)`; retries re-send identical body bytes                 |
| `token_recovery.json`  | Refresh rotation and client_credentials re-mint through the client                     | Concurrent 401s coalesce into one recovery; rotated refresh token persisted before the retry; a refresh omitting `refresh_token` keeps the old one; proactive refresh inside the 30s leeway                                                                     |
| `oauth.json`           | Hosts, authorize URL, PKCE, token form bodies, mode detection                          | One API host for both modes; `/authorize` host chosen by `client_id` prefix (`pk_test_` → sandbox); specific override > `oauth_base_url` alias > default; absent form keys must not be sent                                                                     |

Each file starts with a `$schema_note` describing its case shape. Scalars are language-neutral:
timestamps are unix **seconds** unless the key ends in `_ms`; payloads are exact strings (the
bytes that were signed); `null` in an `expect` block means "absent or null".

## Writing a runner

- Compare `expect` blocks as **subsets**: every listed key must match; extra keys on the actual
  object are fine. Deep-compare `data` when it is present.
- Inject the clock (`now`), sleep, randomness, and the HTTP transport. No case needs the
  network or real time.
- For `retry.json`, drive the transport wrapper with a **body-bearing request object** if the
  language has one — the consumed-body bug that motivated those cases hides behind string
  bodies.
- For `token_recovery.json`, run the scenario through the **public client**, not the token
  manager alone: the coalescing and persist-before-retry invariants live in the wiring.
- Report each case as its own test named `<file>: <case name>` so a failure points at one
  vector.

## Consuming from another SDK

```
scripts/sync-conformance   # fetch conformance/*.json + manifest.json from Wefunder/wefunder-node at a pinned tag
```

Vendor the files under `conformance/` in your repo, record the pinned tag, and add a test that
recomputes the SHA-256s against the vendored `manifest.json`. Bump the pin when `wefunder-node`
releases; a new `conformance_version` means a deliberate contract change that needs a shell
change too.
