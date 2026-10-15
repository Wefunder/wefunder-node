// operationId: getSyndicateJoinSession — the state of one join session (read:syndicates; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getSyndicateJoinSession
  const session = await wf.joinSessions.get("syn_aB3xQ9k2vF8mNp1zT5wY7Qc4", "js_7hQExampleSession001");
  console.log(session.attributes.status, session.attributes.ineligible_reason);
  // #endregion
  return session;
}
