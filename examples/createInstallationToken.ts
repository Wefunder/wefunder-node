// operationId: createInstallationToken — mint a company-owned token for an install a founder made
// (write:installations). An explicit empty `scopes` grants nothing; omit it for the install's ceiling.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createInstallationToken
  const token = await wf.unwrap(
    wf.raw.createInstallationToken({ path: { external_id: "ins_9t2xExample" }, body: { scopes: ["read:investments"] } }),
  );
  console.log(token.data);
  // #endregion
  return token;
}
