// Guide: act for a company or syndicate. `wf` holds a MANAGER's user token with
// `read:installations write:installations` (listing needs the read scope; write does not
// imply it). Install, then mint the installation's own token — it has no expiry and no
// refresh; revoking the install revokes it.
import { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder, syndicateId = "syn_abc123Example") {
  // #region guides/install-target
  // 1. Which companies / syndicates may this user install on? (Only those — an investor's
  //    empty list is not a failure.)
  const targets = await wf.unwrap(wf.raw.listEligibleInstallTargets({ query: { target_type: "syndicate" } }));
  for (const t of targets.data ?? []) console.log(t.id, t.name, t.installed ? "(already installed)" : "");

  // 2. Install on one of them. The response carries the install (`data`) AND its token.
  const installed = await wf.unwrap(
    wf.raw.createInstallation({
      body: { target_type: "syndicate", target_id: syndicateId, scopes: ["read:syndicates"] },
    }),
  );
  let installationToken = installed.token?.access_token;

  // 3. Already installed (or the token wasn't kept)? Find the ACTIVE install on this target —
  //    the list is newest-first and includes revoked rows and user installs, so match on
  //    target + status, never on position — and mint a fresh token.
  if (!installationToken) {
    const installs = await wf.unwrap(wf.raw.listInstallations());
    const install = (installs.data ?? []).find(
      (i) => i.attributes?.status === "active" && i.attributes?.target?.id === syndicateId,
    );
    if (!install?.id) throw new Error(`not installed on ${syndicateId} yet`);
    const minted = await wf.unwrap(wf.raw.createInstallationToken({ path: { external_id: install.id } }));
    installationToken = minted.token?.access_token; // shown once — store it
  }

  // 4. First request AS the installation.
  const asSyndicate = new Wefunder({ accessToken: installationToken! });
  const deals = await asSyndicate.unwrap(asSyndicate.raw.listSyndicateDeals({ path: { syndicate_id: syndicateId } }));
  console.log(deals.data?.length, "deals");
  // #endregion
  return deals;
}
