// operationId: createWebhookSubscription — an operation with no ergonomic namespace,
// shown via the `wf.raw.*` escape hatch + `wf.unwrap` (same typed-error + envelope
// handling the namespaces use). Needs the attribution tier + write scope.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createWebhookSubscription
  const subscription = await wf.unwrap(
    wf.raw.createWebhookSubscription({
      path: { campaign_id: 1234 },
      body: {
        target_url: "https://example.com/wefunder/webhooks",
        events: ["investment.confirmed", "investment.canceled"],
      },
    }),
  );
  console.log(subscription);
  // #endregion
  return subscription;
}
