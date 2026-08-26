// operationId: listSyndicatePortfolioPositions — one page of a syndicate's
// aggregated positions (needs read:syndicates and portfolio access).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listSyndicatePortfolioPositions
  const page = await wf.unwrap(
    wf.raw.listSyndicatePortfolioPositions({
      path: { syndicate_id: "syn_example" },
      query: { status: "active", per_page: 25 },
    }),
  );
  for (const position of page.data ?? []) {
    console.log(position.id, position.attributes?.investor_count);
  }
  // #endregion
  return page;
}
