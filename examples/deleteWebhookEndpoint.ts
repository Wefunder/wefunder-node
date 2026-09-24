// operationId: deleteWebhookEndpoint — stop deliveries immediately (write:webhooks). Removal is permanent —
// create a new endpoint to resume.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region deleteWebhookEndpoint
  const result = await wf.webhookEndpoints.remove("whe_8f3ExampleEndpoint00");
  console.log(result.removed); // true
  // #endregion
  return result;
}
