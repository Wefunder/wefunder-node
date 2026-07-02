// operationId: listSyndicates — syndicates the authenticated user can manage (read:syndicates).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listSyndicates
  const page = await wf.syndicates.list({ limit: 50 });
  for (const syndicate of page.data ?? []) {
    console.log(syndicate.id, syndicate.attributes?.name, syndicate.attributes?.member_count);
  }
  // #endregion
  return page;
}
