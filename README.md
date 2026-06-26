# @wefunder/sdk (beta)

Official TypeScript SDK for the [Wefunder API](https://docs.wefunder.com/api-reference).

> **Beta.** Pinned to API version `2025-01-15`. The package is `0.x` — breaking
> changes are possible while we stabilize. Feedback welcome.

```bash
npm install @wefunder/sdk
```

Node 18+ (uses the global `fetch`). ESM and CommonJS both supported.

## Quickstart (server-to-server)

The fastest path: a `client_credentials` grant with a sandbox token, no user redirect.

```ts
import { Wefunder } from "@wefunder/sdk";

const wf = await Wefunder.fromClientCredentials({
  clientId: process.env.WEFUNDER_CLIENT_ID!,
  clientSecret: process.env.WEFUNDER_CLIENT_SECRET!,
  scopes: ["read:public"],
});

const me = await wf.users.me();
console.log(me.id);
```

## Authentication

The SDK supports both OAuth 2.0 grants the API offers.

### `client_credentials` (server-side)

`Wefunder.fromClientCredentials({ clientId, clientSecret, scopes })` — see above.

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

## Pagination

List endpoints auto-paginate. The cursor is opaque — you never construct it.

```ts
// Stream lazily (one page fetched at a time):
for await (const inv of wf.investments.all()) {
  console.log(inv.id);
}

// Or collect everything:
const all = await wf.investments.collect();

// Or drive pages yourself (gives you `meta`):
const page = await wf.investments.list();
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
available, pre-bound, under `wf.raw`:

```ts
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
