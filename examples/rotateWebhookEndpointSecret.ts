// operationId: rotateWebhookEndpointSecret — roll the signing secret with zero dropped events (write:webhooks).
// For 24h deliveries carry a `v1` for BOTH secrets; constructEvent() accepts either, so deploy the
// new secret to your servers at your own pace inside that window.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region rotateWebhookEndpointSecret
  const endpoint = await wf.webhookEndpoints.rotateSecret("whe_8f3ExampleEndpoint00");
  const newSecret = endpoint.attributes?.secret; // shown once
  console.log(newSecret);
  // #endregion
  return endpoint;
}
