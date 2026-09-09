// operationId: bulkCreatePartnerSpvInviteLinks — create up to 100 per-person invites in one
// call (write:invite_links). Partial success: each item is independent, so the result
// carries created links in `data` and per-item failures in `errors` (each with its `index`).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region bulkCreatePartnerSpvInviteLinks
  const res = await wf.partner.spvs.inviteLinks.bulkCreate("ofr_demoSpv", {
    invite_links: [
      { email: "a@example.com", first_name: "Ada" },
      { email: "b@example.com", first_name: "Bob" },
    ],
  });
  console.log(`created ${res.meta?.created}, failed ${res.meta?.failed}`);
  for (const link of res.data ?? []) console.log(link.id, link.attributes?.email);
  for (const err of res.errors ?? []) console.log(`item ${err.index}: ${err.detail}`);
  // #endregion
  return res;
}
