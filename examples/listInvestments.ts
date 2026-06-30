// operationId: listInvestments — the authenticated user's investments
// (needs read:investments).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listInvestments
  // Auto-paginate the full history lazily:
  for await (const investment of wf.investments.all()) {
    console.log(investment.id);
  }

  // Or grab one page with its meta (next_cursor, etc.):
  const page = await wf.investments.list();
  console.log(page.data?.length, page.meta?.next_cursor);
  // #endregion
  return undefined;
}
