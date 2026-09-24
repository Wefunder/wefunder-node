// operationId: getInvestment — the current record for one investment by its inv_ id (read:investments).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getInvestment
  const investment = await wf.investments.get("inv_8f3kQ2Example");
  console.log(investment.status, investment.amounts?.committed_cents, investment.investor?.id);
  // #endregion
  return investment;
}
