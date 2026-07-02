// operationId: getSyndicate — full syndicate details incl. settings + summary metrics (read:syndicates).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getSyndicate
  const syndicate = await wf.syndicates.get(42);
  console.log(syndicate.attributes?.name, syndicate.attributes?.deal_count);
  // #endregion
  return syndicate;
}
