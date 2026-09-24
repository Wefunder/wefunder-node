// operationId: getWebhookEndpoint — one endpoint by id (read:webhooks). `failing_since` is set while every
// delivery has been failing; `last_delivery_status` is an HTTP status or an error code.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getWebhookEndpoint
  const endpoint = await wf.webhookEndpoints.get("whe_8f3ExampleEndpoint00");
  console.log(endpoint.attributes?.events, endpoint.attributes?.failing_since);
  // #endregion
  return endpoint;
}
