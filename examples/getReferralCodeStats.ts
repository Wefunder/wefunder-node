// operationId: getReferralCodeStats — what one code produced, per company (read:referral_codes; beta).
// Each company's `level` decides the shape: `counts` carries weekly cohorts in `weeks`; `anonymized`
// and `full` carry per-investment rows in `investments` instead (`full` includes investor names and
// emails and needs a founder-tier installation grant on that company).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getReferralCodeStats
  const stats = await wf.referralCodes.stats("ref_7hQExampleCode00001");
  for (const company of stats.data?.attributes?.companies ?? []) {
    if (company.level === "counts") {
      console.log(company.company, company.weeks?.length, "weekly cohort(s)");
    } else {
      console.log(company.company, company.level, company.investments?.length, "investment row(s)");
    }
  }
  // #endregion
  return stats;
}
