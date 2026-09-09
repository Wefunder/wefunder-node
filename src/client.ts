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
  Investment,
  Offering,
  Campaign,
  Syndicate,
  Intent,
  AttributionMe,
  PortfolioPosition,
  PortfolioSummaryEnvelope,
  ListOfferingsData,
  ListIntentsData,
  GetPortfolioData,
  ListPortfolioPositionsData,
  // --- partner SPV surface ---
  Spv,
  SpvStatus,
  SpvCreateInput,
  SpvCloseIntentEnvelope,
  SpvCancelIntentEnvelope,
  InviteLink,
  InviteLinkCreateInput,
  InviteLinkUpdateInput,
  BulkInviteLinkCreateInput,
  BulkInviteLinkEnvelope,
  InvestmentSession,
  InvestmentSessionCreateInput,
  PartnerInvestment,
  PartnerInvestor,
  IntentReview,
  ListPartnerSpvsData,
  ListPartnerInvestmentSessionsData,
} from "./generated/types.gen.js";

/** Documented `sort` values for the offerings list, from the generated op. */
export type OfferingSort = NonNullable<ListOfferingsData["query"]>["sort"];
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

/** Cursor + `per_page` shared by the partner list endpoints (spvs, invite links, investments, investors). */
export type PartnerPageQuery = NonNullable<ListPartnerSpvsData["query"]>;
/** Partner list filters, excluding the cursor managed by auto-pagination. */
export type PartnerPageFilters = Omit<PartnerPageQuery, "cursor">;
/** Filters + pagination for the investment-sessions list (adds `spv_id` / `status`). */
export type PartnerSessionListQuery = NonNullable<ListPartnerInvestmentSessionsData["query"]>;
/** Investment-sessions list filters, excluding the auto-managed cursor. */
export type PartnerSessionListFilters = Omit<PartnerSessionListQuery, "cursor">;
/** Documented `status` filter values for the investment-sessions list. */
export type PartnerSessionStatus = NonNullable<PartnerSessionListQuery["status"]>;
/**
 * Result of `close`/`cancel`: the SPV plus the server-minted approval intent
 * (its `review_url` is the advisor link). `intent` is absent only if the server
 * omitted it.
 */
export interface SpvIntentResult {
  spv: Spv;
  intent?: IntentReview;
}

/** Builds the optional `Idempotency-Key` header for creating partner resources. */
function idempotencyHeaders(opts?: { idempotencyKey?: string }): { "Idempotency-Key": string } | undefined {
  return opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : undefined;
}

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

  // Like #page, but for list endpoints nested under a resource id (e.g. an SPV's
  // invite links / investments / investors). Threads the id into the path.
  #idPage<T, Q extends { cursor?: Cursor } = { cursor?: Cursor }>(
    fn: (o: { client: Client; path: { id: string }; query?: Q }) => Result<Page<T>>,
  ) {
    return (id: string, query?: Q): Promise<Page<T>> =>
      this.#unwrap(fn({ client: this.#client, path: { id }, query }) as Result<Page<T>>);
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

  investments = {
    list: this.#page<Investment>(ops.listInvestments as never),
    all: (): AsyncGenerator<Investment> => paginate((cursor) => this.investments.list({ cursor })),
    collect: (): Promise<Investment[]> => collect((cursor) => this.investments.list({ cursor })),
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

  // ---- partner SPV surface (preview) ----
  // Spawn an SPV, invite investors, host their flow, drive the close. IDs are
  // prefixed strings: SPVs `ofr_`, invite links `il_`, sessions `is_`, investments `inv_`.
  partner = {
    spvs: {
      list: this.#page<Spv, PartnerPageQuery>(ops.listPartnerSpvs as never),
      all: (query?: PartnerPageFilters): AsyncGenerator<Spv> =>
        paginate((cursor) => this.partner.spvs.list({ ...query, cursor: cursor as number })),
      collect: (query?: PartnerPageFilters): Promise<Spv[]> =>
        collect((cursor) => this.partner.spvs.list({ ...query, cursor: cursor as number })),
      get: (id: string) =>
        this.#unwrapData<Spv>(ops.getPartnerSpv({ client: this.#client, path: { id } })),
      create: (spv: SpvCreateInput, opts?: { idempotencyKey?: string }) =>
        this.#unwrapData<Spv>(
          ops.createPartnerSpv({ client: this.#client, body: { spv }, headers: idempotencyHeaders(opts) }),
        ),
      open: (id: string) =>
        this.#unwrapData<Spv>(ops.openPartnerSpv({ client: this.#client, path: { id } })),
      // close/cancel mint an approval intent in meta; return the SPV + that intent.
      close: (id: string): Promise<SpvIntentResult> =>
        this.#unwrap<SpvCloseIntentEnvelope>(
          ops.closePartnerSpv({ client: this.#client, path: { id } }),
        ).then((env) => ({ spv: env.data as Spv, intent: env.meta?.disburse_intent })),
      cancel: (id: string, opts?: { reason?: string }): Promise<SpvIntentResult> =>
        this.#unwrap<SpvCancelIntentEnvelope>(
          ops.cancelPartnerSpv({
            client: this.#client,
            path: { id },
            body: opts?.reason ? { reason: opts.reason } : undefined,
          }),
        ).then((env) => ({ spv: env.data as Spv, intent: env.meta?.cancel_intent })),
      status: (id: string) =>
        this.#unwrapData<SpvStatus>(ops.getPartnerSpvStatus({ client: this.#client, path: { id } })),

      investments: {
        list: this.#idPage<PartnerInvestment, PartnerPageQuery>(ops.listPartnerSpvInvestments as never),
        all: (spvId: string, query?: PartnerPageFilters): AsyncGenerator<PartnerInvestment> =>
          paginate((cursor) =>
            this.partner.spvs.investments.list(spvId, { ...query, cursor: cursor as number }),
          ),
        collect: (spvId: string, query?: PartnerPageFilters): Promise<PartnerInvestment[]> =>
          collect((cursor) =>
            this.partner.spvs.investments.list(spvId, { ...query, cursor: cursor as number }),
          ),
      },

      investors: {
        list: this.#idPage<PartnerInvestor, PartnerPageQuery>(ops.listPartnerSpvInvestors as never),
        all: (spvId: string, query?: PartnerPageFilters): AsyncGenerator<PartnerInvestor> =>
          paginate((cursor) =>
            this.partner.spvs.investors.list(spvId, { ...query, cursor: cursor as number }),
          ),
        collect: (spvId: string, query?: PartnerPageFilters): Promise<PartnerInvestor[]> =>
          collect((cursor) =>
            this.partner.spvs.investors.list(spvId, { ...query, cursor: cursor as number }),
          ),
      },

      inviteLinks: {
        list: this.#idPage<InviteLink, PartnerPageQuery>(ops.listPartnerSpvInviteLinks as never),
        all: (spvId: string, query?: PartnerPageFilters): AsyncGenerator<InviteLink> =>
          paginate((cursor) =>
            this.partner.spvs.inviteLinks.list(spvId, { ...query, cursor: cursor as number }),
          ),
        collect: (spvId: string, query?: PartnerPageFilters): Promise<InviteLink[]> =>
          collect((cursor) =>
            this.partner.spvs.inviteLinks.list(spvId, { ...query, cursor: cursor as number }),
          ),
        get: (spvId: string, inviteLinkId: string) =>
          this.#unwrapData<InviteLink>(
            ops.getPartnerSpvInviteLink({
              client: this.#client,
              path: { id: spvId, invite_link_id: inviteLinkId },
            }),
          ),
        create: (spvId: string, input?: InviteLinkCreateInput, opts?: { idempotencyKey?: string }) =>
          this.#unwrapData<InviteLink>(
            ops.createPartnerSpvInviteLink({
              client: this.#client,
              path: { id: spvId },
              body: { invite_link: input ?? {} },
              headers: idempotencyHeaders(opts),
            }),
          ),
        update: (spvId: string, inviteLinkId: string, input: InviteLinkUpdateInput) =>
          this.#unwrapData<InviteLink>(
            ops.updatePartnerSpvInviteLink({
              client: this.#client,
              path: { id: spvId, invite_link_id: inviteLinkId },
              body: { invite_link: input },
            }),
          ),
        cancel: (spvId: string, inviteLinkId: string) =>
          this.#unwrapData<InviteLink>(
            ops.cancelPartnerSpvInviteLink({
              client: this.#client,
              path: { id: spvId, invite_link_id: inviteLinkId },
            }),
          ),
        resend: (spvId: string, inviteLinkId: string) =>
          this.#unwrapData<InviteLink>(
            ops.resendPartnerSpvInviteLink({
              client: this.#client,
              path: { id: spvId, invite_link_id: inviteLinkId },
            }),
          ),
        // 207 multi-status: created links in `data`, per-item failures in `errors`.
        bulkCreate: (spvId: string, input: BulkInviteLinkCreateInput): Promise<BulkInviteLinkEnvelope> =>
          this.#unwrap<BulkInviteLinkEnvelope>(
            ops.bulkCreatePartnerSpvInviteLinks({ client: this.#client, path: { id: spvId }, body: input }),
          ),
      },
    },

    investmentSessions: {
      list: this.#page<InvestmentSession, PartnerSessionListQuery>(
        ops.listPartnerInvestmentSessions as never,
      ),
      all: (query?: PartnerSessionListFilters): AsyncGenerator<InvestmentSession> =>
        paginate((cursor) =>
          this.partner.investmentSessions.list({ ...query, cursor: cursor as number }),
        ),
      collect: (query?: PartnerSessionListFilters): Promise<InvestmentSession[]> =>
        collect((cursor) =>
          this.partner.investmentSessions.list({ ...query, cursor: cursor as number }),
        ),
      get: (id: string) =>
        this.#unwrapData<InvestmentSession>(
          ops.getPartnerInvestmentSession({ client: this.#client, path: { id } }),
        ),
      create: (investmentSession: InvestmentSessionCreateInput, opts?: { idempotencyKey?: string }) =>
        this.#unwrapData<InvestmentSession>(
          ops.createPartnerInvestmentSession({
            client: this.#client,
            body: { investment_session: investmentSession },
            headers: idempotencyHeaders(opts),
          }),
        ),
      cancel: (id: string) =>
        this.#unwrapData<InvestmentSession>(
          ops.cancelPartnerInvestmentSession({ client: this.#client, path: { id } }),
        ),
    },
  };
}
