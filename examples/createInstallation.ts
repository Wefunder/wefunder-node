// operationId: createInstallation — install your app on a company or syndicate the user can edit
// (write:installations) and receive the company-owned token the install stands for.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createInstallation
  const install = await wf.unwrap(
    wf.raw.createInstallation({
      body: { target_type: "company", target_id: "co_abc123Example", scopes: ["read:offerings", "read:investments"] },
    }),
  );
  console.log(install.data?.id, install.data?.attributes);
  // #endregion
  return install;
}
