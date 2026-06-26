// Holds the live token state and owns refresh-with-rotation + persistence.
// This is where the CRITICAL rotation invariant is enforced (plan §9): every
// refresh returns a new refresh token, which we persist BEFORE the next request
// can use it. Concurrent callers share a single in-flight refresh promise so a
// burst of 401s doesn't fire N refreshes (which would invalidate each other).

import { refreshToken, resolveTokenBase, type TokenSet, type OAuthHostOptions } from "./oauth.js";
import { WefunderAuthError } from "./errors.js";

/** Pluggable persistence for the rotating token set (DB row, secrets manager, etc.). */
export interface TokenStore {
  load?(): Promise<TokenSet | undefined> | TokenSet | undefined;
  save(tokens: TokenSet): Promise<void> | void;
}

export interface TokenManagerOptions extends OAuthHostOptions {
  tokens: TokenSet;
  clientId?: string;
  clientSecret?: string;
  /** Called with the new TokenSet on every successful rotation. */
  onTokenRefresh?: (tokens: TokenSet) => void | Promise<void>;
  store?: TokenStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Refresh proactively when the access token is within this many ms of expiry. */
  expiryLeewayMs?: number;
}

export class TokenManager {
  #tokens: TokenSet;
  readonly #clientId?: string;
  readonly #clientSecret?: string;
  readonly #tokenBaseUrl: string;
  readonly #onTokenRefresh?: (tokens: TokenSet) => void | Promise<void>;
  readonly #store?: TokenStore;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #leeway: number;
  #inflight: Promise<TokenSet> | undefined;

  constructor(opts: TokenManagerOptions) {
    this.#tokens = opts.tokens;
    this.#clientId = opts.clientId;
    this.#clientSecret = opts.clientSecret;
    this.#tokenBaseUrl = resolveTokenBase(opts);
    this.#onTokenRefresh = opts.onTokenRefresh;
    this.#store = opts.store;
    this.#fetch = opts.fetch ?? fetch;
    this.#now = opts.now ?? Date.now;
    this.#leeway = opts.expiryLeewayMs ?? 30_000;
  }

  get current(): TokenSet {
    return this.#tokens;
  }

  get canRefresh(): boolean {
    return Boolean(this.#tokens.refreshToken && this.#clientId);
  }

  /** Returns a valid access token, refreshing proactively if it's expired/near-expiry. */
  async getAccessToken(): Promise<string> {
    const { expiresAt } = this.#tokens;
    if (expiresAt !== undefined && this.#now() >= expiresAt - this.#leeway && this.canRefresh) {
      await this.refresh();
    }
    return this.#tokens.accessToken;
  }

  /**
   * Force a refresh (e.g. after a 401). Coalesces concurrent calls into one
   * network refresh so rotation isn't raced. Returns the new token set.
   */
  async refresh(): Promise<TokenSet> {
    if (this.#inflight) return this.#inflight;
    if (!this.#tokens.refreshToken || !this.#clientId) {
      throw new WefunderAuthError(
        "Access token expired and no refresh token / client_id is configured.",
      );
    }
    const refreshTokenValue = this.#tokens.refreshToken;
    const clientId = this.#clientId;
    this.#inflight = (async () => {
      const next = await refreshToken({
        clientId,
        clientSecret: this.#clientSecret,
        refreshToken: refreshTokenValue,
        tokenBaseUrl: this.#tokenBaseUrl,
        fetch: this.#fetch,
        now: this.#now,
      });
      // Some servers omit a fresh refresh_token on rotation-disabled flows;
      // keep the previous one rather than dropping our ability to refresh.
      if (!next.refreshToken) next.refreshToken = refreshTokenValue;
      this.#tokens = next;
      await this.#store?.save(next);
      await this.#onTokenRefresh?.(next);
      return next;
    })();
    try {
      return await this.#inflight;
    } finally {
      this.#inflight = undefined;
    }
  }
}
