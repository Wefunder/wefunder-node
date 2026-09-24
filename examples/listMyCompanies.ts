// operationId: listMyCompanies — companies the authorized user can edit (read:profile).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listMyCompanies
  const companies = await wf.unwrap(wf.raw.listMyCompanies());
  for (const company of companies.data ?? []) console.log(company.id, company.attributes?.name);
  // #endregion
  return companies;
}
