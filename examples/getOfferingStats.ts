// operationId: getOfferingStats — aggregate stats for one offering (read:public).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getOfferingStats
  const stats = await wf.offerings.stats("ofr_QfmTyP8qjfYAvkEgREyL3kLf");
  console.log(stats.total?.count, stats.total?.raised_cents, stats.by_status);
  // #endregion
  return stats;
}
