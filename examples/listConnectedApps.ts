// operationId: listConnectedApps — OAuth apps the user has authorized, with summary stats (read:profile).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listConnectedApps
  const apps = await wf.unwrap(wf.raw.listConnectedApps());
  for (const app of apps.data ?? []) {
    console.log(app.id, app.attributes?.name);
  }
  // #endregion
  return apps;
}
