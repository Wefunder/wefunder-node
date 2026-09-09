// operationId: closePartnerSpv — begin closing an open SPV (write:offerings). This mints a
// disburse intent a Wefunder advisor must approve to finalize; hand `intent.review_url` to
// them. Repeated calls return the same pending intent. 422 if there's nothing to disburse.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region closePartnerSpv
  const { spv, intent } = await wf.partner.spvs.close("ofr_demoSpv");
  console.log(spv.attributes?.status); // "closing"
  console.log(intent?.review_url); // advisor approval link
  // #endregion
  return { spv, intent };
}
