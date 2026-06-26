// Typed errors mapped from the REAL Wefunder error envelope:
//   { "error": { "type", "message", "details" }, "request_id": "..." }
// Per the contract review (plan §4.1 #7): request_id lives in the JSON BODY,
// not an x-request-id header. We read it from the body.

export interface WefunderErrorBody {
  error?: {
    type?: string;
    message?: string;
    details?: unknown;
  };
  // request_id is top-level in the envelope
  request_id?: string;
}

export class WefunderError extends Error {
  readonly status: number;
  readonly type: string;
  readonly requestId?: string;
  readonly details?: unknown;
  /** Documentation pointer surfaced to developers in stack traces / logs. */
  readonly documentationUrl = "https://docs.wefunder.com/api-reference";

  constructor(args: {
    status: number;
    type: string;
    message: string;
    requestId?: string;
    details?: unknown;
  }) {
    super(args.message);
    this.name = "WefunderError";
    this.status = args.status;
    this.type = args.type;
    this.requestId = args.requestId;
    this.details = args.details;
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
    requestId: body?.request_id,
    details: err.details,
  });
}
