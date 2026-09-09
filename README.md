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
const offerings = await wf.offerings.list({ sort: "newest" });
const investments = await wf.investments.list();
const portfolio = await wf.portfolio.get();
```

The methods available to a client depend on its OAuth scopes. Consult the [API reference](https://docs.wefunder.com/api-reference) for the scope required by each endpoint.

The API base URL is `https://api.wefunder.com`. Paths are version-free; the SDK sends the API version in the `Wefunder-Version` request header.

## Partner SPV API

The `wf.partner` namespace drives the Partner SPV API: create a Special Purpose Vehicle, invite investors, host their investment flow, and drive the close. SPV, invite-link, session, and investment resources use prefixed string IDs (`ofr_`, `il_`, `is_`, `inv_`). This surface is in preview and requires partner OAuth scopes (`read:offerings` / `write:offerings`, `*:invite_links`, `*:investment_sessions`).

```ts
// Create a draft SPV, then open it to accept investments.
const spv = await wf.partner.spvs.create(
  {
    name: "Acme Ventures — Series A SPV",
    target_company: { name: "Acme Robotics", state_of_incorporation: "DE" },
    terms: {
      structure: "safe",
      safe_type: "post_money",
      valuation_cap_cents: 2_000_000_000,
      minimum_investment_cents: 100_000,
      target_raise_cents: 50_000_000,
    },
  },
  { idempotencyKey: "acme-series-a-spv" },
);
await wf.partner.spvs.open(spv.id!);

// Invite an investor and host their flow.
const invite = await wf.partner.spvs.inviteLinks.create(spv.id!, {
  email: "investor@example.com",
  send_email: true,
});
const session = await wf.partner.investmentSessions.create({
  spv_id: spv.id!,
  email: "investor@example.com",
});
console.log(invite.attributes?.url, session.attributes?.url);
```

SPV lists and the SPV-scoped invite-link, investment, and investor lists all support `list` / `all` / `collect` pagination:

```ts
for await (const investment of wf.partner.spvs.investments.all(spv.id!)) {
  console.log(investment.attributes?.amount_cents, investment.attributes?.status);
}
```

### Approval intents

`close` and `cancel` are gated by a server-minted intent that a Wefunder advisor must approve. Each returns the SPV together with that intent, whose `review_url` is the approval link — hand it to the approver; the action runs only once they approve.

```ts
const { spv: closing, intent } = await wf.partner.spvs.close(spv.id!);
console.log(closing.attributes?.status); // "closing"
console.log(intent?.review_url); // advisor approval link
```

### Bulk invites

`inviteLinks.bulkCreate` creates up to 100 per-person invites in one call. Because each item succeeds or fails independently, it returns the full multi-status envelope — created links in `data`, per-item failures in `errors`:

```ts
const res = await wf.partner.spvs.inviteLinks.bulkCreate(spv.id!, {
  invite_links: [{ email: "a@example.com" }, { email: "b@example.com" }],
});
console.log(`created ${res.meta?.created}, failed ${res.meta?.failed}`);
for (const err of res.errors ?? []) console.log(`item ${err.index}: ${err.detail}`);
```

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
