// operationId: getPartnerSpv — full details and live metrics for one SPV (read:offerings).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getPartnerSpv
  const spv = await wf.partner.spvs.get("ofr_demoSpv");
  console.log(spv.attributes?.status, spv.attributes?.metrics?.total_raised_cents);
  // #endregion
  return spv;
}
