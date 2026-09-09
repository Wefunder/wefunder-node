// operationId: getPartnerSpvInviteLink — one invite link, including its engagement event
// timeline (read:invite_links).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getPartnerSpvInviteLink
  const link = await wf.partner.spvs.inviteLinks.get("ofr_demoSpv", "il_demoLink");
  console.log(link.attributes?.status, link.attributes?.uses_count);
  for (const event of link.attributes?.events ?? []) {
    console.log(event.event, event.created_at);
  }
  // #endregion
  return link;
}
