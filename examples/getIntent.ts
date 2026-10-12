// operationId: getIntent — poll an intent for approval after proposing it (read:syndicates).
// Prefer subscribing to `intent.*` webhook events over polling where possible.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getIntent
  const intent = await wf.intents.get("int_aB3xQ9k2vF8mNp1zT5wY7Qc4");
  console.log(intent.attributes?.status); // pending | approved | executed | expired | rejected | failed
  // #endregion
  return intent;
}
