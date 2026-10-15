// operationId: getInvestmentSession — one investment session by id (read:investment_sessions; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getInvestmentSession
  const session = await wf.investmentSessions.get("is_7hQExampleSession001");
  console.log(session.attributes?.status);
  // #endregion
  return session;
}
