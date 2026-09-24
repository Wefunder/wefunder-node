// operationId: listEligibleInstallTargets — companies or syndicates the token's user could install your app on
// (read:installations).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listEligibleInstallTargets
  const targets = await wf.unwrap(wf.raw.listEligibleInstallTargets({ query: { target_type: "company" } }));
  for (const target of targets.data ?? []) console.log(target);
  // #endregion
  return targets;
}
