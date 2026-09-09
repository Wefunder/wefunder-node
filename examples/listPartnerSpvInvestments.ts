// operationId: listPartnerSpvInvestments — every investment into an SPV, one row each
// (read:offerings). Investor name/email are null unless the token also holds
// read:investors:pii.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listPartnerSpvInvestments
  const page = await wf.partner.spvs.investments.list("ofr_demoSpv", { per_page: 50 });
  for (const investment of page.data ?? []) {
    console.log(investment.attributes?.amount_cents, investment.attributes?.status);
  }

  // Or collect every investment across all pages:
  const all = await wf.partner.spvs.investments.collect("ofr_demoSpv");
  console.log(`${all.length} investments`);
  // #endregion
  return page;
}
