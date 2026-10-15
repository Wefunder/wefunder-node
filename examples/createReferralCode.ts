// operationId: createReferralCode — mint a code with your app's server key (write:referral_codes; beta).
// Add it to any wefunder.com link as `?wfr=ref_…`. Not idempotent: a retried create can mint a
// second code, which you can deactivate.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createReferralCode
  const code = await wf.referralCodes.create({
    label: "October newsletter",
    company_id: "co_7hQExampleCompany0001", // omit to credit any company
    utm: { source: "newsletter", campaign: "october" },
  });
  console.log(code.id, code.attributes?.link_parameter); // e.g. "wfr=ref_…" — append to any wefunder.com link
  // #endregion
  return code;
}
