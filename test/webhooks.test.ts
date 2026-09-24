import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyWebhook,
  checkWebhookSignature,
  constructEvent,
  constructEventFromRequest,
  parseSignatureHeader,
  signWebhook,
  computeWebhookSignature,
  dispatchWebhook,
  WebhookSignatureError,
  type WebhookEvent,
  type UnknownWebhookEvent,
} from "../src/webhooks.js";

const SECRET = "whsec_test_abcdef0123456789";

// The canonical test vector published on docs.wefunder.com (Partner API → Webhooks →
// Verification). It is asserted against the app's signing code in the wefunder repo's CI,
// so if this constant stops matching, the SDK — not the docs — has drifted.
const DOCS_VECTOR = {
  secret: "whsec_docvector_2f9c1a4b8e7d6c5a",
  t: 1705334400,
  body: '{"id":"evt_0KZq8xExampleOpened01","event":"offering.opened","created_at":"2026-01-15T12:00:00Z","mode":"live","data":{"offering":"ofr_9m2ExampleRound00","status":"open","company":{"name":"Example Company","url":"example-company"}}}',
  v1: "0385f3fa13024fc4d851034779083ea49483162d32b668d7646e2b94fccd84db",
};
const DOCS_HEADER = `t=${DOCS_VECTOR.t},v1=${DOCS_VECTOR.v1}`;
const docsNow = () => DOCS_VECTOR.t * 1000 + 1_000;

describe("canonical docs test vector (frozen — not self-referential)", () => {
  it("computes the published v1 from the published secret/t/body", () => {
    expect(computeWebhookSignature(DOCS_VECTOR.secret, DOCS_VECTOR.t, DOCS_VECTOR.body)).toBe(DOCS_VECTOR.v1);
  });

  it("verifies the published header", () => {
    expect(
      verifyWebhook({ payload: DOCS_VECTOR.body, header: DOCS_HEADER, secret: DOCS_VECTOR.secret, now: docsNow }),
    ).toBe(true);
  });

  it("constructEvent yields the typed envelope", () => {
    const evt = constructEvent(DOCS_VECTOR.body, DOCS_HEADER, DOCS_VECTOR.secret, { now: docsNow });
    expect(evt.id).toBe("evt_0KZq8xExampleOpened01");
    expect(evt.event).toBe("offering.opened");
    expect(evt.mode).toBe("live");
    expect(evt.timestamp).toBe(DOCS_VECTOR.t);
    if (evt.event === "offering.opened") {
      expect(evt.data.status).toBe("open");
      expect(evt.data.company.url).toBe("example-company");
    } else {
      throw new Error("expected offering.opened");
    }
  });

  it("rejects the vector under any single-byte body change", () => {
    const tampered = DOCS_VECTOR.body.replace("example-company", "example-c0mpany");
    expect(checkWebhookSignature({ payload: tampered, header: DOCS_HEADER, secret: DOCS_VECTOR.secret, now: docsNow })).toBe(
      "signature_mismatch",
    );
  });
});

describe("parseSignatureHeader", () => {
  it("parses t and one v1", () => {
    expect(parseSignatureHeader("t=1700000000,v1=abc")).toEqual({ timestamp: 1_700_000_000, signatures: ["abc"] });
  });

  it("collects every v1 (rotation window) and ignores unknown keys", () => {
    expect(parseSignatureHeader("t=1,v1=aa,v1=bb,v2=future")).toEqual({ timestamp: 1, signatures: ["aa", "bb"] });
  });

  it("tolerates whitespace around parts", () => {
    expect(parseSignatureHeader(" t=5 , v1=zz ")).toEqual({ timestamp: 5, signatures: ["zz"] });
  });

  it("returns null when t or v1 is missing or t is not an integer", () => {
    expect(parseSignatureHeader("v1=abc")).toBeNull();
    expect(parseSignatureHeader("t=1700000000")).toBeNull();
    expect(parseSignatureHeader("t=soon,v1=abc")).toBeNull();
    expect(parseSignatureHeader("")).toBeNull();
    expect(parseSignatureHeader("sha256=deadbeef")).toBeNull();
  });
});

describe("verifyWebhook / checkWebhookSignature (platform-events scheme)", () => {
  const body = JSON.stringify({ id: "evt_1", event: "investment.created", data: { id: "inv_1" } });
  const ts = 1_700_000_000;
  const now = () => ts * 1000 + 1000; // 1s later

  it("accepts a header produced by signWebhook", () => {
    const header = signWebhook({ payload: body, secret: SECRET, timestamp: ts });
    expect(verifyWebhook({ payload: body, header, secret: SECRET, now })).toBe(true);
  });

  it("accepts bytes (Buffer / Uint8Array) as the payload", () => {
    const header = signWebhook({ payload: body, secret: SECRET, timestamp: ts });
    expect(verifyWebhook({ payload: Buffer.from(body), header, secret: SECRET, now })).toBe(true);
    expect(verifyWebhook({ payload: new TextEncoder().encode(body), header, secret: SECRET, now })).toBe(true);
  });

  it("accepts when ANY v1 matches (dual-secret rotation window)", () => {
    const header = signWebhook({ payload: body, secret: "old-secret", additionalSecrets: [SECRET], timestamp: ts });
    expect(header.match(/v1=/g)).toHaveLength(2);
    expect(verifyWebhook({ payload: body, header, secret: SECRET, now })).toBe(true);
    expect(verifyWebhook({ payload: body, header, secret: "old-secret", now })).toBe(true);
    expect(verifyWebhook({ payload: body, header, secret: "neither", now })).toBe(false);
  });

  it("rejects a tampered body", () => {
    const header = signWebhook({ payload: body, secret: SECRET, timestamp: ts });
    expect(checkWebhookSignature({ payload: body + " ", header, secret: SECRET, now })).toBe("signature_mismatch");
  });

  it("rejects a wrong secret", () => {
    const header = signWebhook({ payload: body, secret: "other", timestamp: ts });
    expect(verifyWebhook({ payload: body, header, secret: SECRET, now })).toBe(false);
  });

  it("rejects a stale timestamp outside tolerance (replay defense), in either direction", () => {
    const header = signWebhook({ payload: body, secret: SECRET, timestamp: ts });
    const future = () => (ts + 10_000) * 1000;
    const past = () => (ts - 10_000) * 1000;
    expect(checkWebhookSignature({ payload: body, header, secret: SECRET, now: future })).toBe("timestamp_out_of_tolerance");
    expect(checkWebhookSignature({ payload: body, header, secret: SECRET, now: past })).toBe("timestamp_out_of_tolerance");
  });

  it("uses a 300s default tolerance and honors a custom one", () => {
    const header = signWebhook({ payload: body, secret: SECRET, timestamp: ts });
    const at299 = () => (ts + 299) * 1000;
    const at301 = () => (ts + 301) * 1000;
    expect(verifyWebhook({ payload: body, header, secret: SECRET, now: at299 })).toBe(true);
    expect(verifyWebhook({ payload: body, header, secret: SECRET, now: at301 })).toBe(false);
    expect(verifyWebhook({ payload: body, header, secret: SECRET, now: at301, toleranceSeconds: 600 })).toBe(true);
  });

  it("can disable the tolerance check with toleranceSeconds=0", () => {
    const header = signWebhook({ payload: body, secret: SECRET, timestamp: ts });
    const stale = () => (ts + 10_000) * 1000;
    expect(verifyWebhook({ payload: body, header, secret: SECRET, now: stale, toleranceSeconds: 0 })).toBe(true);
  });

  it("does not throw on a malformed header — returns false / malformed_header", () => {
    expect(verifyWebhook({ payload: body, header: "garbage", secret: SECRET, now })).toBe(false);
    expect(checkWebhookSignature({ payload: body, header: "sha256=deadbeef", secret: SECRET, now })).toBe("malformed_header");
  });

  it("does constant-length comparison (a v1 of the wrong length never matches)", () => {
    expect(verifyWebhook({ payload: body, header: `t=${ts},v1=ab`, secret: SECRET, now })).toBe(false);
  });
});

describe("constructEvent (platform-events scheme)", () => {
  const envelope = {
    id: "evt_abc",
    event: "investment.executed",
    created_at: "2026-09-24T12:00:00Z",
    mode: "test",
    data: {
      id: "inv_1",
      status: "executed",
      offering: "ofr_1",
      amounts: { committed: 50000 },
      investor: { id: "usr_1", name: "Alex Example" },
    },
  };
  const body = JSON.stringify(envelope);
  const ts = 1_700_000_000;
  const now = () => ts * 1000;
  const header = signWebhook({ payload: body, secret: SECRET, timestamp: ts });

  it("verifies + parses with a Node-style lowercase headers object", () => {
    const evt = constructEvent(body, { "wefunder-signature": header, host: "example.com" }, SECRET, { now });
    expect(evt.id).toBe("evt_abc");
    expect(evt.event).toBe("investment.executed");
    expect(evt.mode).toBe("test");
    expect(evt.created_at).toBe("2026-09-24T12:00:00Z");
    expect(evt.timestamp).toBe(ts);
    if (evt.event === "investment.executed") expect(evt.data.amounts.committed).toBe(50000);
  });

  it("finds the header case-insensitively in a plain object and takes the first of an array", () => {
    expect(() => constructEvent(body, { "Wefunder-Signature": header }, SECRET, { now })).not.toThrow();
    expect(() => constructEvent(body, { "wefunder-signature": [header, "t=1,v1=x"] }, SECRET, { now })).not.toThrow();
  });

  it("works with a fetch Headers instance", () => {
    const headers = new Headers({ "Wefunder-Signature": header });
    expect(() => constructEvent(body, headers, SECRET, { now })).not.toThrow();
  });

  it("accepts the header value directly as a string", () => {
    expect(constructEvent(body, header, SECRET, { now }).id).toBe("evt_abc");
  });

  it("accepts the raw body as bytes", () => {
    expect(constructEvent(Buffer.from(body), header, SECRET, { now }).id).toBe("evt_abc");
  });

  it("throws WebhookSignatureError with a reason on an invalid signature", () => {
    const bad = signWebhook({ payload: body, secret: "nope", timestamp: ts });
    try {
      constructEvent(body, { "wefunder-signature": bad }, SECRET, { now });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookSignatureError);
      expect((err as WebhookSignatureError).reason).toBe("signature_mismatch");
    }
  });

  it("throws missing_header when no signature header is present", () => {
    expect(() => constructEvent(body, {}, SECRET, { now })).toThrow(WebhookSignatureError);
    try {
      constructEvent(body, {}, SECRET, { now });
    } catch (err) {
      expect((err as WebhookSignatureError).reason).toBe("missing_header");
    }
  });

  it("throws malformed_header / timestamp_out_of_tolerance with matching reasons", () => {
    try {
      constructEvent(body, "t=abc,v1=zz", SECRET, { now });
    } catch (err) {
      expect((err as WebhookSignatureError).reason).toBe("malformed_header");
    }
    try {
      constructEvent(body, header, SECRET, { now: () => (ts + 9999) * 1000 });
    } catch (err) {
      expect((err as WebhookSignatureError).reason).toBe("timestamp_out_of_tolerance");
    }
  });

  it("throws invalid_payload when a correctly signed body is not a JSON object", () => {
    const notJson = "not json at all";
    const h = signWebhook({ payload: notJson, secret: SECRET, timestamp: ts });
    try {
      constructEvent(notJson, h, SECRET, { now });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as WebhookSignatureError).reason).toBe("invalid_payload");
    }
  });

  it("passes through an event name newer than this SDK (untyped data), still verified", () => {
    const future = JSON.stringify({ id: "evt_f", event: "offering.renamed", created_at: "x", mode: "live", data: { k: 1 } });
    const h = signWebhook({ payload: future, secret: SECRET, timestamp: ts });
    const evt = constructEvent(future, h, SECRET, { now }) as UnknownWebhookEvent;
    expect(evt.event).toBe("offering.renamed");
    expect(evt.data).toEqual({ k: 1 });
  });

  it("defaults mode to live when the envelope omits it", () => {
    const noMode = JSON.stringify({ id: "evt_m", event: "offering.opened", data: {} });
    const h = signWebhook({ payload: noMode, secret: SECRET, timestamp: ts });
    expect(constructEvent(noMode, h, SECRET, { now }).mode).toBe("live");
  });
});

describe("constructEventFromRequest (fetch-style servers)", () => {
  it("reads the raw body from a Request and verifies it", async () => {
    const body = JSON.stringify({ id: "evt_r", event: "offering.closed", created_at: "x", mode: "live", data: { offering: "ofr_1" } });
    const ts = 1_700_000_000;
    const header = signWebhook({ payload: body, secret: SECRET, timestamp: ts });
    const req = new Request("https://example.com/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json", "Wefunder-Signature": header },
      body,
    });
    const evt = await constructEventFromRequest(req, SECRET, { now: () => ts * 1000 });
    expect(evt.event).toBe("offering.closed");
  });

  it("rejects when the body was altered in flight", async () => {
    const body = '{"id":"evt_r","event":"offering.closed","data":{}}';
    const header = signWebhook({ payload: body, secret: SECRET, timestamp: 1_700_000_000 });
    const req = new Request("https://example.com/webhooks", {
      method: "POST",
      headers: { "Wefunder-Signature": header },
      body: body.replace("closed", "opened"),
    });
    await expect(constructEventFromRequest(req, SECRET, { now: () => 1_700_000_000 * 1000 })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });
});

describe("dispatchWebhook", () => {
  const ts = 1_700_000_000;
  const now = () => ts * 1000;
  const make = (event: string, data: unknown) => {
    const body = JSON.stringify({ id: `evt_${event}`, event, created_at: "x", mode: "live", data });
    return constructEvent(body, signWebhook({ payload: body, secret: SECRET, timestamp: ts }), SECRET, { now });
  };

  it("routes to the specific handler with a narrowed type", async () => {
    const executed = vi.fn(async (e: WebhookEvent<"investment.executed">) => {
      expect(e.data.status).toBe("executed");
    });
    const ran = await dispatchWebhook(make("investment.executed", { id: "inv_1", status: "executed" }), {
      "investment.executed": executed,
      default: () => {
        throw new Error("default should not run");
      },
    });
    expect(ran).toBe(true);
    expect(executed).toHaveBeenCalledOnce();
  });

  it("falls back to default for unhandled and unknown events; false when nothing matches", async () => {
    const fallback = vi.fn();
    expect(await dispatchWebhook(make("offering.opened", {}), { default: fallback })).toBe(true);
    expect(await dispatchWebhook(make("brand.new_event", {}), { default: fallback })).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(await dispatchWebhook(make("offering.opened", {}), {})).toBe(false);
  });

  it("never treats an event literally named `default` as the fallback key", async () => {
    const fallback = vi.fn();
    await dispatchWebhook(make("default", {}), { default: fallback });
    expect(fallback).toHaveBeenCalledOnce(); // via the fallback path, not as a "specific" handler
  });
});

describe("legacy attribution scheme (X-Wefunder-Signature: sha256=… + X-Wefunder-Timestamp)", () => {
  function legacySign(secret: string, ts: number, body: string): string {
    return "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  }
  // Frozen known-answer vector from the previous SDK release — the legacy path must keep
  // matching app/jobs/attribution/webhook_delivery_job.rb byte for byte.
  const KAT = {
    secret: "whsec_known_answer_vector",
    ts: 1_700_000_000,
    body: '{"event":"investment.created","data":{"id":42}}',
    signature: "sha256=f8d26f3a80ecee5f72f9fe87233f8cc71539f45e11d08c0c4f88d7d308fa1c0f",
  };

  it("verifyWebhook still accepts the legacy { signature, timestamp } shape", () => {
    expect(
      verifyWebhook({ payload: KAT.body, signature: KAT.signature, timestamp: KAT.ts, secret: KAT.secret, toleranceSeconds: 0 }),
    ).toBe(true);
    expect(
      verifyWebhook({
        payload: KAT.body.replace("42", "43"),
        signature: KAT.signature,
        timestamp: KAT.ts,
        secret: KAT.secret,
        toleranceSeconds: 0,
      }),
    ).toBe(false);
    expect(
      verifyWebhook({ payload: KAT.body, signature: "sha256=deadbeef", timestamp: "not-a-number", secret: KAT.secret }),
    ).toBe(false);
  });

  it("constructEvent auto-detects legacy headers and maps them onto the envelope", () => {
    const data = { event: "investment.confirmed", investment_id: 7 };
    const body = JSON.stringify(data);
    const ts = 1_700_000_000;
    const evt = constructEvent(
      body,
      {
        "x-wefunder-signature": legacySign(SECRET, ts, body),
        "x-wefunder-timestamp": String(ts),
        "x-wefunder-event": "investment.confirmed",
        "x-wefunder-delivery-id": "whd_123",
      },
      SECRET,
      { now: () => ts * 1000 },
    ) as UnknownWebhookEvent;
    expect(evt.event).toBe("investment.confirmed");
    expect(evt.id).toBe("whd_123");
    expect(evt.timestamp).toBe(ts);
    expect((evt.data as typeof data).investment_id).toBe(7);
  });

  it("rejects a bad legacy signature", () => {
    const ts = 1_700_000_000;
    expect(() =>
      constructEvent("{}", { "x-wefunder-signature": "sha256=bad", "x-wefunder-timestamp": String(ts) }, SECRET, {
        now: () => ts * 1000,
      }),
    ).toThrow(WebhookSignatureError);
  });
});
