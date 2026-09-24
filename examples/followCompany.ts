// operationId: followCompany — follow a company on the user's behalf (write:follows). Idempotent.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region followCompany
  const result = await wf.unwrap(wf.raw.followCompany({ path: { company_id: "co_abc123Example" } }));
  console.log(result);
  // #endregion
  return result;
}
