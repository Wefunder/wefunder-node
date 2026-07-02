// operationId: getAttributionStats — aggregate (Tier 0) attribution stats for a campaign
// (read:attribution:aggregate). Aggregate-only: no individual investor data.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getAttributionStats
  const stats = await wf.unwrap(
    wf.raw.getAttributionStats({
      path: { campaign_id: 1234 },
      query: { start_date: "2026-01-01", end_date: "2026-03-31", utm_source: "newsletter" },
    }),
  );
  console.log(stats.data);
  // #endregion
  return stats;
}
