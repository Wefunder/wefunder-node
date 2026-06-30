import { describe, it, expect } from "vitest";
import {
  generatePkce,
  createAuthorizationUrl,
  exchangeCode,
  clientCredentialsGrant,
  refreshToken,
  DEFAULT_OAUTH_BASE_URL,
  DEFAULT_AUTHORIZE_BASE_URL,
  SANDBOX_AUTHORIZE_BASE_URL,
  DEFAULT_TOKEN_BASE_URL,
} from "../src/oauth.js";
import { makeFetch, json } from "./helpers.js";

describe("PKCE", () => {
  it("generates an S256 verifier/challenge pair", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.codeChallengeMethod).toBe("S256");
    expect(a.codeVerifier).not.toEqual(b.codeVerifier); // random per call
    expect(a.codeChallenge).not.toEqual(a.codeVerifier); // challenge is hashed
    expect(a.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
  });

  it("builds an authorization URL on the OAuth host with the challenge", () => {
    const pkce = generatePkce();
    const url = new URL(
      createAuthorizationUrl({
        clientId: "cid",
        redirectUri: "https://app.example/cb",
        scopes: ["read:public", "read:investments"],
        state: "xyz",
        pkce,
      }),
    );
    expect(url.origin + url.pathname).toBe(`${DEFAULT_OAUTH_BASE_URL}/authorize`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read:public read:investments");
    expect(url.searchParams.get("code_challenge")).toBe(pkce.codeChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("xyz");
  });
});

describe("token grants hit the OAuth host with correct params", () => {
  it("client_credentials posts grant_type + scope", async () => {
    const { fetch, calls } = makeFetch(() => json({ access_token: "at_live_x", expires_in: 3600, token_type: "Bearer" }));
    const tokens = await clientCredentialsGrant({
      clientId: "cid",
      clientSecret: "secret",
      scopes: ["read:public"],
      fetch,
      now: () => 1000,
    });
    expect(calls[0]!.url).toBe(`${DEFAULT_TOKEN_BASE_URL}/token`);
    const params = new URLSearchParams(calls[0]!.body);
    expect(params.get("grant_type")).toBe("client_credentials");
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("client_secret")).toBe("secret");
    expect(params.get("scope")).toBe("read:public");
    expect(tokens.accessToken).toBe("at_live_x");
    expect(tokens.expiresAt).toBe(1000 + 3600 * 1000);
  });

  it("authorization_code exchange posts code + verifier (no secret for public clients)", async () => {
    const { fetch, calls } = makeFetch(() => json({ access_token: "at_test_x", refresh_token: "r1" }));
    await exchangeCode({
      clientId: "cid",
      code: "authcode",
      redirectUri: "https://app.example/cb",
      codeVerifier: "verifier123",
      fetch,
    });
    const params = new URLSearchParams(calls[0]!.body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("authcode");
    expect(params.get("code_verifier")).toBe("verifier123");
    expect(params.has("client_secret")).toBe(false);
  });

  it("refresh posts grant_type=refresh_token and surfaces the rotated token", async () => {
    const { fetch, calls } = makeFetch(() => json({ access_token: "at_live_NEW", refresh_token: "r2" }));
    const tokens = await refreshToken({ clientId: "cid", refreshToken: "r1", fetch });
    const params = new URLSearchParams(calls[0]!.body);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("r1");
    expect(tokens.refreshToken).toBe("r2"); // rotation surfaced to caller
  });

  it("throws a descriptive error on a non-200 token response", async () => {
    const { fetch } = makeFetch(() => json({ error: "invalid_grant" }, { status: 400 }));
    await expect(refreshToken({ clientId: "cid", refreshToken: "bad", fetch })).rejects.toThrow(/400/);
  });
});

describe("OAuth host split (#10): authorize host vs token host", () => {
  const tok = () => json({ access_token: "at_test_x" });

  it("defaults: live authorize on wefunder.com, token on api.wefunder.com (gateway)", async () => {
    expect(DEFAULT_AUTHORIZE_BASE_URL).toBe("https://wefunder.com/oauth");
    expect(SANDBOX_AUTHORIZE_BASE_URL).toBe("https://oauth.wefunder-sandbox.com/oauth");
    expect(DEFAULT_TOKEN_BASE_URL).toBe("https://api.wefunder.com/oauth");

    // A non-pk_test_ client_id authorizes on the live host.
    const url = createAuthorizationUrl({
      clientId: "pk_live_c", redirectUri: "https://a/cb", scopes: ["read:public"], state: "s", pkce: generatePkce(),
    });
    expect(url.startsWith(`${DEFAULT_AUTHORIZE_BASE_URL}/authorize`)).toBe(true);

    const cc = makeFetch(tok);
    await clientCredentialsGrant({ clientId: "c", clientSecret: "s", fetch: cc.fetch });
    expect(cc.calls[0]!.url).toBe(`${DEFAULT_TOKEN_BASE_URL}/token`);
  });

  it("authorize host is picked by client_id mode: pk_test_ → sandbox, else live", () => {
    const args = { redirectUri: "https://a/cb", scopes: ["read:public"], state: "s", pkce: generatePkce() };
    const sandbox = createAuthorizationUrl({ clientId: "pk_test_abc", ...args });
    const live = createAuthorizationUrl({ clientId: "pk_live_abc", ...args });
    expect(sandbox.startsWith(`${SANDBOX_AUTHORIZE_BASE_URL}/authorize`)).toBe(true);
    expect(live.startsWith(`${DEFAULT_AUTHORIZE_BASE_URL}/authorize`)).toBe(true);
  });

  it("explicit authorizeBaseUrl overrides the pk_test_ sandbox default", () => {
    const url = createAuthorizationUrl({
      clientId: "pk_test_abc", redirectUri: "https://a/cb", scopes: ["x"], state: "s", pkce: generatePkce(),
      authorizeBaseUrl: "https://login.example/oauth",
    });
    expect(url.startsWith("https://login.example/oauth/authorize")).toBe(true);
  });

  it("tokenBaseUrl overrides ONLY the token host (authorize unaffected)", async () => {
    const cc = makeFetch(tok);
    await clientCredentialsGrant({
      clientId: "c", clientSecret: "s", tokenBaseUrl: "https://api.wefunder.com/oauth", fetch: cc.fetch,
    });
    expect(cc.calls[0]!.url).toBe("https://api.wefunder.com/oauth/token");

    // authorize URL still uses the authorize default
    const url = createAuthorizationUrl({
      clientId: "c", redirectUri: "https://a/cb", scopes: ["x"], state: "s", pkce: generatePkce(),
      tokenBaseUrl: "https://api.wefunder.com/oauth",
    });
    expect(url.startsWith(`${DEFAULT_AUTHORIZE_BASE_URL}/authorize`)).toBe(true);
  });

  it("authorizeBaseUrl overrides ONLY the authorize host", () => {
    const url = createAuthorizationUrl({
      clientId: "c", redirectUri: "https://a/cb", scopes: ["x"], state: "s", pkce: generatePkce(),
      authorizeBaseUrl: "https://login.example/oauth",
    });
    expect(url.startsWith("https://login.example/oauth/authorize")).toBe(true);
  });

  it("oauthBaseUrl alias sets BOTH hosts", async () => {
    const cc = makeFetch(tok);
    await clientCredentialsGrant({
      clientId: "c", clientSecret: "s", oauthBaseUrl: "https://both.example/oauth", fetch: cc.fetch,
    });
    expect(cc.calls[0]!.url).toBe("https://both.example/oauth/token");
    const url = createAuthorizationUrl({
      clientId: "c", redirectUri: "https://a/cb", scopes: ["x"], state: "s", pkce: generatePkce(),
      oauthBaseUrl: "https://both.example/oauth",
    });
    expect(url.startsWith("https://both.example/oauth/authorize")).toBe(true);
  });

  it("precedence: specific tokenBaseUrl beats the oauthBaseUrl alias", async () => {
    const cc = makeFetch(tok);
    await refreshToken({
      clientId: "c", refreshToken: "r",
      oauthBaseUrl: "https://alias.example/oauth",
      tokenBaseUrl: "https://specific.example/oauth",
      fetch: cc.fetch,
    });
    expect(cc.calls[0]!.url).toBe("https://specific.example/oauth/token");
  });

  it("DEFAULT_OAUTH_BASE_URL stays a back-compat alias of the authorize default", () => {
    expect(DEFAULT_OAUTH_BASE_URL).toBe(DEFAULT_AUTHORIZE_BASE_URL);
  });
});
