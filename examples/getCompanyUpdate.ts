// operationId: getCompanyUpdate — one founder update in full (read:public).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getCompanyUpdate
  const { data: update } = await wf.unwrap(
    wf.raw.getCompanyUpdate({ path: { id: "co_abc123Example", update_id: "upd_9t2xExample" } }),
  );
  console.log(update?.attributes?.title);
  // #endregion
  return update;
}
