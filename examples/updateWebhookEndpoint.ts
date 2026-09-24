// operationId: updateWebhookEndpoint — change the URL or subscriptions (write:webhooks). `events` REPLACES the
// list wholesale — send the full set you want, never a diff.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region updateWebhookEndpoint
  const endpoint = await wf.webhookEndpoints.update("whe_8f3ExampleEndpoint00", {
    events: ["offering.opened", "offering.closed", "investment.executed"],
  });
  console.log(endpoint.attributes?.events);
  // #endregion
  return endpoint;
}
