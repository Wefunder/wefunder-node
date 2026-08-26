// operationId: getSyndicatePortfolio — aggregate a syndicate's portfolio
// (needs read:syndicates and portfolio access).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getSyndicatePortfolio
  const { data: summary } = await wf.unwrap(
    wf.raw.getSyndicatePortfolio({
      path: { syndicate_id: "syn_example" },
    }),
  );
  console.log(summary?.attributes?.total_current_value_cents);
  // #endregion
  return summary;
}
