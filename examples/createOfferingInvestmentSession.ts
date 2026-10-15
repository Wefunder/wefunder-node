// operationId: createOfferingInvestmentSession — put a known investor into checkout for one offering (write:investment_sessions; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createOfferingInvestmentSession
  const session = await wf.investmentSessions.create(
    "ofr_2nVb8KxQ4tLm9RcW7pHs3FdY",
    { email: "investor@example.com", allocation_cents: 250000, success_url: "https://yourapp.example/thanks" },
    { idempotencyKey: "investor@example.com-ofr_2nVb8KxQ4tLm9RcW7pHs3FdY" },
  );
  console.log(session.attributes?.url); // hand this to the investor
  // #endregion
  return session;
}
