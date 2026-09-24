// Webhook verification + parsing for Wefunder platform events.
//
// The shipped scheme (docs.wefunder.com → Partner API → Webhooks → Verification;
// app/models/webhook_endpoint.rb#signature_header) is a single Stripe-style header:
//
//   Wefunder-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]
//   v1 = HMAC-SHA256(secret, "<t>.<raw_body>")
//
// During a secret rotation the header carries one `v1` per active secret (24h
// overlap); a delivery is valid if ANY `v1` matches. Consumers enforce a replay
// tolerance on `t` (documented: 5 minutes). Every delivery body is the envelope
// `{ id: "evt_…", event, created_at, mode, data }` — `id` is the dedup key.
//
// The retired attribution surface (`/campaigns/:id/attribution/webhooks`) signed
// differently (`X-Wefunder-Signature: sha256=<hex>` + `X-Wefunder-Timestamp`).
// `constructEvent` still accepts that shape so an attribution subscriber isn't
// stranded, but everything new should target the platform-events scheme.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { CreateWebhookEndpointData } from "./generated/types.gen.js";

// ---------------------------------------------------------------------------
// Event names + payload types
// ---------------------------------------------------------------------------

/**
 * Every event name in the catalog, derived from the spec's `events` enum on
 * `POST /webhook_endpoints` so it can't drift from the API.
 */
export type WebhookEventName = CreateWebhookEndpointData["body"]["events"][number];

/** Delivery mode — `test` for sandbox facts, `live` otherwise. */
export type WebhookMode = "live" | "test";

/** A person reference on a payload: partner-visible id + name, never email. */
export interface WebhookPersonRef {
  id: string | null;
  name: string | null;
}

/** The investor on an `investment.*` event. `email` needs `read:investors:pii`. */
export interface WebhookInvestor {
  id: string | null;
  name?: string | null;
  email?: string | null;
}

/**
 * The investor across all of the company's offerings in the same raise, at the
 * moment of the event. Company-installed apps only.
 */
export interface WebhookInvestorTotals {
  active_investment_count: number;
  total_committed: number | string | null;
  latest_applied_at: string | null;
  investor_status: "active" | "none_active";
}

/** `data` for the `investment.*` lifecycle events (not `investment.changed`). */
export interface InvestmentEventData {
  /** The investment (`inv_…`). */
  id: string;
  status: "reserved" | "active" | "executed" | "canceled" | "converted";
  /** The offering (`ofr_…`). */
  offering: string | null;
  amounts: { committed: number | string | null };
  investor: WebhookInvestor;
  /** Company-installed apps only. Absent for user-connected apps. */
  investor_totals?: WebhookInvestorTotals;
  /** ISO 8601 with microseconds. Order events by this, not by arrival. Absent on `investment.executed`. */
  occurred_at?: string;
  /** `investment.canceled` only. */
  canceled_at?: string | null;
  /** `investment.converted` only — the successor (`inv_…`), or null if unresolved at conversion. */
  converted_to?: string | null;
  /** `investment.amount_changed` only. */
  previous_amounts?: { committed: number | string | null };
}

/** `data` for `investment.changed` — a thin sync nudge; fetch the record, don't trust the payload. */
export interface InvestmentChangedEventData {
  /** The investment (`inv_…`). */
  id: string;
  /** `false` means the investment is no longer visible to the company (a tombstone). */
  visible: boolean;
  reason: string;
  /** The company (`co_…`). */
  company: string | null;
  observed_at: string;
}

/** `data` for the `offering.*` events. */
export interface OfferingEventData {
  /** The offering (`ofr_…`). */
  offering: string | null;
  status: "open" | "closing" | "closed" | "canceled";
  company: { name: string | null; url: string | null };
  /** `offering.closing` only, when ops has an ETA for disbursement. */
  expected_disbursement_at?: string;
}

/** `data` for the `investment_session.*` events. */
export interface InvestmentSessionEventData {
  /** The session id. */
  id: string;
  status: string;
  /** The offering (`ofr_…`). */
  offering: string | null;
  email: string | null;
  allocation_cents: number | null;
  expires_at: string | null;
  /** The resulting investment (`inv_…`), once one exists. */
  investment?: string;
}

/** `data` for `syndicate_member.invited` / `syndicate_member.reinvited`. */
export interface SyndicateInvitationEventData {
  /** The syndicate (`syn_…`). */
  syndicate: string | null;
  email: string | null;
  name: string | null;
  /** The invitee's `usr_…` id when the address already belongs to an account, else null. */
  user: string | null;
  invited_by: WebhookPersonRef | null;
  occurred_at: string;
}

/** `data` for `syndicate_member.applied` / `.approved` / `.joined`. */
export interface SyndicateMemberEventData {
  /** The membership (`mem_…`). */
  id: string | null;
  /** The syndicate (`syn_…`). */
  syndicate: string | null;
  status: "pending" | "approved" | "member";
  user: { id: string | null; name: string | null; email: string | null };
  /** Null on an automatic or invited join. */
  approved_by: WebhookPersonRef | null;
  occurred_at: string;
}

/** Maps each event name to the documented shape of its `data`. */
export interface WebhookEventDataMap {
  "investment.created": InvestmentEventData;
  "investment.reinstated": InvestmentEventData;
  "investment.canceled": InvestmentEventData;
  "investment.converted": InvestmentEventData;
  "investment.amount_changed": InvestmentEventData;
  "investment.executed": InvestmentEventData;
  "investment.changed": InvestmentChangedEventData;
  "offering.opened": OfferingEventData;
  "offering.closing": OfferingEventData;
  "offering.closed": OfferingEventData;
  "offering.canceled": OfferingEventData;
  "investment_session.created": InvestmentSessionEventData;
  "investment_session.started": InvestmentSessionEventData;
  "investment_session.completed": InvestmentSessionEventData;
  "investment_session.expired": InvestmentSessionEventData;
  "investment_session.canceled": InvestmentSessionEventData;
  "syndicate_member.invited": SyndicateInvitationEventData;
  "syndicate_member.reinvited": SyndicateInvitationEventData;
  "syndicate_member.applied": SyndicateMemberEventData;
  "syndicate_member.approved": SyndicateMemberEventData;
  "syndicate_member.joined": SyndicateMemberEventData;
}

// Compile-time check: every catalog name has a payload type. If a spec sync adds
// an event, `npm run typecheck` fails here until the map is extended.
type EveryEventIsTyped = WebhookEventName extends keyof WebhookEventDataMap ? true : never;
const everyEventIsTyped: EveryEventIsTyped = true;
void everyEventIsTyped;

/**
 * A verified, parsed delivery. Narrow on `event` to get a typed `data`:
 *
 *   if (evt.event === "investment.executed") evt.data.amounts.committed
 */
export type WebhookEvent<E extends WebhookEventName = WebhookEventName> = {
  [K in E]: {
    /** Event id (`evt_…`) — the dedup key. Deliveries may repeat; ignore ids you've seen. */
    id: string;
    event: K;
    created_at: string;
    mode: WebhookMode;
    data: WebhookEventDataMap[K];
    /** The signed timestamp (`t`, unix seconds). */
    timestamp: number;
  };
}[E];

/**
 * A delivery whose `event` isn't in this SDK's catalog (newer than your installed
 * version). Still signature-verified; `data` is untyped.
 */
export interface UnknownWebhookEvent {
  id: string;
  event: string;
  created_at: string;
  mode: WebhookMode;
  data: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Headers + errors
// ---------------------------------------------------------------------------

/** The platform-events signature header (case-insensitive). */
export const SIGNATURE_HEADER = "wefunder-signature";
/** Documented consumer replay tolerance. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** @deprecated Attribution-era header; only relevant to legacy attribution subscriptions. */
export const LEGACY_SIGNATURE_HEADER = "x-wefunder-signature";
/** @deprecated Attribution-era header; only relevant to legacy attribution subscriptions. */
export const LEGACY_TIMESTAMP_HEADER = "x-wefunder-timestamp";
/** @deprecated Attribution-era header; only relevant to legacy attribution subscriptions. */
export const LEGACY_EVENT_HEADER = "x-wefunder-event";
/** @deprecated Attribution-era header; only relevant to legacy attribution subscriptions. */
export const LEGACY_DELIVERY_ID_HEADER = "x-wefunder-delivery-id";

export type WebhookSignatureFailure =
  | "missing_header"
  | "malformed_header"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch"
  | "invalid_payload";

/** Thrown by `constructEvent` / `constructEventFromRequest`. Respond 400 and don't process. */
export class WebhookSignatureError extends Error {
  readonly reason: WebhookSignatureFailure;
  constructor(reason: WebhookSignatureFailure, message: string) {
    super(message);
    this.name = "WebhookSignatureError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Signing primitives
// ---------------------------------------------------------------------------

export type RawBody = string | Uint8Array;

function bodyBuffer(payload: RawBody): Buffer {
  return typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
}

/** `HMAC-SHA256(secret, "<timestamp>.<rawBody>")` as lowercase hex. */
export function computeWebhookSignature(secret: string, timestamp: number | string, payload: RawBody): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(bodyBuffer(payload)).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** The parts of a `Wefunder-Signature` header. */
export interface ParsedSignatureHeader {
  timestamp: number;
  /** Every `v1` value (more than one during a secret rotation). */
  signatures: string[];
}

/** Parse `t=<unix>,v1=<hex>[,v1=<hex>]`. Returns null when the shape is wrong. */
export function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (!/^\d+$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
    // Unknown keys (a future `v2`) are ignored on purpose — forward compatible.
  }
  if (timestamp === undefined || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export interface SignWebhookOptions {
  /** The exact bytes that will be sent as the body. */
  payload: RawBody;
  secret: string;
  /** Unix seconds. Defaults to now. */
  timestamp?: number;
  /**
   * Extra secrets to also sign with (adds one `v1` per secret) — simulates a
   * rotation window in tests.
   */
  additionalSecrets?: string[];
}

/**
 * Build a `Wefunder-Signature` header value for `payload`. For your own tests
 * (sign a fixture, POST it at your handler) — the API signs real deliveries.
 */
export function signWebhook(opts: SignWebhookOptions): string {
  const t = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const secrets = [opts.secret, ...(opts.additionalSecrets ?? [])];
  const entries = secrets.map((s) => `v1=${computeWebhookSignature(s, t, opts.payload)}`);
  return [`t=${t}`, ...entries].join(",");
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerifyWebhookOptions {
  /** The exact raw request body (NOT a re-serialized object). */
  payload: RawBody;
  /** Value of the `Wefunder-Signature` header (`t=…,v1=…`). */
  header: string;
  secret: string;
  /** Reject if |now - t| exceeds this. Default 300s. Set 0 to disable. */
  toleranceSeconds?: number;
  /** Injectable clock (ms since epoch), for tests. */
  now?: () => number;
}

/**
 * Returns the reason a delivery is NOT valid, or null when it is. Constant-time
 * compare against every `v1`; enforces the timestamp tolerance.
 */
export function checkWebhookSignature(opts: VerifyWebhookOptions): WebhookSignatureFailure | null {
  const parsed = parseSignatureHeader(opts.header);
  if (!parsed) return "malformed_header";
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0) {
    const nowSec = (opts.now ?? Date.now)() / 1000;
    if (Math.abs(nowSec - parsed.timestamp) > tolerance) return "timestamp_out_of_tolerance";
  }
  const expected = computeWebhookSignature(opts.secret, parsed.timestamp, opts.payload);
  return parsed.signatures.some((sig) => constantTimeEqual(sig, expected)) ? null : "signature_mismatch";
}

/** Legacy attribution-scheme inputs (`X-Wefunder-Signature: sha256=…` + `X-Wefunder-Timestamp`). */
export interface VerifyLegacyWebhookOptions {
  payload: RawBody;
  /** `sha256=<hex>` */
  signature: string;
  /** Unix seconds, from `X-Wefunder-Timestamp`. */
  timestamp: string | number;
  secret: string;
  toleranceSeconds?: number;
  now?: () => number;
}

/**
 * `true` iff the signature is valid and (when tolerance > 0) the timestamp is
 * within tolerance. Never throws — respond 400 without a try/catch.
 *
 * Accepts either the platform-events header (`{ header }`) or, for a legacy
 * attribution subscription, `{ signature, timestamp }`.
 */
export function verifyWebhook(opts: VerifyWebhookOptions | VerifyLegacyWebhookOptions): boolean {
  if ("header" in opts) return checkWebhookSignature(opts) === null;
  return verifyLegacyWebhook(opts);
}

function verifyLegacyWebhook(opts: VerifyLegacyWebhookOptions): boolean {
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (tolerance > 0 && Math.abs((opts.now ?? Date.now)() / 1000 - ts) > tolerance) return false;
  const expected = `sha256=${computeWebhookSignature(opts.secret, opts.timestamp, opts.payload)}`;
  return constantTimeEqual(opts.signature, expected);
}

// ---------------------------------------------------------------------------
// constructEvent — verify + parse
// ---------------------------------------------------------------------------

/** Node `IncomingHttpHeaders`, a fetch `Headers`, or a plain object. */
export type HeadersLike = Headers | Record<string, string | string[] | undefined>;

function headerGetter(headers: HeadersLike | string): (name: string) => string | undefined {
  if (typeof headers === "string") {
    return (name) => (name === SIGNATURE_HEADER ? headers : undefined);
  }
  if (headers instanceof Headers) return (name) => headers.get(name) ?? undefined;
  // Plain objects: try the lowercase key, then a case-insensitive scan
  // (Node lowercases IncomingHttpHeaders; hand-built objects may not).
  return (name) => {
    let v = headers[name];
    if (v === undefined) {
      const hit = Object.keys(headers).find((k) => k.toLowerCase() === name);
      if (hit) v = headers[hit];
    }
    return Array.isArray(v) ? v[0] : v;
  };
}

export interface ConstructEventOptions {
  toleranceSeconds?: number;
  now?: () => number;
}

interface Envelope {
  id?: unknown;
  event?: unknown;
  created_at?: unknown;
  mode?: unknown;
  data?: unknown;
}

/**
 * Verify a delivery and parse its envelope in one step. Throws
 * `WebhookSignatureError` on any failure so handlers fail loudly; on success the
 * returned event is a discriminated union — narrow on `event` for typed `data`.
 *
 * @param payload  the RAW request body (string or bytes) — never a re-serialized object
 * @param headers  the request headers, or the `Wefunder-Signature` value itself
 * @param secret   the endpoint's signing secret (shown once at create / rotate)
 */
export function constructEvent(
  payload: RawBody,
  headers: HeadersLike | string,
  secret: string,
  opts?: ConstructEventOptions,
): WebhookEvent | UnknownWebhookEvent {
  const get = headerGetter(headers);
  const header = get(SIGNATURE_HEADER);

  if (!header) {
    const legacySig = get(LEGACY_SIGNATURE_HEADER);
    const legacyTs = get(LEGACY_TIMESTAMP_HEADER);
    if (legacySig && legacyTs) return constructLegacyEvent(payload, get, legacySig, legacyTs, secret, opts);
    throw new WebhookSignatureError("missing_header", describeFailure("missing_header"));
  }

  const failure = checkWebhookSignature({ payload, header, secret, ...opts });
  if (failure) throw new WebhookSignatureError(failure, describeFailure(failure));

  const parsed = parseSignatureHeader(header)!;
  const env = parseEnvelope(payload);
  return {
    id: String(env.id ?? ""),
    event: String(env.event ?? ""),
    created_at: String(env.created_at ?? ""),
    mode: (env.mode === "test" ? "test" : "live") as WebhookMode,
    data: env.data,
    timestamp: parsed.timestamp,
  } as WebhookEvent | UnknownWebhookEvent;
}

function constructLegacyEvent(
  payload: RawBody,
  get: (name: string) => string | undefined,
  signature: string,
  timestamp: string,
  secret: string,
  opts?: ConstructEventOptions,
): UnknownWebhookEvent {
  if (!verifyLegacyWebhook({ payload, signature, timestamp, secret, ...opts })) {
    throw new WebhookSignatureError("signature_mismatch", describeFailure("signature_mismatch"));
  }
  const env = parseEnvelope(payload);
  return {
    id: String(env.id ?? get(LEGACY_DELIVERY_ID_HEADER) ?? ""),
    event: String(env.event ?? get(LEGACY_EVENT_HEADER) ?? ""),
    created_at: String(env.created_at ?? ""),
    mode: (env.mode === "test" ? "test" : "live") as WebhookMode,
    data: env.data ?? env,
    timestamp: Number(timestamp),
  };
}

function parseEnvelope(payload: RawBody): Envelope {
  try {
    const parsed: unknown = JSON.parse(bodyBuffer(payload).toString("utf8"));
    if (parsed === null || typeof parsed !== "object") throw new Error("not an object");
    return parsed as Envelope;
  } catch {
    throw new WebhookSignatureError("invalid_payload", describeFailure("invalid_payload"));
  }
}

function describeFailure(reason: WebhookSignatureFailure): string {
  switch (reason) {
    case "missing_header":
      return "Missing Wefunder-Signature header";
    case "malformed_header":
      return "Wefunder-Signature header is malformed (expected t=<unix>,v1=<hex>)";
    case "timestamp_out_of_tolerance":
      return "Webhook timestamp is outside the replay tolerance";
    case "signature_mismatch":
      return "Webhook signature verification failed";
    case "invalid_payload":
      return "Webhook body is not a JSON object";
  }
}

/**
 * `constructEvent` for fetch-style servers (Next.js route handlers, Hono, Remix,
 * Cloudflare Workers, Bun, Deno): reads the raw body from the `Request` for you.
 * Don't call `request.json()` first — the body must be read exactly once, as text.
 */
export async function constructEventFromRequest(
  request: Request,
  secret: string,
  opts?: ConstructEventOptions,
): Promise<WebhookEvent | UnknownWebhookEvent> {
  const payload = await request.text();
  return constructEvent(payload, request.headers, secret, opts);
}

// ---------------------------------------------------------------------------
// Dispatch — route a verified event to typed handlers
// ---------------------------------------------------------------------------

export type WebhookHandlers = {
  [K in WebhookEventName]?: (event: WebhookEvent<K>) => void | Promise<void>;
} & {
  /** Runs for any event with no specific handler (including names newer than this SDK). */
  default?: (event: WebhookEvent | UnknownWebhookEvent) => void | Promise<void>;
};

/**
 * Call the handler registered for `event.event`, falling back to `default`.
 * Returns `true` if a handler ran. Pairs with `constructEvent`:
 *
 *   const event = constructEvent(raw, req.headers, secret);
 *   await dispatchWebhook(event, {
 *     "investment.executed": async (e) => await recordFunding(e.data),
 *     default: (e) => console.log("unhandled", e.event),
 *   });
 */
export async function dispatchWebhook(
  event: WebhookEvent | UnknownWebhookEvent,
  handlers: WebhookHandlers,
): Promise<boolean> {
  type AnyHandler = (e: never) => void | Promise<void>;
  const specific =
    event.event === "default"
      ? undefined
      : (handlers as Record<string, AnyHandler | undefined>)[event.event];
  if (specific) {
    await specific(event as never);
    return true;
  }
  if (handlers.default) {
    await handlers.default(event);
    return true;
  }
  return false;
}
