// operationId: getCompanyDisclosures — Form C disclosure sections for a company (read:public). Pick sections
// to keep the payload small.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getCompanyDisclosures
  const { data: disclosures } = await wf.unwrap(
    wf.raw.getCompanyDisclosures({
      path: { id: "co_abc123Example" },
      query: { sections: ["business", "risks", "use_of_funds"] },
    }),
  );
  console.log(disclosures?.attributes);
  // #endregion
  return disclosures;
}
