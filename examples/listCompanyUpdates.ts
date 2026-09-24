// operationId: listCompanyUpdates — the company's Posts tab as data (read:public), one page at a time.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listCompanyUpdates
  const page = await wf.unwrap(wf.raw.listCompanyUpdates({ path: { id: "co_abc123Example" }, query: { per_page: 10 } }));
  for (const update of page.data ?? []) console.log(update.id, update.attributes?.title);
  console.log(page.meta?.next_cursor);
  // #endregion
  return page;
}
