// operationId: listIntents — intents created by the current token, filterable by status (read:syndicates).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listIntents
  // Which of my proposed actions are still waiting on human approval?
  const page = await wf.intents.list({ status: "pending" });
  for (const intent of page.data ?? []) {
    console.log(intent.id, intent.attributes?.action, intent.attributes?.review_url);
  }
  // #endregion
  return page;
}
