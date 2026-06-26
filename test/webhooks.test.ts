import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhook, constructEvent } from "../src/webhooks.js";

const SECRET = "whsec_test_abcdef0123456789";

// Mirror the app's scheme exactly: sha256=HMAC-SHA256(secret, "<ts>.<rawBody>")
function sign(secret: string, ts: number, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

describe("verifyWebhook", () => {
  const body = JSON.stringify({ event: "investment.created", id: 42 });
  const ts = 1_700_000_000;
  const now = () => ts * 1000 + 1000; // 1s later

  it("accepts a valid signature matching the real scheme", () => {
    expect(
      verifyWebhook({ payload: body, signature: sign(SECRET, ts, body), timestamp: ts, secret: SECRET, now }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(SECRET, ts, body);
    expect(
      verifyWebhook({ payload: body + " ", signature: sig, timestamp: ts, secret: SECRET, now }),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(
      verifyWebhook({ payload: body, signature: sign("other", ts, body), timestamp: ts, secret: SECRET, now }),
    ).toBe(false);
  });

  it("rejects a stale timestamp outside tolerance (replay defense)", () => {
    const stale = () => (ts + 10_000) * 1000; // far in the future vs ts
    expect(
      verifyWebhook({ payload: body, signature: sign(SECRET, ts, body), timestamp: ts, secret: SECRET, now: stale, toleranceSeconds: 300 }),
    ).toBe(false);
  });

  it("can disable the tolerance check with toleranceSeconds=0", () => {
    const stale = () => (ts + 10_000) * 1000;
    expect(
      verifyWebhook({ payload: body, signature: sign(SECRET, ts, body), timestamp: ts, secret: SECRET, now: stale, toleranceSeconds: 0 }),
    ).toBe(true);
  });

  it("does not throw on malformed timestamp — returns false", () => {
    expect(
      verifyWebhook({ payload: body, signature: "sha256=deadbeef", timestamp: "not-a-number", secret: SECRET, now }),
    ).toBe(false);
  });
});

describe("constructEvent", () => {
  const data = { event: "syndicate.member.joined", member_id: 7 };
  const body = JSON.stringify(data);
  const ts = 1_700_000_000;
  const now = () => ts * 1000;

  it("verifies + parses with a plain headers object", () => {
    const headers = {
      "x-wefunder-signature": sign(SECRET, ts, body),
      "x-wefunder-timestamp": String(ts),
      "x-wefunder-event": "syndicate.member.joined",
      "x-wefunder-delivery-id": "whd_123",
    };
    const evt = constructEvent<typeof data>(body, headers, SECRET, { now });
    expect(evt.event).toBe("syndicate.member.joined");
    expect(evt.deliveryId).toBe("whd_123");
    expect(evt.timestamp).toBe(ts);
    expect(evt.data.member_id).toBe(7);
  });

  it("works with a Headers instance", () => {
    const headers = new Headers({
      "X-Wefunder-Signature": sign(SECRET, ts, body),
      "X-Wefunder-Timestamp": String(ts),
      "X-Wefunder-Event": "x",
      "X-Wefunder-Delivery-Id": "whd_9",
    });
    expect(() => constructEvent(body, headers, SECRET, { now })).not.toThrow();
  });

  it("throws on an invalid signature", () => {
    const headers = { "x-wefunder-signature": "sha256=bad", "x-wefunder-timestamp": String(ts) };
    expect(() => constructEvent(body, headers, SECRET, { now })).toThrow(/verification failed/);
  });

  it("throws when signature/timestamp headers are missing", () => {
    expect(() => constructEvent(body, {}, SECRET, { now })).toThrow(/Missing/);
  });
});
