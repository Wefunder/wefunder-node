// operationId: listAttributedInvestments — attributed investments for a campaign
// (read:attribution:anonymized, Tier 1+). Marketing partners get anonymized rows (opaque
// investor tokens + amount tiers); founders can request `detail_level: "full"`.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listAttributedInvestments
  const investments = await wf.unwrap(
    wf.raw.listAttributedInvestments({
      path: { campaign_id: 1234 },
      query: { start_date: "2026-01-01", detail_level: "anonymized" },
    }),
  );
  for (const investment of investments.data ?? []) {
    if ("amount_tier" in investment) {
      // Anonymized row: opaque tokens + an amount tier, never exact values or PII.
      console.log(investment.investor_token, investment.amount_tier, investment.attribution?.utm_source);
    }
  }
  // #endregion
  return investments;
}
