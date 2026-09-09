// operationId: getPartnerSpvStatus — lifecycle status plus orthogonal progress flags:
// where the SPV is and what it's waiting on (read:offerings).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getPartnerSpvStatus
  const status = await wf.partner.spvs.status("ofr_demoSpv");
  console.log(
    status.attributes?.status,
    status.attributes?.requires_ops_review,
    status.attributes?.expected_disbursement_at,
  );
  // #endregion
  return status;
}
