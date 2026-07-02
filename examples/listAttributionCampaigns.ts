// operationId: listAttributionCampaigns — campaigns the user can access for attribution data
// (read:attribution:aggregate). Founders see their own; marketing partners see granted ones.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listAttributionCampaigns
  const campaigns = await wf.unwrap(wf.raw.listAttributionCampaigns());
  console.log(campaigns.data);
  // #endregion
  return campaigns;
}
