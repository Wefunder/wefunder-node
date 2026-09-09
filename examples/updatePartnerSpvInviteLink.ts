// operationId: updatePartnerSpvInviteLink — change a link's terms (write:invite_links). Only
// `allocation_cents` and `max_uses` are mutable; recipient/reuse/token cannot change.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region updatePartnerSpvInviteLink
  const link = await wf.partner.spvs.inviteLinks.update("ofr_demoSpv", "il_demoLink", {
    allocation_cents: 50_000_000,
    max_uses: 50,
  });
  console.log(link.attributes?.allocation_cents, link.attributes?.max_uses);
  // #endregion
  return link;
}
