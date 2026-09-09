// operationId: createPartnerSpvInviteLink — one endpoint, two shapes (write:invite_links).
// No recipient → a reusable, shareable link (optional budget + max_uses). An `email` or
// `wefunder_user_id` → a per-person invite. Idempotent via an idempotency key.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createPartnerSpvInviteLink
  // A reusable link with a $250k budget cap, usable up to 25 times:
  const reusable = await wf.partner.spvs.inviteLinks.create("ofr_demoSpv", {
    allocation_cents: 25_000_000,
    max_uses: 25,
  });
  console.log(reusable.attributes?.url);

  // A per-person invite, emailed to one recipient:
  const perPerson = await wf.partner.spvs.inviteLinks.create(
    "ofr_demoSpv",
    { email: "investor@example.com", first_name: "Ada", send_email: true },
    { idempotencyKey: "invite-ada" },
  );
  console.log(perPerson.id, perPerson.attributes?.status);
  // #endregion
  return { reusable, perPerson };
}
