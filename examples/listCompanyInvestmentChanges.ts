// operationId: listCompanyInvestmentChanges — the company-scoped Investment Delta feed
// (read:investments or read:companies; the user must be able to edit the company).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder, companyId = "co_abc123Example") {
  // #region listCompanyInvestmentChanges
  // Walk every change for one company. Persist meta.next_cursor after each page — it is
  // always present, even on the last page — and pass it back next sync for only what changed.
  let cursor: string | undefined;
  do {
    const page = await wf.unwrap(
      wf.raw.listCompanyInvestmentChanges({ path: { company_id: companyId }, query: { cursor, per_page: 50 } }),
    );
    for (const record of page.data ?? []) console.log(record.id, record.visible);
    cursor = page.meta?.next_cursor;
    if (!page.meta?.has_more) break;
  } while (cursor);
  // #endregion
  return cursor;
}
