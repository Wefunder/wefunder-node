// operationId: listInvestmentSessions — every investment session your app created (read:investment_sessions; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listInvestmentSessions
  for await (const session of wf.investmentSessions.all({ status: "in_progress" })) {
    console.log(session.id, session.attributes?.status);
  }
  // #endregion

}
