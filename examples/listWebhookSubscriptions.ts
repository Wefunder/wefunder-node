// operationId: listWebhookSubscriptions — active webhook subscriptions your app holds on a
// campaign (read:attribution:anonymized, Tier 1+).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listWebhookSubscriptions
  const subscriptions = await wf.unwrap(
    wf.raw.listWebhookSubscriptions({ path: { campaign_id: 1234 } }),
  );
  for (const sub of subscriptions.data ?? []) {
    console.log(sub.id, sub.target_url, sub.events, sub.active);
  }
  // #endregion
  return subscriptions;
}
