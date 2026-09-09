// operationId: listPartnerSpvInvestors — the SPV's investors, aggregated one row per
// investor: the cap-table view (read:offerings). Name/email are null unless the token also
// holds read:investors:pii.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listPartnerSpvInvestors
  for await (const investor of wf.partner.spvs.investors.all("ofr_demoSpv")) {
    console.log(
      investor.id,
      investor.attributes?.total_invested_cents,
      investor.attributes?.investment_count,
    );
  }
  // #endregion
}
