// operationId: deleteWebhookSubscription — deactivate a subscription (read:attribution:anonymized,
// Tier 1+). It stops receiving events; delivery history is retained for 7 days.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region deleteWebhookSubscription
  await wf.unwrap(wf.raw.deleteWebhookSubscription({ path: { campaign_id: 1234, webhook_id: 56 } }));
  // #endregion
}
