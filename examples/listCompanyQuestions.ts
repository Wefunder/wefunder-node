// operationId: listCompanyQuestions — the Ask tab as data (read:public): sort, full-text search with `q`, or
// just the founder's unanswered queue.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listCompanyQuestions
  const page = await wf.unwrap(
    wf.raw.listCompanyQuestions({
      path: { id: "co_abc123Example" },
      query: { q: "revenue", unanswered_by_team: true, per_page: 20 },
    }),
  );
  for (const question of page.data ?? []) console.log(question.id, question.attributes);
  // #endregion
  return page;
}
