// operationId: listFollowedCompanies — the user's watchlist (read:profile).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listFollowedCompanies
  const page = await wf.unwrap(wf.raw.listFollowedCompanies({ query: { per_page: 25 } }));
  for (const company of page.data ?? []) console.log(company.id);
  // #endregion
  return page;
}
