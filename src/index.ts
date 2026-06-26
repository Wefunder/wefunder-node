// Public API surface for @wefunder/sdk.

export {
  Wefunder,
  modeForToken,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_VERSION,
  type WefunderOptions,
  type Mode,
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
  // host config (authorize host vs token host — see #10 split)
  DEFAULT_AUTHORIZE_BASE_URL,
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
  type VerifyWebhookOptions,
  type ParsedWebhook,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  EVENT_HEADER,
  DELIVERY_ID_HEADER,
} from "./webhooks.js";

// Re-export all generated model types for consumers (Investment, Syndicate, etc.).
export type * from "./generated/types.gen.js";
