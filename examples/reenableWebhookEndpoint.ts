// operationId: reenableWebhookEndpoint — recover an endpoint that was auto-disabled after sustained failures
// (write:webhooks). Fix your server first; this is idempotent.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region reenableWebhookEndpoint
  const endpoint = await wf.webhookEndpoints.reenable("whe_8f3ExampleEndpoint00");
  console.log(endpoint.attributes?.enabled); // true
  // #endregion
  return endpoint;
}
