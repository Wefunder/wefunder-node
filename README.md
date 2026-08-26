# @wefunder/sdk

[![CI](https://github.com/Wefunder/wefunder-node/actions/workflows/ci.yml/badge.svg)](https://github.com/Wefunder/wefunder-node/actions/workflows/ci.yml)

The official TypeScript SDK for the [Wefunder API](https://docs.wefunder.com/api-reference).

The SDK is currently in beta. Releases may include breaking changes until the API reaches `1.0`.

## Install

```bash
npm install @wefunder/sdk@beta
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

If several application instances can use the same OAuth connection, serialize refreshes for that connection. This prevents two instances from trying to rotate the same refresh token at once.

## Calling the API

Common resources are available through typed namespaces:

```ts
const offering = await wf.offerings.get("ofr_example");
const currentUser = await wf.users.me();
const investments = await wf.investments.list();
```

### Portfolio

Portfolio endpoints require a user token with `read:investments`.

```ts
const portfolio = await wf.portfolio.get();
console.log(portfolio.attributes?.total_current_value_cents);

const positions = await wf.portfolio.positions.list({
  status: "active",
  per_page: 25,
});
```

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
  await wf.syndicates.get("syn_example");
} catch (error) {
  if (error instanceof WefunderError) {
    console.error(error.status, error.type, error.message, error.requestId);
  }
}
```

The SDK retries idempotent `GET` requests after transient network errors, `5xx` responses, and rate limits. Write requests are not retried automatically.

## Webhooks

Use `constructEvent` to verify a webhook signature and parse its payload. Signature verification requires the raw request body.

```ts
import { constructEvent } from "@wefunder/sdk";

app.post("/webhooks", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = constructEvent(
      req.body.toString("utf8"),
      req.headers,
      process.env.WEFUNDER_WEBHOOK_SECRET!,
    );

    queueWebhook(event);
    res.sendStatus(200);
  } catch {
    res.status(400).send("Invalid signature");
  }
});
```

## Generated operations

Typed namespaces cover the most common resources. Every operation in the public OpenAPI specification is also available under `wf.raw`.

```ts
const members = await wf.unwrap(
  wf.raw.listSyndicateMembers({
    path: { syndicate_id: "syn_example" },
  }),
);
```

Raw operations return `{ data, error, response }`. Passing the result to `wf.unwrap()` applies the same error handling used by the resource namespaces.

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

Releases are published by GitHub Actions. From a clean `main` branch:

```bash
npm version prerelease --preid beta
git push --follow-tags
```

The release workflow runs the package checks and publishes prereleases to npm's `beta` tag.
