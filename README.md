# @wefunder/sdk

[![CI](https://github.com/Wefunder/wefunder-node/actions/workflows/ci.yml/badge.svg)](https://github.com/Wefunder/wefunder-node/actions/workflows/ci.yml)

The official TypeScript SDK for the [Wefunder API](https://docs.wefunder.com/api-reference).

The SDK follows semantic versioning from `1.0.0`: breaking changes only in a new major version, announced in the changelog.

## Install

```bash
npm install @wefunder/sdk
```

Node 20 or newer is required. Both ESM and CommonJS are supported.

## Authentication

Wefunder supports two OAuth grants:

- Use `client_credentials` for server-to-server access to public data.
- Use `authorization_code` with PKCE when acting on behalf of a user.

### Server-to-server

Create a client with your application's client ID and secret:

```ts
import { Wefunder } from "@wefunder/sdk";

const wf = await Wefunder.fromClientCredentials({
  clientId: process.env.WEFUNDER_CLIENT_ID!,
  clientSecret: process.env.WEFUNDER_CLIENT_SECRET!,
  scopes: ["read:public"],
});

const page = await wf.offerings.list();
```

Client-credentials tokens represent the application, not a user. They cannot be used for user-scoped endpoints such as `wf.users.me()` or `wf.portfolio.get()`.

The SDK obtains a new token automatically when a client-credentials token expires.

### User authorization with PKCE

Generate the authorization URL on your server. Store the state and PKCE verifier in the user's session before redirecting them:

```ts
import { createAuthorizationUrl, generatePkce } from "@wefunder/sdk";
import { randomBytes } from "node:crypto";

const pkce = generatePkce();
const state = randomBytes(32).toString("base64url");

await saveOAuthAttempt({ state, codeVerifier: pkce.codeVerifier });

const authorizationUrl = createAuthorizationUrl({
  clientId,
  redirectUri,
  scopes: ["read:investments"],
  state,
  pkce,
});
```

On the callback, validate the state and exchange the authorization code:

```ts
import { exchangeCode, Wefunder } from "@wefunder/sdk";

const attempt = await consumeOAuthAttempt(state);
if (!attempt) throw new Error("Invalid OAuth state");

const tokens = await exchangeCode({
  clientId,
  clientSecret, // optional for public clients
  code,
  redirectUri,
  codeVerifier: attempt.codeVerifier,
});

const wf = new Wefunder({
  tokens,
  clientId,
  clientSecret,
  store: {
    save: (nextTokens) => saveTokens(nextTokens),
  },
});
```

Keep access tokens, refresh tokens, OAuth state, and PKCE verifiers on the server. Encrypt persisted tokens at rest.

### Refresh tokens

Refresh tokens rotate. When the SDK refreshes an access token, it calls `store.save()` with the new token set before continuing the request. Persist the entire token set each time.

Load the saved tokens yourself when constructing a client after a process restart:

```ts
const tokens = await loadTokens();

const wf = new Wefunder({
  tokens,
  clientId,
  clientSecret,
  store: { save: saveTokens },
});
```

The rotated set is saved before any request uses it. If `store.save` (or `onTokenRefresh`) throws, the SDK throws `WefunderTokenPersistenceError` and keeps the rotated set pending: no request is made with it, the consumed refresh token is never reused, and the next call retries the save. You can also persist `error.tokens` yourself and call `wf.markPersisted(error.tokens)`; `wf.pendingTokens` shows what is waiting. Alert on this error: a process that keeps failing to save cannot reconnect after a restart.

If several application instances can use the same OAuth connection, serialize refreshes for that connection. This prevents two instances from trying to rotate the same refresh token at once.

## API version

The SDK sends `Wefunder-Version: 2026-10-15` on every request (`DEFAULT_API_VERSION`). Pass
`apiVersion` to the constructor to pin an older one. 1.1.0 moved the default from the pre-launch
`2025-01-15` alias: `GET /activity` and the syndicate deal `close` / `finalize` operations (and the
`syndicates.close_deal` / `finalize_deal` intent actions) are not part of 2026-10-15, so they left
`wf.raw.*`; the legacy Attribution and attribution-webhook operations, removed from the API on
2026-10-14, left with them. Use `wf.referralCodes` instead of the attribution reads. See the
[migration guide](https://docs.wefunder.com/resources/versioning).

## Calling the API

Common resources are available through typed namespaces:

```ts
const offerings = await wf.offerings.list({ sort: "newest" });
const investments = await wf.investments.list({ company_id: "co_example" });
const portfolio = await wf.portfolio.get();
```

Namespaces: `users`, `offerings`, `investments`, `portfolio`, `campaigns`, `syndicates`, `intents`, `installations`, `memberLinks`, `referralCodes`, `joinSessions`, `investmentSessions`, and `webhookEndpoints`.

`wf.offerings.stats(id)` returns an offering's aggregate investment stats. `wf.installations` lets your app act as a company or syndicate: `eligibleTargets()`, `create()`, `mintToken()`, `list()`, `get()`, `revoke()`, and `installOrMintToken()`, which handles the API's 409 `already_installed` answer by minting a token for the existing install with the same scopes.

`wf.memberLinks` mints your app's per-person links to one deal page and reports what each member did (`list`, `all`, `create`, `get`, `cancel`; needs a company- or syndicate-owned token). `wf.referralCodes` (beta) creates codes with your server key and reads per-company stats (`list`, `all`, `get`, `create`, `update`, `stats`). `wf.joinSessions` (beta) mints hosted syndicate join sessions (`list`, `all`, `get`, `create`), and `wf.investmentSessions` (beta) puts a known investor straight into checkout for one offering (`list`, `all`, `listForOffering`, `allForOffering`, `get`, `create`, `cancel`).

`wf.investments` is the Investment Delta API. `list()` without a cursor bootstraps; pass `updated_since` or the `meta.next_cursor` you saved from your last page to receive only records that changed since then. `next_cursor` is always present, even on the final page, so persist it after every sync.

The methods available to a client depend on its OAuth scopes. Consult the [API reference](https://docs.wefunder.com/api-reference) for the scope required by each endpoint.

The API base URL is `https://api.wefunder.com`. Paths are version-free; the SDK sends the API version in the `Wefunder-Version` request header.

## Pagination

List namespaces provide three ways to work with paginated results:

```ts
// Fetch one page and inspect its cursor.
const page = await wf.offerings.list({ sort: "newest" });
console.log(page.data, page.meta?.next_cursor);

// Fetch pages lazily.
for await (const offering of wf.offerings.all({ sort: "most_raised" })) {
  console.log(offering.id);
}

// Fetch all results into an array.
const investments = await wf.investments.collect();
```

Cursors are opaque. Pass the value returned by the API without modifying it.

## Errors and retries

API failures throw `WefunderError`:

```ts
import { WefunderError } from "@wefunder/sdk";

try {
  await wf.syndicates.get("syn_aB3xQ9k2vF8mNp1zT5wY7Qc4");
} catch (error) {
  if (error instanceof WefunderError) {
    console.error(error.status, error.type, error.message, error.requestId);
  }
}
```

Retries are bounded (`retry.maxRetries`, default 2) and differ by failure: a `429` is retried for any method after waiting out `X-RateLimit-Reset`; transient network errors and `5xx` responses are retried only for idempotent methods (`GET`, `HEAD`, `OPTIONS`); a `401` is recovered once, for any method, by refreshing or re-minting the token and resending. Size request timeouts with the rate-limit wait in mind, since rate limiting alone can attempt a write up to three times, and the one-time 401 recovery can add one more. `error.remediation` carries the API's suggested fix when it sends one.

## Webhooks

Webhooks deliver platform events (`investment.executed`, `offering.opened`, `investment.changed`, …) to an HTTPS endpoint you register. Every delivery is signed; the SDK verifies the signature, parses the envelope, and gives you a typed event.

### 1. Register an endpoint

Endpoints belong to your application and are managed through the live API (scope `write:webhooks`, org owner/admin/developer role). The signing secret is returned only on create and rotate, so store it immediately.

```ts
const endpoint = await wf.webhookEndpoints.create({
  url: "https://yourapp.com/webhooks/wefunder", // public HTTPS; localhost and private IPs are rejected
  events: ["offering.opened", "investment.executed"],
  mode: "live", // "test" endpoints receive sandbox events
});

await saveSecret(endpoint.attributes!.secret!);
```

`wf.webhookEndpoints` also provides `list`, `get`, `update`, `remove`, `rotateSecret`, `reenable`, and `test`.

### 2. Verify and handle deliveries

Pass the raw request body, the request headers, and your secret to `constructEvent`. It throws `WebhookSignatureError` (with a `reason`) when a delivery is not authentic.

```ts
import {
  constructEvent,
  dispatchWebhook,
  WebhookSignatureError,
} from "@wefunder/sdk";

app.post(
  "/webhooks/wefunder",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    let event;
    try {
      event = constructEvent(
        req.body,
        req.headers,
        process.env.WEFUNDER_WEBHOOK_SECRET!,
      );
    } catch (err) {
      if (err instanceof WebhookSignatureError)
        return res.status(400).send(err.reason);
      throw err;
    }

    res.sendStatus(200); // acknowledge first, then do the work

    await dispatchWebhook(event, {
      "investment.executed": async (e) =>
        recordFunding(e.data.id, e.data.amounts.committed),
      "offering.opened": async (e) => announce(e.data.company.name),
      default: (e) => console.log("unhandled", e.event),
    });
  },
);
```

`event` is a discriminated union, so narrowing on `event.event` types `event.data` for you. For fetch-style servers (Next.js route handlers, Hono, Cloudflare Workers), use `constructEventFromRequest(request, secret)` instead.

Deliveries are at-least-once and unordered. Deduplicate on `event.id`, and where a payload carries `occurred_at`, keep the state from the latest one you have seen.

### 3. Test your handler

`wf.webhookEndpoints.test(endpoint.id)` sends a real, signed example event to your endpoint and reports the outcome inline. To unit-test your handler without the API, sign a fixture yourself:

```ts
import { signWebhook } from "@wefunder/sdk";

const body = JSON.stringify({ id: "evt_1", event: "offering.opened", created_at: "…", mode: "test", data: {…} });
const header = signWebhook({ payload: body, secret });
// POST `body` to your handler with `Wefunder-Signature: ${header}`
```

### Secret rotation

`wf.webhookEndpoints.rotateSecret(id)` returns a new secret; the old one keeps signing for 24 hours, and deliveries carry a `v1` for each. `constructEvent` accepts either, so you can roll the new secret out to your servers without dropping an event.

### Signature scheme

Each delivery carries `Wefunder-Signature: t=<unix seconds>,v1=<hex>` where `v1` is `HMAC-SHA256(secret, "<t>.<raw body>")`. Requests whose `t` is more than five minutes from now are rejected (`toleranceSeconds` adjusts this). `verifyWebhook` and `checkWebhookSignature` expose the check without parsing, and `constructEvent` still accepts the retired attribution-webhook headers (`X-Wefunder-Signature`/`X-Wefunder-Timestamp`).

## Generated operations

Typed namespaces cover the most common resources. Every operation in the public OpenAPI specification is also available under `wf.raw`.

```ts
const members = await wf.unwrap(
  wf.raw.listSyndicateMembers({
    path: { syndicate_id: "syn_aB3xQ9k2vF8mNp1zT5wY7Qc4" },
  }),
);
```

Raw operations return `{ data, error, response }`. Passing the result to `wf.unwrap()` applies the same error handling used by the resource namespaces.

## Escape hatch: `wf.request` (any path)

For endpoints outside the generated surface entirely — preview-tier operations
(e.g. partner SPVs) or operations newer than your installed SDK version —
`wf.request()` calls any API path with the SDK's full envelope: bearer auth
(including refresh / client_credentials re-mint on 401), the pinned
`Wefunder-Version` header, the retry policy, and a typed `WefunderError` on
failure. It is untyped by design; preview endpoints can change at any time.

```ts
// GET with query params (invite links are preview today)
const links = await wf.request("GET", `/offerings/${offeringId}/invite_links`, { query: { per_page: 10 } });

// POST with a JSON body and an idempotency key
const link = await wf.request("POST", `/offerings/${offeringId}/invite_links`, {
  body: { invite_link: { email: "alex@example.com", allocation_cents: 500_000 } },
  headers: { "Idempotency-Key": "invite-alex-1" },
});
```

The returned body is passed through as-is (no `{ data }` unwrapping — envelope
shapes vary across unshipped endpoints). When an operation graduates to the
generated surface, switch to `wf.raw.<opId>` (typed) or its namespace method.

## Development

```bash
npm install
npm run typecheck
npm run typecheck:examples
npm test
npm run build
```

`npm run test:e2e` runs against the sandbox when `WEFUNDER_CLIENT_ID` and `WEFUNDER_CLIENT_SECRET` are set.

Generated files in `src/generated/` come from `spec/openapi.yaml` and should not be edited by hand.

### Conformance vectors

`conformance/*.json` is the cross-language behavioural contract shared with the Python and Ruby
SDKs (signatures, token rotation, pagination, retries, errors). `test/conformance.test.ts` runs
every case; the vectors are frozen — fix the shell, not the vector. After deliberately changing
one, run `npm run build:conformance` to refresh `conformance/manifest.json`. See
[`conformance/README.md`](conformance/README.md).

### Updating the API specification

Run the sync command against a local checkout of the Wefunder application, then regenerate the client:

```bash
npm run sync-spec -- /path/to/wefunder
npm run generate
npm run typecheck
npm test
```

Commit the specification and generated client together.

### Releasing

Releases are published by GitHub Actions when a `v*` tag is pushed. From a clean `main` branch:

```bash
npm version minor                 # or patch / major; bumps package.json, rebuilds the examples manifest, commits, and tags
git push --follow-tags            # npm's tag is annotated, so --follow-tags pushes it
```

A stable version publishes to npm's `latest` tag. For a prerelease, `npm version prerelease --preid beta` instead; it publishes to the `beta` tag and `latest` stays put. The release workflow refuses a tag that does not match `package.json`.
