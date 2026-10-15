// operationId: listReferralCodes — your app's referral codes (read:referral_codes; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listReferralCodes
  for await (const code of wf.referralCodes.all({ active: true })) {
    console.log(code.id, code.attributes?.label);
  }
  // #endregion
}
