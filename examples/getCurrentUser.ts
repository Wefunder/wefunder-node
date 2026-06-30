// operationId: getCurrentUser — the authenticated user (needs read:profile, a
// user-context scope; not reachable with a client_credentials token).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getCurrentUser
  const me = await wf.users.me();
  console.log("Logged in as", me.id);
  // #endregion
  return me;
}
