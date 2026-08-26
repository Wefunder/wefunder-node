// operationId: listPortfolioPositions — the authenticated user's aggregated
// positions (needs authorization_code + read:investments).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listPortfolioPositions
  for await (const position of wf.portfolio.positions.all({ status: "active" })) {
    console.log(
      position.id,
      position.attributes?.company?.name,
      position.attributes?.current_value_cents,
    );
  }
  // #endregion
  return undefined;
}
