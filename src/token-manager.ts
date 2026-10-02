// Holds the live token state and owns token recovery + persistence. Two recovery
// strategies, picked automatically:
//   - refresh_token (user flows): rotates — every refresh returns a NEW refresh
//     token, persisted BEFORE the next request can use it (the CRITICAL invariant).
//   - re-mint (client_credentials): cc tokens have NO refresh token, but a client
//     built via fromClientCredentials holds the grant inputs, so it can mint a fresh
//     token on expiry/401 instead of throwing. (Stress-test finding A.)
// Either way, concurrent callers share one in-flight promise so a burst of 401s
// fires a single recovery (no rotation race / thundering herd).

import {
  refreshToken,
  resolveTokenBase,
  type TokenSet,
  type OAuthHostOptions,
} from "./oauth.js";
import { WefunderAuthError } from "./errors.js";

/**
 * The token store failed to save a rotated token set. `tokens` is the rotated set that is NOT
 * yet durable and NOT yet in use: the manager keeps it pending and retries the save on the next
 * call (or persist it yourself and call `markPersisted()`). Until it is saved no request uses it,
 * and the consumed refresh token is never reused either.
 */
export class WefunderTokenPersistenceError extends Error {
  readonly tokens: TokenSet;
  constructor(tokens: TokenSet, cause: unknown) {
    super(
      `Token store failed to save the rotated token set: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "WefunderTokenPersistenceError";
    this.tokens = tokens;
  }
}

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
  #pending: TokenSet | undefined;

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

  /** The durable, in-use token set. A rotated set that could not be persisted sits in `pendingTokens`. */
  get current(): TokenSet {
    return this.#tokens;
  }

  /** A rotated set awaiting a successful `store.save` (see `WefunderTokenPersistenceError`). */
  get pendingTokens(): TokenSet | undefined {
    return this.#pending;
  }

  /** Tell the manager you persisted `pendingTokens` yourself; publishes it. */
  async markPersisted(): Promise<TokenSet> {
    if (!this.#pending) return this.#tokens;
    this.#tokens = this.#pending;
    this.#pending = undefined;
    await this.#onTokenRefresh?.(this.#tokens);
    return this.#tokens;
  }

  /** True if the manager can recover an expired token (rotate a refresh token or re-mint). */
  get canRefresh(): boolean {
    return Boolean(
      (this.#tokens.refreshToken && this.#clientId) || this.#reMint,
    );
  }

  /**
   * Returns a valid access token, refreshing proactively if it's expired/near-expiry. If a
   * rotated set is pending persistence, the save is retried first — no request uses an
   * undurable token.
   */
  async getAccessToken(): Promise<string> {
    if (this.#pending) await this.refresh();
    const { expiresAt } = this.#tokens;
    if (
      expiresAt !== undefined &&
      this.#now() >= expiresAt - this.#leeway &&
      this.canRefresh
    ) {
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
    // A rotated set awaiting persistence: retry the save rather than rotating again (the old
    // refresh token was consumed by that rotation).
    if (this.#pending) {
      this.#inflight = this.#publishPending();
      try {
        return await this.#inflight;
      } finally {
        this.#inflight = undefined;
      }
    }
    const strategy = this.#recoveryStrategy();
    if (!strategy) {
      throw new WefunderAuthError(
        "Access token expired and no refresh token / re-mint capability is configured.",
      );
    }
    this.#inflight = (async () => {
      this.#pending = await strategy();
      return this.#publishPending();
    })();
    try {
      return await this.#inflight;
    } finally {
      this.#inflight = undefined;
    }
  }

  // Persist BEFORE publishing: no caller may use the rotated token until it is durable, and a
  // failed save must not leave the process working in memory but unable to reconnect after a
  // restart. On failure the set stays pending and WefunderTokenPersistenceError is thrown; the
  // next call retries the save.
  async #publishPending(): Promise<TokenSet> {
    const tokens = this.#pending!;
    try {
      await this.#store?.save(tokens);
    } catch (err) {
      throw new WefunderTokenPersistenceError(tokens, err);
    }
    this.#pending = undefined;
    this.#tokens = tokens;
    await this.#onTokenRefresh?.(tokens);
    return tokens;
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
