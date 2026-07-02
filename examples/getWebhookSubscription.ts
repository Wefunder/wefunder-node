// operationId: getWebhookSubscription — one subscription incl. recent delivery history
// (read:attribution:anonymized, Tier 1+). Useful for debugging a quiet endpoint.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getWebhookSubscription
  const subscription = await wf.unwrap(
    wf.raw.getWebhookSubscription({ path: { campaign_id: 1234, webhook_id: 56 } }),
  );
  console.log(subscription.data);
  // #endregion
  return subscription;
}
