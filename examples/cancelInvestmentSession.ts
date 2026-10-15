// operationId: cancelInvestmentSession — cancel a session the recipient has not completed (write:investment_sessions; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region cancelInvestmentSession
  const session = await wf.investmentSessions.cancel("is_7hQExampleSession001");
  console.log(session.attributes?.status); // "canceled"
  // #endregion
  return session;
}
