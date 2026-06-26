// OAuth 2.0 helpers. The contract review established:
//  - BOTH authorization_code + PKCE (user flows) AND client_credentials (server, read:public)
//  - refresh tokens ROTATE: every refresh returns a NEW refresh token that MUST be persisted
//
// HOST SPLIT (review #10): /authorize and /token are splitting by purpose.
//  - /authorize stays on wefunder.com (browser consent — needs the human session).
//  - /token (+ refresh) is moving to api.wefunder.com once the edge gateway ships;
//    sandbox (pk_test_) minting will then REQUIRE the API host (only the gateway can
//    route by credential prefix). Until that ships, both default to wefunder.com/oauth.
// The two hosts are independently overridable; flipping the token default later is a
// one-line change (see DEFAULT_TOKEN_BASE_URL).
//
// These helpers are framework-agnostic and depend only on Web Crypto + fetch (Node 18+).

import { createHash, randomBytes } from "node:crypto";

/** Host for the browser /authorize redirect. Stays on wefunder.com. */
export const DEFAULT_AUTHORIZE_BASE_URL = "https://wefunder.com/oauth";

// Host for /token (+ refresh). FLIP-POINT: change to "https://api.wefunder.com/oauth"
// when the edge gateway ships (required for sandbox token minting). Keep wefunder.com
// working as a transition alias — callers can override via `tokenBaseUrl`.
export const DEFAULT_TOKEN_BASE_URL = "https://wefunder.com/oauth";

/**
 * @deprecated Use `authorizeBaseUrl` / `tokenBaseUrl` instead. Kept as a convenience
 * alias that sets BOTH hosts at once. Equals the authorize default today.
 */
export const DEFAULT_OAUTH_BASE_URL = DEFAULT_AUTHORIZE_BASE_URL;

/** Hosts can be set together (`oauthBaseUrl`) or independently. Precedence: specific > alias > default. */
export interface OAuthHostOptions {
  /** Overrides BOTH hosts. Prefer the specific options below. */
  oauthBaseUrl?: string;
  /** Host for the /authorize redirect. */
  authorizeBaseUrl?: string;
  /** Host for /token + refresh. */
  tokenBaseUrl?: string;
}

function resolveAuthorizeBase(o: OAuthHostOptions): string {
  return o.authorizeBaseUrl ?? o.oauthBaseUrl ?? DEFAULT_AUTHORIZE_BASE_URL;
}

export function resolveTokenBase(o: OAuthHostOptions): string {
  return o.tokenBaseUrl ?? o.oauthBaseUrl ?? DEFAULT_TOKEN_BASE_URL;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds at which the access token expires (if the server told us). */
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

function toTokenSet(raw: RawTokenResponse, now: number): TokenSet {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: raw.expires_in ? now + raw.expires_in * 1000 : undefined,
    scope: raw.scope,
    tokenType: raw.token_type,
  };
}

async function postToken(
  oauthBaseUrl: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<TokenSet> {
  const res = await fetchImpl(`${oauthBaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`OAuth token request failed (${res.status}): ${detail}`);
  }
  return toTokenSet((await res.json()) as RawTokenResponse, now());
}

// ---- PKCE (authorization_code) ----

export interface Pkce {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a PKCE verifier/challenge pair (RFC 7636, S256). */
export function generatePkce(): Pkce {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

export interface AuthorizationUrlOptions extends OAuthHostOptions {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  /** Opaque CSRF token you generate and verify on callback. */
  state: string;
  pkce: Pkce;
}

/** Build the URL to redirect a user to for the authorization_code + PKCE flow. */
export function createAuthorizationUrl(opts: AuthorizationUrlOptions): string {
  const base = resolveAuthorizeBase(opts);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scopes.join(" "),
    state: opts.state,
    code_challenge: opts.pkce.codeChallenge,
    code_challenge_method: opts.pkce.codeChallengeMethod,
  });
  return `${base}/authorize?${q.toString()}`;
}

export interface ExchangeCodeOptions extends OAuthHostOptions {
  clientId: string;
  /** Public (PKCE) clients omit this; confidential clients pass it. */
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Exchange an authorization code (+ PKCE verifier) for a token set. */
export function exchangeCode(opts: ExchangeCodeOptions): Promise<TokenSet> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: opts.clientId,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  };
  if (opts.clientSecret) params.client_secret = opts.clientSecret;
  return postToken(resolveTokenBase(opts), params, opts.fetch ?? fetch, opts.now ?? Date.now);
}

// ---- client_credentials (server-to-server, read:public) ----

export interface ClientCredentialsOptions extends OAuthHostOptions {
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  fetch?: typeof fetch;
  now?: () => number;
}

export function clientCredentialsGrant(opts: ClientCredentialsOptions): Promise<TokenSet> {
  const params: Record<string, string> = {
    grant_type: "client_credentials",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  };
  if (opts.scopes?.length) params.scope = opts.scopes.join(" ");
  return postToken(resolveTokenBase(opts), params, opts.fetch ?? fetch, opts.now ?? Date.now);
}

// ---- refresh with ROTATION ----

export interface RefreshOptions extends OAuthHostOptions {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Refresh an access token. CRITICAL: the returned TokenSet carries a NEW refresh
 * token (rotation). The caller MUST persist it — reusing the old refresh token
 * after rotation results in a permanent 401. The client/TokenManager handles this.
 */
export function refreshToken(opts: RefreshOptions): Promise<TokenSet> {
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: opts.clientId,
    refresh_token: opts.refreshToken,
  };
  if (opts.clientSecret) params.client_secret = opts.clientSecret;
  return postToken(resolveTokenBase(opts), params, opts.fetch ?? fetch, opts.now ?? Date.now);
}
