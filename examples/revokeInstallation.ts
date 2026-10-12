// operationId: revokeInstallation — revoke an installation (write:installations). Its tokens stop working
// at once and the company drops out of your webhook audiences.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region revokeInstallation
  const revoked = await wf.installations.revoke("inst_7hQExampleInstall01");
  console.log(revoked.attributes?.status); // "revoked"
  // #endregion
  return revoked;
}
