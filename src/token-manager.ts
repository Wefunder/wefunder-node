// Holds the live token state and owns token recovery + persistence. Two recovery
// strategies, picked automatically:
//   - refresh_token (user flows): rotates — every refresh returns a NEW refresh
//     token, persisted BEFORE the next request can use it (the CRITICAL invariant).
//   - re-mint (client_credentials): cc tokens have NO refresh token, but a client
//     built via fromClientCredentials holds the grant inputs, so it can mint a fresh
//     token on expiry/401 instead of throwing. (Stress-test finding A.)
// Either way, concurrent callers share one in-flight promise so a burst of 401s
// fires a single recovery (no rotation race / thundering herd).

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
  /**
   * For client_credentials clients: mint a fresh token from the stored grant inputs.
   * When set (and there's no refresh token), this is the recovery strategy.
   */
  reMint?: () => Promise<TokenSet>;
  /** Called with the new TokenSet on every successful recovery (rotation or re-mint). */
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
  readonly #reMint?: () => Promise<TokenSet>;
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
    this.#reMint = opts.reMint;
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

  /** True if the manager can recover an expired token (rotate a refresh token or re-mint). */
  get canRefresh(): boolean {
    return Boolean((this.#tokens.refreshToken && this.#clientId) || this.#reMint);
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
   * Recover an expired/rejected token (e.g. after a 401): rotates the refresh token
   * if there is one, otherwise re-mints (client_credentials). Coalesces concurrent
   * calls into one network round-trip, then persists. Returns the new token set.
   */
  async refresh(): Promise<TokenSet> {
    if (this.#inflight) return this.#inflight;
    const strategy = this.#recoveryStrategy();
    if (!strategy) {
      throw new WefunderAuthError(
        "Access token expired and no refresh token / re-mint capability is configured.",
      );
    }
    this.#inflight = (async () => {
      const next = await strategy();
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

  // Pick the recovery strategy: refresh_token rotation, else cc re-mint, else none.
  #recoveryStrategy(): (() => Promise<TokenSet>) | undefined {
    const refreshTokenValue = this.#tokens.refreshToken;
    if (refreshTokenValue && this.#clientId) {
      const clientId = this.#clientId;
      return async () => {
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
        return next;
      };
    }
    return this.#reMint;
  }
}
