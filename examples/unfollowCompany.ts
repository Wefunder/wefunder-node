// operationId: unfollowCompany — unfollow a company on the user's behalf (write:follows). Idempotent.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region unfollowCompany
  const result = await wf.unwrap(wf.raw.unfollowCompany({ path: { company_id: "co_abc123Example" } }));
  console.log(result);
  // #endregion
  return result;
}
