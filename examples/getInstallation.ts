// operationId: getInstallation — one installation by id (read:installations).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getInstallation
  const install = await wf.installations.get("ins_9t2xExample");
  console.log(install.attributes);
  // #endregion
  return install;
}
