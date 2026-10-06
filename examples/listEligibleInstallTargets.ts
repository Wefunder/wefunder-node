// operationId: listEligibleInstallTargets — companies or syndicates the token's user could install your app on
// (read:installations). An investor's empty list is not a failure.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listEligibleInstallTargets
  const targets = await wf.installations.eligibleTargets({
    target_type: "company",
  });
  for (const target of targets)
    console.log(target.id, target.name, target.tier, target.installed);
  // #endregion
  return targets;
}
