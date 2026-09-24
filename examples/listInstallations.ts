// operationId: listInstallations — where your app is installed (read:installations). An installation is what
// makes a company/syndicate an AUDIENCE for your webhooks — no install, no deliveries.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listInstallations
  const installs = await wf.unwrap(wf.raw.listInstallations());
  for (const install of installs.data ?? []) console.log(install.id, install.attributes);
  // #endregion
  return installs;
}
