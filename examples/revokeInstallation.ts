// operationId: revokeInstallation — revoke an installation (write:installations). Its tokens stop working
// at once and the company drops out of your webhook audiences.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region revokeInstallation
  const result = await wf.unwrap(wf.raw.revokeInstallation({ path: { external_id: "ins_9t2xExample" } }));
  console.log(result);
  // #endregion
  return result;
}
