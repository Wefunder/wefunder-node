// operationId: updateReferralCode — relabel, retarget UTM, or deactivate a code (write:referral_codes; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region updateReferralCode
  const code = await wf.referralCodes.update("ref_7hQExampleCode00001", { active: false });
  console.log(code.attributes?.active); // false — the link keeps resolving, nothing new is credited
  // #endregion
  return code;
}
