// operationId: createOfferingMemberLink — mint a member's link to one deal page (write:invite_links).
// Needs a company- or syndicate-owned token of an app installed on the offering's syndicate or company.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createOfferingMemberLink
  // `reference` is your member id. Repeating it returns the live link instead of a second one;
  // the idempotency key makes a retried request safe as well.
  const link = await wf.memberLinks.create(
    "ofr_2nVb8KxQ4tLm9RcW7pHs3FdY",
    { reference: "member_8812" },
    { idempotencyKey: "member_8812-ofr_2nVb8KxQ4tLm9RcW7pHs3FdY" },
  );
  console.log(link.attributes?.url); // send this to the member; it carries no email
  // #endregion
  return link;
}
