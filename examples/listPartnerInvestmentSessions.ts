// operationId: listPartnerInvestmentSessions — your org's investment sessions across all
// SPVs, newest first (read:investment_sessions). Filter by `spv_id` and/or `status`.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listPartnerInvestmentSessions
  const page = await wf.partner.investmentSessions.list({
    spv_id: "ofr_demoSpv",
    status: "completed",
  });
  for (const session of page.data ?? []) {
    console.log(session.id, session.attributes?.status, session.attributes?.investment_id);
  }
  // #endregion
  return page;
}
