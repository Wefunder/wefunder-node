// operationId: listCampaigns — fundraising campaigns where the token's user is a founder (read:offerings).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listCampaigns
  // Campaigns for companies where the authenticated user is a founder.
  const page = await wf.campaigns.list();
  for (const campaign of page.data ?? []) {
    console.log(campaign.id, campaign.attributes?.company_name, campaign.attributes?.amount_raised);
  }

  // Or stream every campaign lazily, one page fetched at a time:
  for await (const campaign of wf.campaigns.all()) {
    console.log(campaign.attributes?.state);
  }
  // #endregion
  return page;
}
