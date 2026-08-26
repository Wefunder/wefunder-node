// operationId: getPortfolio — summary of the authenticated user's portfolio
// (needs authorization_code + read:investments).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getPortfolio
  const summary = await wf.portfolio.get();
  console.log(
    summary.attributes?.total_current_value_cents,
    summary.attributes?.return_multiple,
  );
  // #endregion
  return summary;
}
