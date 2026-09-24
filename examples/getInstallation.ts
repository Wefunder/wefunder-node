// operationId: getInstallation — one installation by id (read:installations).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getInstallation
  const { data: install } = await wf.unwrap(wf.raw.getInstallation({ path: { external_id: "ins_9t2xExample" } }));
  console.log(install?.attributes);
  // #endregion
  return install;
}
