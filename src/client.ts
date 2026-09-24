// The Wefunder client — the stable, hand-written public surface over the generated
// layer. Wires: single API base (the edge proxy routes live/sandbox by token prefix,
// so we do NOT route by prefix — plan §4.2 #1), a pinned Wefunder-Version, the
// retry/refresh fetch wrapper, token rotation, typed-error unwrapping, and lazy
// auto-pagination. Resource namespaces cover the common GA paths; `raw` exposes
// every generated operation, pre-bound, as an escape hatch.

import { createClient, type Client } from "./generated/client/index.js";
import { createFetch, type RetryOptions } from "./http.js";
import { TokenManager, type TokenStore } from "./token-manager.js";
import { WefunderError, requestIdFrom } from "./errors.js";
import { clientCredentialsGrant, type TokenSet, type OAuthHostOptions } from "./oauth.js";
import { paginate, collect, type Cursor, type Page } from "./pagination.js";
import * as ops from "./generated/sdk.gen.js";
import type {
  User,
  InvestmentDeltaRecord,
  Offering,
  Campaign,
  Syndicate,
  Intent,
  AttributionMe,
  PortfolioPosition,
  PortfolioSummaryEnvelope,
  ListOfferingsData,
  ListIntentsData,
  ListInvestmentsData,
  GetPortfolioData,
  ListPortfolioPositionsData,
  WebhookEndpoint,
  WebhookEndpointListEnvelope,
  WebhookEndpointTestResultEnvelope,
  CreateWebhookEndpointData,
  UpdateWebhookEndpointData,
  DeleteWebhookEndpointResponses,
} from "./generated/types.gen.js";
import type { WebhookEventName } from "./webhooks.js";

/** Body for `wf.webhookEndpoints.create()`. */
export type CreateWebhookEndpointInput = CreateWebhookEndpointData["body"];
/** Body for `wf.webhookEndpoints.update()` — `events` replaces the list wholesale. */
export type UpdateWebhookEndpointInput = NonNullable<UpdateWebhookEndpointData["body"]>;
/** The list envelope, with `meta.quota` (max endpoints per app). */
export type WebhookEndpointList = WebhookEndpointListEnvelope;
/** Outcome of `wf.webhookEndpoints.test()`. */
export type WebhookTestOutcome = NonNullable<WebhookEndpointTestResultEnvelope["data"]>;
/** Outcome of `wf.webhookEndpoints.remove()`. */
export type WebhookEndpointRemoved = NonNullable<DeleteWebhookEndpointResponses[200]["data"]>;

/** Documented `sort` values for the offerings list, from the generated op. */
export type OfferingSort = NonNullable<ListOfferingsData["query"]>["sort"];
/**
 * An investment record as `GET /investments` and `GET /investments/{id}` return it
 * (the Investment Delta shape — a full record or, for company audiences, a tombstone
 * with `visible: false`).
 */
export type Investment = InvestmentDeltaRecord;
/** Filters + sync controls for `GET /investments` (`cursor` is managed by auto-pagination). */
export type InvestmentsQuery = NonNullable<ListInvestmentsData["query"]>;
export type InvestmentsFilters = Omit<InvestmentsQuery, "cursor">;
/** Documented `status` filter values for the intents list, from the generated op. */
export type IntentStatus = NonNullable<ListIntentsData["query"]>["status"];
/** Portfolio summary filters shared with the positions endpoint. */
export type PortfolioFilters = NonNullable<GetPortfolioData["query"]>;
/** Portfolio status values documented by the API. */
export type PortfolioStatus = NonNullable<PortfolioFilters["status"]>;
/** Filters and pagination controls for portfolio positions. */
export type PortfolioPositionsQuery = NonNullable<ListPortfolioPositionsData["query"]>;
/** Portfolio position filters, excluding the cursor managed by auto-pagination. */
export type PortfolioPositionsFilters = Omit<PortfolioPositionsQuery, "cursor">;
/** The summary resource inside the API's data envelope. */
export type PortfolioSummary = NonNullable<PortfolioSummaryEnvelope["data"]>;

// Version-free base — the edge gateway serves the API at the host root; `/api/v2`
// remains a working back-compat alias. The API version is pinned via the
// `Wefunder-Version` header (DEFAULT_API_VERSION), not the path.
export const DEFAULT_API_BASE_URL = "https://api.wefunder.com";
export const DEFAULT_API_VERSION = "2025-01-15";

export type Mode = "live" | "test" | "unknown";

export function modeForToken(token: string): Mode {
  if (token.startsWith("at_live_")) return "live";
  if (token.startsWith("at_test_")) return "test";
  return "unknown";
}

export interface WefunderOptions extends OAuthHostOptions {
  /** A bearer access token. Either this or `tokens` is required. */
  accessToken?: string;
  /** A full token set (access + rotating refresh). Enables auto-refresh. */
  tokens?: TokenSet;
  /** Needed (with the refresh token) to auto-refresh on expiry/401. */
  clientId?: string;
  clientSecret?: string;
  /**
   * Marks this as a client_credentials client so the SDK auto-re-mints on expiry/401
   * (cc tokens have no refresh token). `fromClientCredentials` sets this for you.
   */
  clientCredentials?: { scopes?: string[] };
  apiVersion?: string;
  /** Override the API base. The edge proxy routes mode by token prefix — leave default in prod. */
  baseUrl?: string;
  // OAuth hosts (oauthBaseUrl / authorizeBaseUrl / tokenBaseUrl) come from OAuthHostOptions.
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

    // For client_credentials clients, build a re-mint closure from the stored grant
    // inputs so the TokenManager can recover expired tokens (which have no refresh token).
    const reMint =
      opts.clientCredentials && opts.clientId && opts.clientSecret
        ? () =>
            clientCredentialsGrant({
              clientId: opts.clientId!,
              clientSecret: opts.clientSecret!,
              scopes: opts.clientCredentials!.scopes,
              oauthBaseUrl: opts.oauthBaseUrl,
              tokenBaseUrl: opts.tokenBaseUrl,
              fetch: opts.fetch,
              now: opts.now,
            })
        : undefined;

    this.#tokens = new TokenManager({
      tokens: tokenSet,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      reMint,
      oauthBaseUrl: opts.oauthBaseUrl,
      tokenBaseUrl: opts.tokenBaseUrl,
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
  static async fromClientCredentials(
    opts: OAuthHostOptions & {
      clientId: string;
      clientSecret: string;
      scopes?: string[];
      apiVersion?: string;
      baseUrl?: string;
      fetch?: typeof fetch;
      now?: () => number;
    },
  ): Promise<Wefunder> {
    const tokens = await clientCredentialsGrant({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      scopes: opts.scopes,
      oauthBaseUrl: opts.oauthBaseUrl,
      tokenBaseUrl: opts.tokenBaseUrl,
      fetch: opts.fetch,
      now: opts.now,
    });
    return new Wefunder({
      tokens,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      clientCredentials: { scopes: opts.scopes }, // enables auto-re-mint on expiry/401
      oauthBaseUrl: opts.oauthBaseUrl,
      tokenBaseUrl: opts.tokenBaseUrl,
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
      // X-Wf-Request-Id header is primary (present even on non-JSON edge errors).
      requestId: requestIdFrom(response, env.error?.request_id ?? env.request_id),
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

  /**
   * Unwrap any generated op result (incl. `wf.raw.*`) the way the ergonomic
   * namespaces do: returns the response body on success, throws a typed
   * `WefunderError` (with `request_id`) on failure. Lets `raw` callers keep the
   * SDK's error handling. (Stress-test finding C.)
   */
  unwrap<T>(p: Result<T>): Promise<T> {
    return this.#unwrap(p);
  }

  // Generic page helper: forwards the endpoint's full query (cursor + documented
  // params like `sort`), not just the cursor. (Stress-test finding B.)
  #page<T, Q extends { cursor?: Cursor } = { cursor?: Cursor }>(
    fn: (o: { client: Client; query?: Q }) => Result<Page<T>>,
  ) {
    return (query?: Q): Promise<Page<T>> =>
      this.#unwrap(fn({ client: this.#client, query }) as Result<Page<T>>);
  }

  // ---- resource namespaces (common GA paths) ----

  users = {
    me: () => this.#unwrapData<User>(ops.getCurrentUser({ client: this.#client })),
  };

  offerings = {
    list: this.#page<Offering, { cursor?: Cursor; sort?: OfferingSort }>(ops.listOfferings as never),
    all: (query?: { sort?: OfferingSort }): AsyncGenerator<Offering> =>
      paginate((cursor) => this.offerings.list({ ...query, cursor })),
    collect: (query?: { sort?: OfferingSort }): Promise<Offering[]> =>
      collect((cursor) => this.offerings.list({ ...query, cursor })),
    get: (externalId: string) =>
      this.#unwrapData<Offering>(
        ops.getOffering({ client: this.#client, path: { external_id: externalId } }),
      ),
  };

  /**
   * Investments (`read:investments`). `list` is a bootstrap listing; pass `updated_since`
   * or a saved `cursor` for sync mode (`meta.mode === "delta"`). Persist `meta.next_cursor`
   * from your last page — it is always present — and resume from it next time.
   */
  investments = {
    list: this.#page<Investment, InvestmentsQuery>(ops.listInvestments as never),
    all: (query?: InvestmentsFilters): AsyncGenerator<Investment> =>
      paginate((cursor) => this.investments.list({ ...query, cursor: cursor as string | undefined })),
    collect: (query?: InvestmentsFilters): Promise<Investment[]> =>
      collect((cursor) => this.investments.list({ ...query, cursor: cursor as string | undefined })),
    /** The current record (not the published projection) for one investment (`inv_…`). */
    get: (id: string) =>
      this.#unwrapData<Investment>(ops.getInvestment({ client: this.#client, path: { id } })),
  };

  portfolio = {
    get: (query?: PortfolioFilters) =>
      this.#unwrapData<PortfolioSummary>(ops.getPortfolio({ client: this.#client, query })),
    positions: {
      list: this.#page<PortfolioPosition, PortfolioPositionsQuery>(
        ops.listPortfolioPositions as never,
      ),
      all: (query?: PortfolioPositionsFilters): AsyncGenerator<PortfolioPosition> =>
        paginate((cursor) => this.portfolio.positions.list({ ...query, cursor: cursor as number })),
      collect: (query?: PortfolioPositionsFilters): Promise<PortfolioPosition[]> =>
        collect((cursor) => this.portfolio.positions.list({ ...query, cursor: cursor as number })),
    },
  };

  campaigns = {
    list: this.#page<Campaign>(ops.listCampaigns as never),
    all: (): AsyncGenerator<Campaign> => paginate((cursor) => this.campaigns.list({ cursor })),
    collect: (): Promise<Campaign[]> => collect((cursor) => this.campaigns.list({ cursor })),
  };

  syndicates = {
    list: this.#page<Syndicate, { cursor?: Cursor; limit?: number }>(ops.listSyndicates as never),
    all: (query?: { limit?: number }): AsyncGenerator<Syndicate> =>
      paginate((cursor) => this.syndicates.list({ ...query, cursor })),
    get: (id: number | string) =>
      this.#unwrapData<Syndicate>(ops.getSyndicate({ client: this.#client, path: { id } as never })),
  };

  intents = {
    list: this.#page<
      Intent,
      { cursor?: Cursor; status?: IntentStatus; resource_type?: string; resource_id?: number; limit?: number }
    >(ops.listIntents as never),
    all: (query?: {
      status?: IntentStatus;
      resource_type?: string;
      resource_id?: number;
      limit?: number;
    }): AsyncGenerator<Intent> => paginate((cursor) => this.intents.list({ ...query, cursor })),
    get: (id: number | string) =>
      this.#unwrapData<Intent>(ops.getIntent({ client: this.#client, path: { id } as never })),
  };

  attribution = {
    me: () => this.#unwrapData<AttributionMe>(ops.getAttributionMe({ client: this.#client })),
  };

  /**
   * Webhook endpoints (`/webhook_endpoints`, scopes `read:webhooks` / `write:webhooks`).
   * Endpoints belong to your application and are managed through the LIVE API —
   * create sandbox receivers there with `mode: "test"`; they're mirrored into
   * sandbox. The signing `secret` is returned ONLY by `create` and `rotateSecret`.
   * Verify deliveries with `constructEvent` (see the webhooks module).
   */
  webhookEndpoints = {
    /** All of your app's endpoints (secret omitted). `meta.quota` is the per-app limit. */
    list: (): Promise<WebhookEndpointList> =>
      this.#unwrap<WebhookEndpointList>(ops.listWebhookEndpoints({ client: this.#client })),
    get: (id: string) =>
      this.#unwrapData<WebhookEndpoint>(
        ops.getWebhookEndpoint({ client: this.#client, path: { external_id: id } }),
      ),
    /** Store `attributes.secret` from the result — it is never shown again. */
    create: (input: CreateWebhookEndpointInput) =>
      this.#unwrapData<WebhookEndpoint>(ops.createWebhookEndpoint({ client: this.#client, body: input })),
    /** `events` replaces the subscription list wholesale (no merge); omit to leave unchanged. */
    update: (id: string, input: UpdateWebhookEndpointInput) =>
      this.#unwrapData<WebhookEndpoint>(
        ops.updateWebhookEndpoint({ client: this.#client, path: { external_id: id }, body: input }),
      ),
    /** Stops deliveries immediately. Removal is permanent — create a new endpoint to resume. */
    remove: (id: string) =>
      this.#unwrapData<WebhookEndpointRemoved>(
        ops.deleteWebhookEndpoint({ client: this.#client, path: { external_id: id } }),
      ),
    /**
     * New secret (shown once). The old one keeps signing for a 24h overlap — deliveries
     * carry a `v1` for both, and `constructEvent` accepts either.
     */
    rotateSecret: (id: string) =>
      this.#unwrapData<WebhookEndpoint>(
        ops.rotateWebhookEndpointSecret({ client: this.#client, path: { external_id: id } }),
      ),
    /** Recover an auto-disabled endpoint after fixing your server. Idempotent. */
    reenable: (id: string) =>
      this.#unwrapData<WebhookEndpoint>(
        ops.reenableWebhookEndpoint({ client: this.#client, path: { external_id: id } }),
      ),
    /**
     * POST a real, signed example event at the endpoint (production envelope + signature)
     * and report the outcome inline. Defaults to the endpoint's first subscribed event.
     * Doesn't affect delivery health. Rate-limited to 10/min per endpoint.
     */
    test: (id: string, event?: WebhookEventName) =>
      this.#unwrapData<WebhookTestOutcome>(
        ops.testWebhookEndpoint({
          client: this.#client,
          path: { external_id: id },
          body: event ? { event } : undefined,
        }),
      ),
  };
}
