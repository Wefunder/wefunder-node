// operationId: getOfferingStats — aggregate stats for one offering (read:public).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getOfferingStats
  const { data: stats } = await wf.unwrap(
    wf.raw.getOfferingStats({ path: { offering_id: "ofr_QfmTyP8qjfYAvkEgREyL3kLf" } }),
  );
  console.log(stats);
  // #endregion
  return stats;
}
