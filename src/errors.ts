// Typed errors mapped from the REAL Wefunder error envelope. Confirmed against
// api/v2/base_controller.rb#render_error (and the doorkeeper render options):
//   { "error": { "type", "message", "details"?, "request_id", "remediation"? } }
// NOTE: request_id and remediation are NESTED under `error` (not top-level) — the
// spec's Error schema models neither, but the runtime always emits request_id.

export interface WefunderErrorBody {
  error?: {
    type?: string;
    message?: string;
    details?: unknown;
    request_id?: string;
    remediation?: string;
  };
  // Defensive: some envelopes (e.g. *WithMeta success meta) carry request_id here.
  request_id?: string;
}

/** Response header carrying the partner-facing request id (Stripe-style `req_…`). */
export const REQUEST_ID_HEADER = "x-wf-request-id";

/** Prefer the X-Wf-Request-Id response header; fall back to a body-derived id. */
export function requestIdFrom(response: Response | undefined, bodyRequestId: string | undefined): string | undefined {
  return response?.headers.get(REQUEST_ID_HEADER) ?? bodyRequestId;
}

export class WefunderError extends Error {
  readonly status: number;
  readonly type: string;
  readonly requestId?: string;
  readonly details?: unknown;
  /** Server-provided hint on how to resolve the error, when present. */
  readonly remediation?: string;
  /** Documentation pointer surfaced to developers in stack traces / logs. */
  readonly documentationUrl = "https://docs.wefunder.com/api-reference";

  constructor(args: {
    status: number;
    type: string;
    message: string;
    requestId?: string;
    details?: unknown;
    remediation?: string;
  }) {
    super(args.message);
    this.name = "WefunderError";
    this.status = args.status;
    this.type = args.type;
    this.requestId = args.requestId;
    this.details = args.details;
    this.remediation = args.remediation;
  }
}

/** Raised when token refresh is needed but no refresh token / refresher is configured. */
export class WefunderAuthError extends WefunderError {
  constructor(message: string) {
    super({ status: 401, type: "unauthorized", message });
    this.name = "WefunderAuthError";
  }
}

/**
 * Build a WefunderError from a failed Response. Reads the typed envelope from the
 * body; falls back gracefully when the body isn't the expected shape.
 */
export async function errorFromResponse(response: Response): Promise<WefunderError> {
  let body: WefunderErrorBody | undefined;
  try {
    body = (await response.clone().json()) as WefunderErrorBody;
  } catch {
    // non-JSON body (e.g. an HTML 502 from the edge) — keep body undefined
  }
  const err = body?.error ?? {};
  return new WefunderError({
    status: response.status,
    type: err.type ?? "api_error",
    message: err.message ?? response.statusText ?? "Request failed",
    // X-Wf-Request-Id is set on every authenticated response (base_controller.rb),
    // so it's present even when the body isn't JSON (e.g. an HTML 502 from the edge),
    // unlike the nested error.request_id. Prefer the header; fall back to the body.
    requestId: requestIdFrom(response, err.request_id ?? body?.request_id),
    details: err.details,
    remediation: err.remediation,
  });
}
