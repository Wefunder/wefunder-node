// Public API surface for @wefunder/sdk.

export {
  Wefunder,
  modeForToken,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_VERSION,
  type WefunderOptions,
  type Mode,
  type OfferingSort,
  type Investment,
  type InvestmentsQuery,
  type InvestmentsFilters,
  type IntentStatus,
  type PortfolioFilters,
  type PortfolioStatus,
  type PortfolioPositionsQuery,
  type PortfolioPositionsFilters,
  type PortfolioSummary,
  type CreateWebhookEndpointInput,
  type UpdateWebhookEndpointInput,
  type WebhookEndpointList,
  type WebhookTestOutcome,
  type WebhookEndpointRemoved,
} from "./client.js";

export { WefunderError, WefunderAuthError, REQUEST_ID_HEADER } from "./errors.js";

export {
  // PKCE + authorization_code
  generatePkce,
  createAuthorizationUrl,
  exchangeCode,
  // client_credentials
  clientCredentialsGrant,
  // refresh (rotation)
  refreshToken,
  // host config (authorize host vs token host split)
  DEFAULT_AUTHORIZE_BASE_URL,
  SANDBOX_AUTHORIZE_BASE_URL,
  DEFAULT_TOKEN_BASE_URL,
  DEFAULT_OAUTH_BASE_URL,
  type OAuthHostOptions,
  type TokenSet,
  type Pkce,
  type AuthorizationUrlOptions,
  type ExchangeCodeOptions,
  type ClientCredentialsOptions,
  type RefreshOptions,
} from "./oauth.js";

export { type TokenStore, type TokenManagerOptions } from "./token-manager.js";

export { paginate, collect, type Cursor, type Page, type PageFetcher } from "./pagination.js";

export {
  verifyWebhook,
  constructEvent,
  constructEventFromRequest,
  checkWebhookSignature,
  parseSignatureHeader,
  // sign (for your own tests)
  signWebhook,
  computeWebhookSignature,
  // route
  dispatchWebhook,
  WebhookSignatureError,
  SIGNATURE_HEADER,
  DEFAULT_TOLERANCE_SECONDS,
  LEGACY_SIGNATURE_HEADER,
  LEGACY_TIMESTAMP_HEADER,
  LEGACY_EVENT_HEADER,
  LEGACY_DELIVERY_ID_HEADER,
  type WebhookEvent,
  type UnknownWebhookEvent,
  type WebhookEventName,
  type WebhookEventDataMap,
  type WebhookMode,
  type WebhookHandlers,
  type WebhookSignatureFailure,
  type VerifyWebhookOptions,
  type VerifyLegacyWebhookOptions,
  type SignWebhookOptions,
  type ConstructEventOptions,
  type ParsedSignatureHeader,
  type HeadersLike,
  type RawBody,
  type InvestmentEventData,
  type InvestmentChangedEventData,
  type OfferingEventData,
  type InvestmentSessionEventData,
  type SyndicateInvitationEventData,
  type SyndicateMemberEventData,
  type WebhookInvestor,
  type WebhookInvestorTotals,
  type WebhookPersonRef,
} from "./webhooks.js";

// Re-export all generated model types for consumers (Investment, Syndicate, etc.).
export type * from "./generated/types.gen.js";
