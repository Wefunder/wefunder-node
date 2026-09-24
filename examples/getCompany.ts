// operationId: getCompany — a company's profile by co_ id (read:public). Shown via `wf.raw.*` + `wf.unwrap`.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getCompany
  const { data: company } = await wf.unwrap(wf.raw.getCompany({ path: { id: "co_abc123Example" } }));
  console.log(company?.attributes?.name);
  // #endregion
  return company;
}
