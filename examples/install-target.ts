// Guide: act for a company or syndicate. `wf` holds a MANAGER's user token with
// `read:installations write:installations` (listing needs the read scope; write does not
// imply it). Install, then mint the installation's own token — it has no expiry and no
// refresh; revoking the install revokes it.
import { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder, syndicateId = "syn_abc123Example") {
  // #region guides/install-target
  // 1. Which companies / syndicates may this user install on? (Only those — an investor's
  //    empty list is not a failure.)
  const targets = await wf.installations.eligibleTargets({
    target_type: "syndicate",
  });
  for (const t of targets)
    console.log(t.id, t.name, t.installed ? "(already installed)" : "");

  // 2. Install. The response carries the install (`data`) AND its token. If the app is
  //    already installed here the API answers 409 `already_installed`; installOrMintToken
  //    mints a fresh token for that existing install instead, re-requesting the same scopes.
  //    Any other error (revoked install, missing scope) still throws.
  const installed = await wf.installations.installOrMintToken({
    target_type: "syndicate",
    target_id: syndicateId,
    scopes: ["read:syndicates"],
  });
  const installationToken = installed.token?.access_token; // shown once — store it
  if (!installationToken) throw new Error("no installation token returned");

  // 3. First request AS the installation.
  const asSyndicate = new Wefunder({ accessToken: installationToken });
  const deals = await asSyndicate.unwrap(
    asSyndicate.raw.listSyndicateDeals({ path: { syndicate_id: syndicateId } }),
  );
  console.log(deals.data?.length, "deals");
  // #endregion
  return deals;
}
