// operationId: getAttributionMe — the user's marketing-partner profile + connected campaigns
// (read:attribution:aggregate). `partner` is null until registerAsPartner has been called.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getAttributionMe
  const me = await wf.attribution.me();
  console.log(me);
  // #endregion
  return me;
}
