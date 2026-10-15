// operationId: getReferralCodeStats — weekly cohorts per company for one code (read:referral_codes; beta).
// Investors are never identified: rows carry opaque per-app tokens and amount tiers.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getReferralCodeStats
  const stats = await wf.referralCodes.stats("ref_7hQExampleCode00001");
  for (const company of stats.data?.attributes?.companies ?? []) {
    console.log(company.company, company.level, company.weeks?.length, "weekly cohort(s)");
  }
  // #endregion
  return stats;
}
