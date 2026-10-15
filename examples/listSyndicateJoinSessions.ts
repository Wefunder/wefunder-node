// operationId: listSyndicateJoinSessions — your syndicate's join sessions (read:syndicates; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listSyndicateJoinSessions
  for await (const session of wf.joinSessions.all("syn_aB3xQ9k2vF8mNp1zT5wY7Qc4")) {
    console.log(session.id, session.attributes.status, session.attributes.email);
  }
  // #endregion

}
