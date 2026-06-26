// OAuth 2.0 helpers. The contract review (plan §4.1 #1, §4.2 #1/#3) established:
//  - BOTH authorization_code + PKCE (user flows) AND client_credentials (server, read:public)
//  - OAuth lives on a SEPARATE host (wefunder.com/oauth/*), not the API host
//  - refresh tokens ROTATE: every refresh returns a NEW refresh token that MUST be persisted
//
// These helpers are framework-agnostic and depend only on Web Crypto + fetch (Node 18+).

import { createHash, randomBytes } from "node:crypto";

export const DEFAULT_OAUTH_BASE_URL = "https://wefunder.com/oauth";

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

export interface AuthorizationUrlOptions {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  /** Opaque CSRF token you generate and verify on callback. */
  state: string;
  pkce: Pkce;
  oauthBaseUrl?: string;
}

/** Build the URL to redirect a user to for the authorization_code + PKCE flow. */
export function createAuthorizationUrl(opts: AuthorizationUrlOptions): string {
  const base = opts.oauthBaseUrl ?? DEFAULT_OAUTH_BASE_URL;
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

export interface ExchangeCodeOptions {
  clientId: string;
  /** Public (PKCE) clients omit this; confidential clients pass it. */
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  oauthBaseUrl?: string;
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
  return postToken(
    opts.oauthBaseUrl ?? DEFAULT_OAUTH_BASE_URL,
    params,
    opts.fetch ?? fetch,
    opts.now ?? Date.now,
  );
}

// ---- client_credentials (server-to-server, read:public) ----

export interface ClientCredentialsOptions {
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  oauthBaseUrl?: string;
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
  return postToken(
    opts.oauthBaseUrl ?? DEFAULT_OAUTH_BASE_URL,
    params,
    opts.fetch ?? fetch,
    opts.now ?? Date.now,
  );
}

// ---- refresh with ROTATION ----

export interface RefreshOptions {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  oauthBaseUrl?: string;
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
  return postToken(
    opts.oauthBaseUrl ?? DEFAULT_OAUTH_BASE_URL,
    params,
    opts.fetch ?? fetch,
    opts.now ?? Date.now,
  );
}
