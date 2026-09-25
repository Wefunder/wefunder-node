// Runs the cross-language conformance vectors in ../conformance/*.json against this SDK.
// These vectors are the shared contract every Wefunder SDK (TS, Python, Ruby) must pass
// identically — see conformance/README.md. Do NOT "fix" a vector to match the shell; if
// a case fails, the shell (or the API contract) changed and the other SDKs must follow.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  constructEvent,
  checkWebhookSignature,
  parseSignatureHeader,
  signWebhook,
  verifyWebhook,
  WebhookSignatureError,
} from "../src/webhooks.js";
import { errorFromResponse, WefunderError } from "../src/errors.js";
import { paginate, type Cursor, type Page } from "../src/pagination.js";
import { createFetch, rateLimitWaitMs } from "../src/http.js";
import { TokenManager } from "../src/token-manager.js";
import {
  clientCredentialsGrant,
  createAuthorizationUrl,
  exchangeCode,
  generatePkce,
  refreshToken,
  DEFAULT_AUTHORIZE_BASE_URL,
  SANDBOX_AUTHORIZE_BASE_URL,
  DEFAULT_TOKEN_BASE_URL,
} from "../src/oauth.js";
import {
  Wefunder,
  modeForToken,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_VERSION,
  REQUEST_ID_HEADER,
} from "../src/index.js";
import { makeFetch, json, noSleep, type RecordedCall } from "./helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const load = (name: string): Any =>
  JSON.parse(
    readFileSync(new URL(`../conformance/${name}`, import.meta.url), "utf8"),
  );
const secs = (unix: number) => () => unix * 1000;
/** `expected` subset must match `actual`; `null` in expected means undefined-or-null. */
function expectSubset(actual: Any, expected: Any): void {
  for (const [k, v] of Object.entries(expected)) {
    if (v === null) expect(actual?.[k] ?? null, k).toBeNull();
    else if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      actual?.[k] &&
      typeof actual[k] === "object"
    )
      expectSubset(actual[k], v);
    else expect(actual?.[k], k).toEqual(v);
  }
}

// ----------------------------------------------------------------- webhooks
describe("conformance/webhooks.json", () => {
  const v = load("webhooks.json");
  it("constants", () => {
    expect(v.header_name.toLowerCase()).toBe("wefunder-signature");
  });
  for (const c of v.verify) {
    it(`verify: ${c.name}`, () => {
      const opts = { now: secs(c.now), toleranceSeconds: c.tolerance_seconds };
      let result: string;
      let event: Any;
      try {
        event = constructEvent(c.payload, c.headers, c.secret, opts);
        result = "ok";
      } catch (err) {
        expect(err).toBeInstanceOf(WebhookSignatureError);
        result = (err as WebhookSignatureError).reason;
      }
      expect(result).toBe(c.expect.result);
      if (c.expect.event) expectSubset(event, c.expect.event);
      // The header-only primitive must agree whenever a header is present.
      const header = Object.entries(c.headers as Record<string, string>).find(
        ([k]) => k.toLowerCase() === "wefunder-signature",
      )?.[1];
      if (header && c.expect.result !== "invalid_payload") {
        const failure = checkWebhookSignature({
          payload: c.payload,
          header,
          secret: c.secret,
          ...opts,
        });
        expect(failure ?? "ok").toBe(c.expect.result);
        expect(
          verifyWebhook({
            payload: c.payload,
            header,
            secret: c.secret,
            ...opts,
          }),
        ).toBe(c.expect.result === "ok");
      }
    });
  }
  for (const c of v.parse_header) {
    it(`parse_header: ${JSON.stringify(c.header)}`, () => {
      expect(parseSignatureHeader(c.header)).toEqual(c.expect);
    });
  }
  for (const c of v.sign) {
    it(`sign: ${c.name}`, () => {
      expect(
        signWebhook({
          payload: c.payload,
          secret: c.secret,
          timestamp: c.timestamp,
          additionalSecrets: c.additional_secrets,
        }),
      ).toBe(c.expect_header);
    });
  }
});

describe("conformance/legacy_webhooks.json", () => {
  const v = load("legacy_webhooks.json");
  for (const c of v.verify) {
    it(`verify: ${c.name}`, () => {
      const valid = verifyWebhook({
        payload: c.payload,
        signature: c.signature,
        timestamp: c.timestamp,
        secret: c.secret,
        toleranceSeconds: c.tolerance_seconds,
        ...(c.now !== undefined ? { now: secs(c.now) } : {}),
      });
      expect(valid).toBe(c.expect_valid);
    });
  }
  for (const c of v.construct) {
    it(`construct: ${c.name}`, () => {
      try {
        const evt = constructEvent(c.payload, c.headers, c.secret, {
          now: secs(c.now),
        });
        expect(c.expect.result).toBe("ok");
        expectSubset(evt, c.expect.event);
      } catch (err) {
        if (!(err instanceof WebhookSignatureError)) throw err;
        expect(err.reason).toBe(c.expect.result);
      }
    });
  }
});

// ------------------------------------------------------------------- errors
describe("conformance/errors.json", () => {
  const v = load("errors.json");
  it("constants", () => {
    expect(REQUEST_ID_HEADER).toBe(v.request_id_header.toLowerCase());
  });
  for (const c of v.cases) {
    it(c.name, async () => {
      const err = await errorFromResponse(
        new Response(c.body === "" ? null : c.body, {
          status: c.status,
          headers: c.headers,
        }),
      );
      expect(err).toBeInstanceOf(WefunderError);
      const { message, ...rest } = c.expect;
      expectSubset(
        {
          status: err.status,
          type: err.type,
          request_id: err.requestId,
          details: err.details,
          remediation: err.remediation,
        },
        rest,
      );
      if (message !== null && message !== undefined)
        expect(err.message).toBe(message);
      else expect(typeof err.message).toBe("string");
    });
  }
});

// --------------------------------------------------------------- pagination
describe("conformance/pagination.json", () => {
  const v = load("pagination.json");
  for (const c of v.cases) {
    it(c.name, async () => {
      const sent: (Cursor | null)[] = [];
      const fetchPage = async (cursor?: Cursor): Promise<Page<unknown>> => {
        sent.push(cursor ?? null);
        const hit = c.pages.find((p: Any) =>
          p.cursor === null ? cursor === undefined : p.cursor === cursor,
        );
        if (!hit)
          throw new Error(`unexpected cursor ${JSON.stringify(cursor)}`);
        return hit.response;
      };
      const items: unknown[] = [];
      for await (const item of paginate(fetchPage)) items.push(item);
      expect(items).toEqual(c.expect.items);
      expect(sent).toEqual(c.expect.cursors_sent);
    });
  }
});

// -------------------------------------------------------------------- retry
describe("conformance/retry.json", () => {
  const v = load("retry.json");
  for (const c of v.rate_limit_wait_ms.cases) {
    it(`rate_limit_wait_ms: ${c.note}`, () => {
      const r = new Response(null, {
        status: 429,
        headers: c.header === null ? {} : { "x-ratelimit-reset": c.header },
      });
      expect(rateLimitWaitMs(r, c.now_ms, c.max_delay_ms)).toBe(c.expect_ms);
    });
  }
  for (const c of v.cases) {
    it(c.name, async () => {
      const script: Any[] = [...c.responses];
      const bodies: string[] = [];
      const auths: (string | null)[] = [];
      let calls = 0;
      const base = (async (req: Request) => {
        calls++;
        auths.push(req.headers.get("authorization"));
        bodies.push(await req.text());
        const next = script.shift();
        if (!next) throw new Error("script exhausted");
        if (next.network_error) throw new Error("network_error");
        return new Response(next.body ?? null, {
          status: next.status,
          headers: next.headers ?? {},
        });
      }) as unknown as typeof fetch;
      const sleeps: number[] = [];
      let tokenManager: TokenManager | undefined;
      let oauth: ReturnType<typeof makeFetch> | undefined;
      if (c.token_manager) {
        oauth = makeFetch(() => json(c.token_manager.oauth_response));
        tokenManager = new TokenManager({
          tokens: {
            accessToken: c.token_manager.access_token,
            refreshToken: c.token_manager.refresh_token,
          },
          clientId: c.token_manager.client_id,
          fetch: oauth.fetch,
        });
      }
      const wrapped = createFetch({
        fetch: base,
        tokenManager,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => c.now_ms ?? 0,
        random: () => c.random ?? 0,
        retry: c.retry && {
          maxRetries: c.retry.max_retries,
          baseDelayMs: c.retry.base_delay_ms,
          maxDelayMs: c.retry.max_delay_ms,
        },
      });
      const headers: Record<string, string> = {};
      if (c.token_manager)
        headers.Authorization = `Bearer ${c.token_manager.access_token}`;
      const req = new Request("https://api.test/x", {
        method: c.method,
        headers,
        body: c.body,
      });
      let status: number | undefined;
      let threw: string | undefined;
      try {
        status = (await wrapped(req)).status;
      } catch (err) {
        threw = (err as Error).message;
      }
      if (c.expect.throws) expect(threw).toBe(c.expect.throws);
      else expect(status).toBe(c.expect.final_status);
      expect(calls).toBe(c.expect.calls);
      expect(sleeps).toEqual(c.expect.sleeps_ms);
      if (c.expect.bodies_seen) expect(bodies).toEqual(c.expect.bodies_seen);
      if (c.expect.authorization_seen)
        expect(auths).toEqual(c.expect.authorization_seen);
      if (c.expect.oauth_calls !== undefined)
        expect(oauth?.calls.length ?? 0).toBe(c.expect.oauth_calls);
    });
  }
});

// ----------------------------------------------------------- token recovery
describe("conformance/token_recovery.json", () => {
  const v = load("token_recovery.json");
  for (const c of v.token_set_conversion.cases) {
    it(`token_set_conversion: ${c.raw.access_token}`, async () => {
      const { fetch } = makeFetch(() => json(c.raw));
      const t = await clientCredentialsGrant({
        clientId: "c",
        clientSecret: "s",
        fetch,
        now: () => c.now_ms,
      });
      expectSubset(
        {
          access_token: t.accessToken,
          refresh_token: t.refreshToken,
          expires_at_ms: t.expiresAt,
          token_type: t.tokenType,
          scope: t.scope,
        },
        c.expect,
      );
    });
  }
  for (const s of v.scenarios) {
    it(s.name, async () => {
      const oauthResponses: Any[] = [...s.oauth_responses];
      const oauthParams: Record<string, string>[] = [];
      const apiBearers: (string | undefined)[] = [];
      const isOAuth = (c: RecordedCall) => c.url.includes("/oauth/token");
      const { fetch, calls } = makeFetch((c) => {
        if (isOAuth(c)) {
          oauthParams.push(Object.fromEntries(new URLSearchParams(c.body)));
          const next = oauthResponses.shift();
          if (!next) throw new Error("unexpected OAuth call");
          return json(next);
        }
        apiBearers.push(c.headers["authorization"]);
        if (
          s.api.reject_bearer &&
          c.headers["authorization"] === s.api.reject_bearer
        )
          return new Response("{}", { status: 401 });
        return new Response(s.api.accept_body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      const persisted: (string | undefined)[] = [];
      const now = s.now_ms !== undefined ? () => s.now_ms : undefined;
      let wf: Wefunder;
      let request: () => Promise<unknown>;
      if (s.client.client_credentials) {
        const cc = s.client.client_credentials;
        wf = await Wefunder.fromClientCredentials({
          clientId: cc.client_id,
          clientSecret: cc.client_secret,
          scopes: cc.scopes,
          fetch,
          now,
        });
        request = () => wf.offerings.list();
      } else {
        const t = s.client.tokens;
        wf = new Wefunder({
          tokens: {
            accessToken: t.access_token,
            refreshToken: t.refresh_token,
            expiresAt: t.expires_at_ms,
          },
          clientId: s.client.client_id,
          clientSecret: s.client.client_secret,
          store: {
            save: (ts) => {
              persisted.push(ts.refreshToken);
            },
          },
          fetch,
          sleep: noSleep,
          now,
        });
        request = () => wf.users.me();
      }
      let result = "ok";
      let errorStatus: number | undefined;
      try {
        await Promise.all(
          Array.from({ length: s.concurrent_requests }, () => request()),
        );
      } catch (err) {
        result = "error";
        errorStatus = (err as WefunderError).status;
      }
      const e = s.expect;
      expect(result).toBe(e.result);
      if (e.error_status !== undefined)
        expect(errorStatus).toBe(e.error_status);
      expect(calls.filter(isOAuth).length).toBe(e.oauth_calls);
      if (e.oauth_grant_types)
        expect(oauthParams.map((p) => p.grant_type)).toEqual(
          e.oauth_grant_types,
        );
      if (e.oauth_params)
        e.oauth_params.forEach((p: Any, i: number) =>
          expectSubset(oauthParams[i], p),
        );
      if (e.final_access_token)
        expect(wf.tokens.accessToken).toBe(e.final_access_token);
      if (e.final_refresh_token)
        expect(wf.tokens.refreshToken).toBe(e.final_refresh_token);
      if (e.persisted_refresh_tokens)
        expect(persisted).toEqual(e.persisted_refresh_tokens);
      if (e.last_api_bearer)
        expect(apiBearers[apiBearers.length - 1]).toBe(e.last_api_bearer);
      if (e.api_calls !== undefined)
        expect(apiBearers.length).toBe(e.api_calls);
    });
  }
});

// -------------------------------------------------------------------- oauth
describe("conformance/oauth.json", () => {
  const v = load("oauth.json");
  it("constants", () => {
    expect(DEFAULT_API_BASE_URL).toBe(v.constants.api_base_url);
    expect(DEFAULT_API_VERSION).toBe(v.constants.default_api_version);
    expect(DEFAULT_AUTHORIZE_BASE_URL).toBe(
      v.constants.authorize_base_url_live,
    );
    expect(SANDBOX_AUTHORIZE_BASE_URL).toBe(
      v.constants.authorize_base_url_sandbox,
    );
    expect(DEFAULT_TOKEN_BASE_URL).toBe(v.constants.token_base_url);
  });
  for (const c of v.mode_from_token)
    it(`mode_from_token: ${JSON.stringify(c.token)}`, () =>
      expect(modeForToken(c.token)).toBe(c.expect));
  it("pkce: RFC 7636 vector + generated pairs obey the relation", () => {
    const s256 = (verifier: string) =>
      createHash("sha256").update(verifier).digest("base64url");
    expect(s256(v.pkce.verifier)).toBe(v.pkce.challenge);
    const p = generatePkce();
    expect(p.codeChallengeMethod).toBe(v.pkce.method);
    expect(p.codeVerifier).toMatch(new RegExp(v.pkce.verifier_charset_regex));
    expect(s256(p.codeVerifier)).toBe(p.codeChallenge);
  });
  for (const c of v.authorize_url) {
    it(`authorize_url: ${c.name}`, () => {
      const url = new URL(
        createAuthorizationUrl({
          clientId: c.client_id,
          redirectUri: c.redirect_uri,
          scopes: c.scopes,
          state: c.state,
          pkce: {
            codeVerifier: "unused",
            codeChallenge: c.code_challenge,
            codeChallengeMethod: "S256",
          },
          authorizeBaseUrl: c.authorize_base_url,
          tokenBaseUrl: c.token_base_url,
          oauthBaseUrl: c.oauth_base_url,
        }),
      );
      expect(url.origin + url.pathname).toBe(c.expect.base);
      if (c.expect.params)
        for (const [k, val] of Object.entries(c.expect.params))
          expect(url.searchParams.get(k), k).toBe(val);
    });
  }
  for (const c of v.token_host) {
    it(`token_host: ${c.name}`, async () => {
      const { fetch, calls } = makeFetch(() =>
        json({ access_token: "at_test_x" }),
      );
      await clientCredentialsGrant({
        clientId: "c",
        clientSecret: "s",
        fetch,
        tokenBaseUrl: c.overrides.token_base_url,
        oauthBaseUrl: c.overrides.oauth_base_url,
        authorizeBaseUrl: c.overrides.authorize_base_url,
      });
      expect(calls[0]!.url).toBe(c.expect_url);
    });
  }
  for (const c of v.token_requests.cases) {
    it(`token_requests: ${c.name}`, async () => {
      const { fetch, calls } = makeFetch(() =>
        json({ access_token: "at_test_x" }),
      );
      if (c.grant === "client_credentials")
        await clientCredentialsGrant({
          clientId: c.client_id,
          clientSecret: c.client_secret,
          scopes: c.scopes,
          fetch,
        });
      else if (c.grant === "authorization_code")
        await exchangeCode({
          clientId: c.client_id,
          clientSecret: c.client_secret,
          code: c.code,
          redirectUri: c.redirect_uri,
          codeVerifier: c.code_verifier,
          fetch,
        });
      else
        await refreshToken({
          clientId: c.client_id,
          clientSecret: c.client_secret,
          refreshToken: c.refresh_token,
          fetch,
        });
      expect(calls[0]!.method).toBe("POST");
      expect(calls[0]!.headers["content-type"]).toMatch(
        /application\/x-www-form-urlencoded/,
      );
      const params = Object.fromEntries(new URLSearchParams(calls[0]!.body));
      expect(params).toEqual(c.expect.params);
      for (const k of c.expect.absent ?? [])
        expect(params).not.toHaveProperty(k);
    });
  }
  it("token_requests: non-2xx raises with the status in the message", async () => {
    const e = v.token_requests.error;
    const { fetch } = makeFetch(
      () => new Response(e.body, { status: e.status }),
    );
    await expect(
      refreshToken({ clientId: "c", refreshToken: "r", fetch }),
    ).rejects.toThrow(e.expect_message_includes);
  });
});

// ---------------------------------------------------------- manifest gate
describe("conformance/manifest.json", () => {
  it("matches the committed vector files (run `npm run build:conformance` after editing a vector)", async () => {
    const { buildManifest } =
      await import("../scripts/build-conformance-manifest.mjs");
    expect(load("manifest.json")).toEqual(buildManifest());
  });
});
