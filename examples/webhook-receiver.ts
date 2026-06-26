// Receive + verify Wefunder webhook deliveries.
// Run: WEFUNDER_WEBHOOK_SECRET=... npx tsx examples/webhook-receiver.ts
import express from "express";
import { constructEvent } from "@wefunder/sdk";

const secret = process.env.WEFUNDER_WEBHOOK_SECRET!;
const app = express();

// IMPORTANT: verify against the RAW body bytes, so use express.raw (not express.json).
app.post("/webhooks/wefunder", express.raw({ type: "*/*" }), (req, res) => {
  let event;
  try {
    event = constructEvent(req.body.toString("utf8"), req.headers, secret);
  } catch (err) {
    console.warn("rejected webhook:", (err as Error).message);
    return res.status(400).send("invalid signature");
  }

  switch (event.event) {
    case "investment.created":
      console.log("new investment", event.data);
      break;
    default:
      console.log("event", event.event, event.deliveryId);
  }
  res.sendStatus(200); // ack fast; do work async
});

app.listen(3000, () => console.log("listening on :3000/webhooks/wefunder"));
