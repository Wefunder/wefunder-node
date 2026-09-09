// operationId: createPartnerSpv — spawn a draft SPV; Wefunder handles entity formation,
// docs, payment rails, and compliance (write:offerings). Pass an idempotency key to make
// the create safe to retry.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createPartnerSpv
  const spv = await wf.partner.spvs.create(
    {
      name: "Acme Ventures — Series A SPV",
      target_company: { name: "Acme Robotics", state_of_incorporation: "DE" },
      terms: {
        structure: "safe",
        safe_type: "post_money",
        valuation_cap_cents: 2_000_000_000,
        minimum_investment_cents: 100_000,
        target_raise_cents: 50_000_000,
      },
    },
    { idempotencyKey: "acme-series-a-spv" },
  );
  // Draft — call open() before it can accept investments.
  console.log(spv.id, spv.attributes?.status);
  // #endregion
  return spv;
}
