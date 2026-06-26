// The Wefunder client — the stable, hand-written public surface over the generated
// layer. Wires: single API base (the edge proxy routes live/sandbox by token prefix,
// so we do NOT route by prefix — plan §4.2 #1), a pinned Wefunder-Version, the
// retry/refresh fetch wrapper, token rotation, typed-error unwrapping, and lazy
// auto-pagination. Resource namespaces cover the common GA paths; `raw` exposes
// every generated operation, pre-bound, as an escape hatch.

import { createClient, type Client } from "@hey-api/client-fetch";
import { createFetch, type RetryOptions } from "./http.js";
import { TokenManager, type TokenStore } from "./token-manager.js";
import { WefunderError } from "./errors.js";
import { clientCredentialsGrant, type TokenSet } from "./oauth.js";
import { paginate, collect, type Cursor, type Page } from "./pagination.js";
import * as ops from "./generated/sdk.gen.js";
import type {
  User,
  Investment,
  Offering,
  Campaign,
  Syndicate,
  Intent,
  AttributionMe,
} from "./generated/types.gen.js";

export const DEFAULT_API_BASE_URL = "https://api.wefunder.com/api/v2";
export const DEFAULT_API_VERSION = "2025-01-15";

export type Mode = "live" | "test" | "unknown";

export function modeForToken(token: string): Mode {
  if (token.startsWith("at_live_")) return "live";
  if (token.startsWith("at_test_")) return "test";
  return "unknown";
}

export interface WefunderOptions {
  /** A bearer access token. Either this or `tokens` is required. */
  accessToken?: string;
  /** A full token set (access + rotating refresh). Enables auto-refresh. */
  tokens?: TokenSet;
  /** Needed (with the refresh token) to auto-refresh on expiry/401. */
  clientId?: string;
  clientSecret?: string;
  apiVersion?: string;
  /** Override the API base. The edge proxy routes mode by token prefix — leave default in prod. */
  baseUrl?: string;
  oauthBaseUrl?: string;
  store?: TokenStore;
  onTokenRefresh?: (tokens: TokenSet) => void | Promise<void>;
  retry?: RetryOptions;
  // --- injectables (testing) ---
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

type Result<T> = Promise<{ data?: T; error?: unknown; response?: Response }>;

/** Every generated operation, pre-bound to this client. */
type RawOps = {
  [K in keyof typeof ops]: (typeof ops)[K] extends (o: infer O) => infer R
    ? (options?: Omit<O & object, "client">) => R
    : never;
};

export class Wefunder {
  readonly mode: Mode;
  readonly raw: RawOps;
  #client: Client;
  #tokens: TokenManager;

  constructor(opts: WefunderOptions) {
    const tokenSet: TokenSet | undefined =
      opts.tokens ?? (opts.accessToken ? { accessToken: opts.accessToken } : undefined);
    if (!tokenSet) {
      throw new Error("Wefunder: provide `accessToken` or `tokens`.");
    }
    this.mode = modeForToken(tokenSet.accessToken);

    this.#tokens = new TokenManager({
      tokens: tokenSet,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      oauthBaseUrl: opts.oauthBaseUrl,
      onTokenRefresh: opts.onTokenRefresh,
      store: opts.store,
      fetch: opts.fetch,
      now: opts.now,
    });

    const wrappedFetch = createFetch({
      tokenManager: this.#tokens,
      fetch: opts.fetch,
      now: opts.now,
      sleep: opts.sleep,
      random: opts.random,
      retry: opts.retry,
    });

    this.#client = createClient({
      baseUrl: opts.baseUrl ?? DEFAULT_API_BASE_URL,
      headers: { "Wefunder-Version": opts.apiVersion ?? DEFAULT_API_VERSION },
      auth: () => this.#tokens.getAccessToken(),
      fetch: wrappedFetch,
    });

    this.raw = this.#buildRaw();
  }

  /** Server-to-server: exchange client credentials for a token, then build a client. */
  static async fromClientCredentials(opts: {
    clientId: string;
    clientSecret: string;
    scopes?: string[];
    oauthBaseUrl?: string;
    apiVersion?: string;
    baseUrl?: string;
    fetch?: typeof fetch;
    now?: () => number;
  }): Promise<Wefunder> {
    const tokens = await clientCredentialsGrant({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      scopes: opts.scopes,
      oauthBaseUrl: opts.oauthBaseUrl,
      fetch: opts.fetch,
      now: opts.now,
    });
    return new Wefunder({
      tokens,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      oauthBaseUrl: opts.oauthBaseUrl,
      apiVersion: opts.apiVersion,
      baseUrl: opts.baseUrl,
      fetch: opts.fetch,
      now: opts.now,
    });
  }

  /** The live token set (e.g. to persist after construction). */
  get tokens(): TokenSet {
    return this.#tokens.current;
  }

  // ---- unwrap: turn the {data,error,response} result into data-or-throw ----
  async #unwrap<T>(p: Result<T>): Promise<T> {
    const { data, error, response } = await p;
    if (response && response.ok && error === undefined) return data as T;
    const status = response?.status ?? 0;
    // The runtime error envelope nests request_id + remediation UNDER `error`
    // (api/v2/base_controller.rb#render_error), even though the spec's Error
    // schema models neither. Read them from there; fall back to top-level.
    const env = (error ?? {}) as {
      error?: { type?: string; message?: string; details?: unknown; request_id?: string; remediation?: string };
      request_id?: string;
    };
    throw new WefunderError({
      status,
      type: env.error?.type ?? "api_error",
      message: env.error?.message ?? response?.statusText ?? "Request failed",
      requestId: env.error?.request_id ?? env.request_id,
      details: env.error?.details,
      remediation: env.error?.remediation,
    });
  }

  // Single-resource ops return a `{ data: Entity }` envelope; strip it for ergonomics.
  async #unwrapData<T>(p: Result<unknown>): Promise<T> {
    const env = await this.#unwrap<{ data?: T }>(p as Result<{ data?: T }>);
    return env.data as T;
  }

  #buildRaw(): RawOps {
    const raw = {} as Record<string, unknown>;
    for (const [name, fn] of Object.entries(ops)) {
      raw[name] = (options?: Record<string, unknown>) =>
        (fn as (o: unknown) => unknown)({ ...options, client: this.#client });
    }
    return raw as RawOps;
  }

  // Generic helpers for the ergonomic namespaces.
  #page<T>(fn: (o: { client: Client; query?: { cursor?: Cursor } }) => Result<Page<T>>) {
    return (cursor?: Cursor) =>
      this.#unwrap(fn({ client: this.#client, query: { cursor } }) as Result<Page<T>>);
  }

  // ---- resource namespaces (common GA paths) ----

  users = {
    me: () => this.#unwrapData<User>(ops.getCurrentUser({ client: this.#client })),
  };

  offerings = {
    list: this.#page<Offering>(ops.listOfferings as never),
    all: (): AsyncGenerator<Offering> => paginate(this.offerings.list),
    collect: (): Promise<Offering[]> => collect(this.offerings.list),
    get: (externalId: string) =>
      this.#unwrapData<Offering>(
        ops.getOffering({ client: this.#client, path: { external_id: externalId } }),
      ),
  };

  investments = {
    list: this.#page<Investment>(ops.listInvestments as never),
    all: (): AsyncGenerator<Investment> => paginate(this.investments.list),
    collect: (): Promise<Investment[]> => collect(this.investments.list),
  };

  campaigns = {
    list: this.#page<Campaign>(ops.listCampaigns as never),
    all: (): AsyncGenerator<Campaign> => paginate(this.campaigns.list),
    collect: (): Promise<Campaign[]> => collect(this.campaigns.list),
  };

  syndicates = {
    list: this.#page<Syndicate>(ops.listSyndicates as never),
    all: (): AsyncGenerator<Syndicate> => paginate(this.syndicates.list),
    get: (id: number | string) =>
      this.#unwrapData<Syndicate>(ops.getSyndicate({ client: this.#client, path: { id } as never })),
  };

  intents = {
    list: this.#page<Intent>(ops.listIntents as never),
    all: (): AsyncGenerator<Intent> => paginate(this.intents.list),
    get: (id: number | string) =>
      this.#unwrapData<Intent>(ops.getIntent({ client: this.#client, path: { id } as never })),
  };

  attribution = {
    me: () => this.#unwrapData<AttributionMe>(ops.getAttributionMe({ client: this.#client })),
  };
}
