// operationId: searchCompanies — the site's search bar as an API (read:public).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region searchCompanies
  const results = await wf.unwrap(wf.raw.searchCompanies({ query: { q: "solar", limit: 5 } }));
  for (const hit of results.data ?? []) console.log(hit.id, hit.attributes?.name);
  // #endregion
  return results;
}
