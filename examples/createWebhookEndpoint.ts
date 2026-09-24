// operationId: createWebhookEndpoint — register a receiver for platform events (write:webhooks, org
// owner/admin/developer). Manage endpoints through the LIVE API; `mode: "test"` receivers are
// mirrored into sandbox. The secret is returned ONLY here and on rotate.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createWebhookEndpoint
  const endpoint = await wf.webhookEndpoints.create({
    url: "https://yourapp.com/webhooks/wefunder", // public HTTPS (localhost/private IPs rejected)
    events: ["offering.opened", "investment.executed", "investment.changed"],
    mode: "live",
  });
  // Store this now — it's needed by constructEvent() and is never shown again.
  const signingSecret = endpoint.attributes?.secret;
  console.log(endpoint.id, signingSecret);
  // #endregion
  return endpoint;
}
