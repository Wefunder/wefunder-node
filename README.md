# @wefunder/sdk (beta)

[![CI](https://github.com/Wefunder/wefunder-node/actions/workflows/ci.yml/badge.svg)](https://github.com/Wefunder/wefunder-node/actions/workflows/ci.yml)

Official TypeScript SDK for the [Wefunder API](https://docs.wefunder.com/api-reference).

> **Beta.** The package is `0.x` — breaking changes are possible while we
> stabilize. Feedback welcome.

```bash
npm install @wefunder/sdk
```

Node 18+ (uses the global `fetch`). ESM and CommonJS both supported.

### Scope & versioning

- **Surface:** this release covers the **stable + beta** public API (offerings,
  investments, campaigns, syndicates, intents, attribution). Preview-only endpoints
  (the partner SPV / sandbox-simulation surface) are intentionally **not** included yet.
- **API version:** the SDK sends `Wefunder-Version: 2025-01-15` on every request,
  forward-compatible with Wefunder's dated-version model. **The API does not resolve
  this header yet**, so version pinning is not enforced server-side until that ships —
  the header is correct in shape and will start taking effect transparently.

## Quickstart (server-to-server)

The fastest path: a `client_credentials` grant with a sandbox token, no user redirect.

```ts
import { Wefunder } from "@wefunder/sdk";

const wf = await Wefunder.fromClientCredentials({
  clientId: process.env.WEFUNDER_CLIENT_ID!,
  clientSecret: process.env.WEFUNDER_CLIENT_SECRET!,
  scopes: ["read:public"],
});

// A client_credentials token can only hold `read:public` — it acts as your app,
// with no user. So it can browse public offerings, but NOT user-scoped data.
const page = await wf.offerings.list();
console.log(`${page.data?.length} offerings`);
```

> **`wf.users.me()` won't work with `client_credentials`.** `/users/me` requires
> `read:profile`, a user-context scope — calling it with a `client_credentials`
> token throws `WefunderError` (`403 insufficient_scope`). To read user data, use
> the `authorization_code` + PKCE flow below and request `read:profile`.

## Authentication

The SDK supports both OAuth 2.0 grants the API offers.

### `client_credentials` (server-side)

`Wefunder.fromClientCredentials({ clientId, clientSecret, scopes })` — see above.
These tokens are short-lived and have no refresh token, but the client keeps the
grant inputs and **auto-re-mints** on expiry or a `401` — so a long-lived server can
hold one `wf` and never hand-roll token recovery.

### `authorization_code` + PKCE (acting on behalf of a user)

```ts
import { generatePkce, createAuthorizationUrl, exchangeCode, Wefunder } from "@wefunder/sdk";

// 1. Before redirecting, generate PKCE + a state token and stash them in the session.
const pkce = generatePkce();
const url = createAuthorizationUrl({
  clientId, redirectUri, scopes: ["read:investments"], state, pkce,
});
// redirect the user to `url`

// 2. On the callback, exchange the code (+ verifier) for tokens.
const tokens = await exchangeCode({
  clientId, code, redirectUri, codeVerifier: pkce.codeVerifier,
});

// 3. Build a client. Pass clientId so it can auto-refresh on expiry.
const wf = new Wefunder({ tokens, clientId, onTokenRefresh: (t) => saveToDb(t) });
```

### Refresh tokens rotate — persist every refresh

Wefunder **rotates** refresh tokens: each refresh returns a *new* refresh token and
invalidates the old one. The SDK refreshes automatically (proactively before expiry,
and on a `401`), coalescing concurrent refreshes into one. You just have to persist
the rotated token so it survives a restart:

```ts
const wf = new Wefunder({
  tokens,
  clientId,
  store: {
    load: () => db.loadTokens(),
    save: (t) => db.saveTokens(t), // called on every rotation
  },
});
```

### Hosts (advanced)

OAuth uses two hosts, independently overridable:

- **authorize host** — the browser consent redirect (`createAuthorizationUrl`). Defaults to `https://wefunder.com/oauth`.
- **token host** — `/token` + refresh (`fromClientCredentials`, `exchangeCode`, refresh). Defaults to `https://wefunder.com/oauth` today; it will move to `https://api.wefunder.com/oauth` when Wefunder's edge gateway ships. Override via `tokenBaseUrl` (or set both at once with `oauthBaseUrl`).

The **API base** is `WefunderOptions.baseUrl` (default `https://api.wefunder.com/api/v2`). When Wefunder ships version-free URLs, the canonical base drops `/api/v2`; the current path stays as a back-compat alias, so no change is required on your side.

## Pagination

List endpoints auto-paginate. The cursor is opaque — you never construct it. List
methods take the endpoint's documented query params, and they're preserved across pages.

```ts
// Stream lazily (one page fetched at a time):
for await (const inv of wf.investments.all()) {
  console.log(inv.id);
}

// Query params are forwarded — e.g. sort the offerings browser (sort is preserved
// on every page):
for await (const offering of wf.offerings.all({ sort: "most_raised" })) {
  console.log(offering.id);
}

// Or collect everything:
const all = await wf.investments.collect();

// Or drive pages yourself (gives you `meta`):
const page = await wf.offerings.list({ sort: "newest" });
console.log(page.data, page.meta?.next_cursor);
```

## Errors

Failed requests throw `WefunderError` with the fields from the API's error envelope,
including the `request_id` (read from the response body) — quote it in support tickets.

```ts
import { WefunderError } from "@wefunder/sdk";

try {
  await wf.syndicates.get(123);
} catch (err) {
  if (err instanceof WefunderError) {
    console.error(err.status, err.type, err.message, err.requestId);
  }
}
```

Idempotent `GET`s are retried automatically on transient `5xx`/network errors and on
`429` (honoring `X-RateLimit-Reset`). Writes are never auto-retried.

## Webhooks

Verify and parse webhook deliveries. Pass the **raw** request body (not a re-serialized
object) and the headers:

```ts
import { constructEvent } from "@wefunder/sdk";

app.post("/webhooks", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = constructEvent(req.body.toString("utf8"), req.headers, process.env.WEBHOOK_SECRET!);
  } catch {
    return res.status(400).send("invalid signature");
  }
  // event.event, event.deliveryId, event.data
  res.sendStatus(200);
});
```

## Escape hatch: `wf.raw`

Ergonomic namespaces cover the common GA resources. Every generated operation is also
available, pre-bound, under `wf.raw`. Raw ops return the low-level `{ data, error,
response }` result; wrap them in `wf.unwrap(...)` to get the same typed-error +
envelope handling the namespaces use (a `WefunderError` with `request_id` on failure):

```ts
const members = await wf.unwrap(wf.raw.listSyndicateMembers({ path: { syndicate_id: 1 } }));

// Or handle the raw result yourself:
const res = await wf.raw.listSyndicateMembers({ path: { syndicate_id: 1 } });
```

## Development

```bash
npm install
npm run generate   # regenerate src/generated from spec/openapi.yaml
npm run typecheck
npm test           # hermetic unit tests (no network)
npm run test:e2e   # live sandbox E2E — needs WEFUNDER_CLIENT_ID/SECRET (or a .env); auto-skips otherwise
npm run build
```

The live E2E hits `api.wefunder.com` with a sandbox app's `client_credentials`. Put
the credentials in a gitignored `.env` (`WEFUNDER_CLIENT_ID=` / `WEFUNDER_CLIENT_SECRET=`).

The typed layer in `src/generated/` is produced by `@hey-api/openapi-ts` from
`spec/openapi.yaml` and is never hand-edited. The hand-written shell in `src/` wraps it.

### Syncing the spec (maintainers)

`spec/openapi.yaml` is a vendored copy of the **public tier** (stable + beta) of the
canonical Wefunder swagger. Preview/internal operations are excluded by design. To
refresh it from a local wefunder checkout:

```bash
WEFUNDER_REPO=/path/to/wefunder npm run sync-spec
npm run generate
git add spec src/generated   # commit both together
```

`sync-spec` delegates filtering to the wefunder repo's own `build-filtered-spec.js`,
so the public-tier definition can't drift between the two repos. CI's
`generated code matches spec` job verifies `src/generated` matches the committed spec;
it cannot reach the private canonical swagger, so run `sync-spec` before cutting a
release. (`npm test` stays hermetic.)
