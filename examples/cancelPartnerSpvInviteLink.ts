// operationId: cancelPartnerSpvInviteLink — soft-cancel a link so its URL stops working
// (write:invite_links). Engagement history is preserved; idempotent.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region cancelPartnerSpvInviteLink
  const link = await wf.partner.spvs.inviteLinks.cancel("ofr_demoSpv", "il_demoLink");
  console.log(link.attributes?.active, link.attributes?.status); // false, "revoked"
  // #endregion
  return link;
}
