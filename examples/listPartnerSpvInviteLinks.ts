// operationId: listPartnerSpvInviteLinks — all invite links for an SPV, reusable and
// per-person, newest first (read:invite_links).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listPartnerSpvInviteLinks
  const page = await wf.partner.spvs.inviteLinks.list("ofr_demoSpv");
  for (const link of page.data ?? []) {
    console.log(link.id, link.attributes?.url, link.attributes?.status);
  }
  // #endregion
  return page;
}
