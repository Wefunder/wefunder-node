// operationId: cancelPartnerInvestmentSession — cancel a session so its link stops working
// (write:investment_sessions). Valid while pending/in_progress/abandoned; a completed or
// expired session can't be canceled (422). Idempotent.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region cancelPartnerInvestmentSession
  const session = await wf.partner.investmentSessions.cancel("is_demoSession");
  console.log(session.attributes?.status); // "canceled"
  // #endregion
  return session;
}
