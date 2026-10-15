// operationId: createSyndicateJoinSession — mint a hosted join session for one person (write:syndicate_members; beta).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createSyndicateJoinSession
  const session = await wf.joinSessions.create("syn_aB3xQ9k2vF8mNp1zT5wY7Qc4", {
    email: "member@example.com",
    name: "Ada Example",
    require_approval: true,
    success_url: "https://yourapp.example/joined",
  });
  console.log(session.attributes.url); // send the person here; the outcome arrives as join_session.* webhooks
  // #endregion
  return session;
}
