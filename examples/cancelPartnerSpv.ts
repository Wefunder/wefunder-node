// operationId: cancelPartnerSpv — abort a draft/open SPV and refund investors
// (write:offerings). Dangerous + irreversible, so it mints a cancel intent an advisor must
// approve; the abort/refunds run on approval, not immediately. Hand over `intent.review_url`.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region cancelPartnerSpv
  const { spv, intent } = await wf.partner.spvs.cancel("ofr_demoSpv", {
    reason: "Lead investor withdrew",
  });
  console.log(spv.attributes?.status, intent?.review_url);
  // #endregion
  return { spv, intent };
}
