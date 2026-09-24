// operationId: previewIntent — dry-run every check `POST /intents` performs without minting one, and see the
// impact summary a reviewer would (any proposing scope, or read:explore).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region previewIntent
  const preview = await wf.unwrap(
    wf.raw.previewIntent({
      body: {
        action_name: "syndicates.close_deal",
        resource_type: "Club",
        resource_id: "syn_example",
        params: { fundraise_id: 99 },
      },
    }),
  );
  console.log(preview);
  // #endregion
  return preview;
}
