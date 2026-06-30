// operationId: getOffering — fetch one offering by its external id (read:public).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getOffering
  const offering = await wf.offerings.get("ofr_QfmTyP8qjfYAvkEgREyL3kLf");
  console.log(offering.attributes?.company_name, offering.attributes?.state);
  // #endregion
  return offering;
}
