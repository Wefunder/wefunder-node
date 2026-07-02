// operationId: listActivity — audit trail of actions taken by OAuth apps the user authorized
// (read:profile). Backs the user-facing Settings > Activity feed.
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listActivity
  // Everything my connected apps did to syndicate members, most recent first.
  const activity = await wf.unwrap(
    wf.raw.listActivity({
      query: { action_pattern: "syndicates.member.*", status: "success" },
    }),
  );
  for (const event of activity.data ?? []) {
    console.log(event.attributes?.action, event.attributes?.created_at);
  }
  // #endregion
  return activity;
}
