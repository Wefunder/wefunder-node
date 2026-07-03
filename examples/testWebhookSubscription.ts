// operationId: testWebhookSubscription — send a test event to verify your endpoint + signature
// handling (read:attribution:anonymized, Tier 1+). The payload carries `"event": "test"`.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region testWebhookSubscription
  const result = await wf.unwrap(
    wf.raw.testWebhookSubscription({ path: { campaign_id: 1234, webhook_id: 56 } }),
  );
  console.log(result.data);
  // #endregion
  return result;
}
