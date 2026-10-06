// operationId: createInstallationToken — mint a company-owned token for an install a founder made
// (write:installations). An explicit empty `scopes` grants nothing; omit it for the install's ceiling.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createInstallationToken
  const minted = await wf.installations.mintToken("ins_9t2xExample", [
    "read:investments",
  ]);
  console.log(minted.token?.access_token); // shown once — store it
  // #endregion
  return minted;
}
