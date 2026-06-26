// Webhook signature verification. Matches the REAL Wefunder attribution webhook
// scheme (app/jobs/attribution/webhook_delivery_job.rb): the delivery sends
//   X-Wefunder-Signature: sha256=<hex>      where hex = HMAC-SHA256(secret, "<ts>.<rawBody>")
//   X-Wefunder-Timestamp: <unix seconds>
//   X-Wefunder-Event, X-Wefunder-Delivery-Id
// We recompute the HMAC over "<timestamp>.<rawBody>" and constant-time compare,
// plus a timestamp tolerance to reject replays (plan §4.2 #4, §9).

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-wefunder-signature";
export const TIMESTAMP_HEADER = "x-wefunder-timestamp";
export const EVENT_HEADER = "x-wefunder-event";
export const DELIVERY_ID_HEADER = "x-wefunder-delivery-id";

export interface VerifyWebhookOptions {
  /** The exact raw request body bytes/string (NOT a re-serialized object). */
  payload: string;
  /** Value of the X-Wefunder-Signature header (`sha256=<hex>`). */
  signature: string;
  /** Value of the X-Wefunder-Timestamp header (unix seconds). */
  timestamp: string | number;
  secret: string;
  /** Reject if |now - timestamp| exceeds this. Default 300s. Set 0 to disable. */
  toleranceSeconds?: number;
  now?: () => number;
}

function computeSignature(secret: string, timestamp: string | number, payload: string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `sha256=${mac}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Returns true iff the signature is valid AND (when tolerance > 0) the timestamp
 * is within tolerance. Does not throw on a bad signature — returns false so the
 * caller can respond 400 without a try/catch.
 */
export function verifyWebhook(opts: VerifyWebhookOptions): boolean {
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = (opts.now ?? Date.now)();
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (tolerance > 0 && Math.abs(now / 1000 - ts) > tolerance) return false;

  const expected = computeSignature(opts.secret, opts.timestamp, opts.payload);
  return constantTimeEqual(opts.signature, expected);
}

export interface ParsedWebhook<T = unknown> {
  event: string;
  deliveryId: string;
  timestamp: number;
  data: T;
}

/**
 * Verify + parse in one step using a header lookup (works with Node's
 * IncomingHttpHeaders, a Headers instance, or a plain object). Returns the parsed
 * event on success; throws on an invalid signature so handlers fail loudly.
 */
export function constructEvent<T = unknown>(
  payload: string,
  headers: Headers | Record<string, string | string[] | undefined>,
  secret: string,
  opts?: { toleranceSeconds?: number; now?: () => number },
): ParsedWebhook<T> {
  const get = (name: string): string | undefined => {
    if (headers instanceof Headers) return headers.get(name) ?? undefined;
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const signature = get(SIGNATURE_HEADER);
  const timestamp = get(TIMESTAMP_HEADER);
  if (!signature || !timestamp) {
    throw new Error("Missing X-Wefunder-Signature or X-Wefunder-Timestamp header");
  }
  const ok = verifyWebhook({
    payload,
    signature,
    timestamp,
    secret,
    toleranceSeconds: opts?.toleranceSeconds,
    now: opts?.now,
  });
  if (!ok) throw new Error("Webhook signature verification failed");
  return {
    event: get(EVENT_HEADER) ?? "",
    deliveryId: get(DELIVERY_ID_HEADER) ?? "",
    timestamp: Number(timestamp),
    data: JSON.parse(payload) as T,
  };
}
