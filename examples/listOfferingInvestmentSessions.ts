// operationId: listOfferingInvestmentSessions — one offering's investment sessions (read:investment_sessions; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listOfferingInvestmentSessions
  const page = await wf.investmentSessions.listForOffering("ofr_2nVb8KxQ4tLm9RcW7pHs3FdY", { status: "completed" });
  for (const session of page.data ?? []) console.log(session.id, session.attributes?.status);
  // #endregion
  return page;
}
