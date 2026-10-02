// Guide: act for a company or syndicate. `wf` holds a MANAGER's user token with
// `read:installations write:installations` (listing needs the read scope; write does not
// imply it). Install, then mint the installation's own token — it has no expiry and no
// refresh; revoking the install revokes it.
import { Wefunder, WefunderError } from "../src/index.js";

export async function example(wf: Wefunder, syndicateId = "syn_abc123Example") {
  // #region guides/install-target
  // 1. Which companies / syndicates may this user install on? (Only those — an investor's
  //    empty list is not a failure.)
  const targets = await wf.unwrap(
    wf.raw.listEligibleInstallTargets({ query: { target_type: "syndicate" } }),
  );
  for (const t of targets.data ?? [])
    console.log(t.id, t.name, t.installed ? "(already installed)" : "");

  // 2. Install. The response carries the install (`data`) AND its token. If the app is
  //    already installed here the API answers 409 `already_installed` — its `details.installation`
  //    is the existing install's id, so mint a fresh token for that instead. Any other error
  //    (revoked install, missing scope) still throws.
  let installationToken: string | undefined;
  try {
    const installed = await wf.unwrap(
      wf.raw.createInstallation({
        body: {
          target_type: "syndicate",
          target_id: syndicateId,
          scopes: ["read:syndicates"],
        },
      }),
    );
    installationToken = installed.token?.access_token;
  } catch (err) {
    if (!(err instanceof WefunderError) || err.type !== "already_installed")
      throw err;
    const existingId = (err.details as { installation?: string } | undefined)
      ?.installation;
    if (!existingId) throw err;
    const minted = await wf.unwrap(
      // same scopes as the create above — never widen on re-mint
      wf.raw.createInstallationToken({
        path: { external_id: existingId },
        body: { scopes: ["read:syndicates"] },
      }),
    );
    installationToken = minted.token?.access_token; // shown once — store it
  }
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
