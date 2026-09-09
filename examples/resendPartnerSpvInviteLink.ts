// operationId: resendPartnerSpvInviteLink — re-send a per-person invite's email and record a
// `resend` event (write:invite_links). Rejected for reusable/canceled links or a recipient
// who declined or reported spam.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region resendPartnerSpvInviteLink
  const link = await wf.partner.spvs.inviteLinks.resend("ofr_demoSpv", "il_demoLink");
  console.log(link.attributes?.events?.map((e) => e.event));
  // #endregion
  return link;
}
