// operationId: listWebhookEndpoints — your app's endpoints, secret omitted (read:webhooks).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listWebhookEndpoints
  const { data: endpoints, meta } = await wf.webhookEndpoints.list();
  console.log(`${endpoints?.length} of ${meta?.quota} endpoint slots used`);
  for (const ep of endpoints ?? []) {
    console.log(ep.id, ep.attributes?.url, ep.attributes?.enabled, ep.attributes?.last_delivery_status);
  }
  // #endregion
  return endpoints;
}
