// operationId: openPartnerSpv — move a draft SPV to `open` so it can accept investments
// (write:offerings). On success the SPV gains an `invest_url`.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region openPartnerSpv
  const spv = await wf.partner.spvs.open("ofr_demoSpv");
  console.log(spv.attributes?.status, spv.attributes?.invest_url);
  // #endregion
  return spv;
}
