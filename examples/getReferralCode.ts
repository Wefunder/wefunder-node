// operationId: getReferralCode — one referral code by id (read:referral_codes; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getReferralCode
  const code = await wf.referralCodes.get("ref_7hQExampleCode00001");
  console.log(code.attributes?.label, code.attributes?.active);
  // #endregion
  return code;
}
