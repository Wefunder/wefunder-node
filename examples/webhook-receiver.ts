// Receive + verify Wefunder webhook deliveries (Express).
// Run: WEFUNDER_WEBHOOK_SECRET=whsec_... npx tsx examples/webhook-receiver.ts
//
// Setup, once: register this URL (behind a public HTTPS tunnel such as ngrok or
// cloudflared — localhost is rejected) and keep the one-time secret:
//   const ep = await wf.webhookEndpoints.create({ url, events: ["investment.executed"] });
//   ep.attributes.secret  // → WEFUNDER_WEBHOOK_SECRET
// Then confirm end to end: await wf.webhookEndpoints.test(ep.id!)
import express from "express";
import { constructEvent, dispatchWebhook, WebhookSignatureError } from "@wefunder/sdk";

const secret = process.env.WEFUNDER_WEBHOOK_SECRET!;
const app = express();

// IMPORTANT: verify against the RAW body bytes — use express.raw, not express.json.
app.post("/webhooks/wefunder", express.raw({ type: "*/*" }), async (req, res) => {
  let event;
  try {
    event = constructEvent(req.body as Buffer, req.headers, secret);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      console.warn("rejected webhook:", err.reason);
      return res.status(400).send(err.reason);
    }
    throw err;
  }

  // Deliveries are at-least-once and unordered: dedupe on event.id, and when a
  // payload carries occurred_at, keep the state from the latest one you've seen.
  if (await alreadyProcessed(event.id)) return res.sendStatus(200);

  // Ack fast; do real work off the request path.
  res.sendStatus(200);

  await dispatchWebhook(event, {
    "investment.executed": async (e) => {
      console.log(`funded: ${e.data.id} on ${e.data.offering} for ${e.data.amounts.committed}`);
    },
    "investment.changed": async (e) => {
      // Thin sync nudge — fetch the record rather than trusting the payload.
      console.log(`investment ${e.data.id} changed (${e.data.reason}); resync from your saved cursor`);
    },
    "offering.opened": async (e) => {
      console.log(`${e.data.company.name} is now open: ${e.data.offering}`);
    },
    default: (e) => console.log("unhandled event", e.event, e.id),
  });
  await markProcessed(event.id);
});

app.listen(3000, () => console.log("listening on :3000/webhooks/wefunder"));

// --- replace with your datastore ---
const seen = new Set<string>();
async function alreadyProcessed(id: string): Promise<boolean> {
  return seen.has(id);
}
async function markProcessed(id: string): Promise<void> {
  seen.add(id);
}
