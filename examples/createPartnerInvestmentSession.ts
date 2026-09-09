// operationId: createPartnerInvestmentSession — a single-use hosted investment session
// (like a Stripe Checkout Session) on the SPV named by `spv_id`
// (write:investment_sessions + write:offerings). It walks one investor through
// accreditation, signing, and payment. Returns a `url` the recipient opens.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createPartnerInvestmentSession
  const session = await wf.partner.investmentSessions.create(
    {
      spv_id: "ofr_demoSpv",
      email: "investor@example.com",
      allocation_cents: 500_000, // lock the checkout to exactly $5,000
      success_url: "https://partner.example.com/thanks",
    },
    { idempotencyKey: "session-investor-acme" },
  );
  console.log(session.attributes?.url); // send this to the recipient
  // #endregion
  return session;
}
