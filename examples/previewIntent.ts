// operationId: previewIntent — dry-run every check `POST /intents` performs without minting one, and see the
// impact summary a reviewer would (any proposing scope, or read:explore).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region previewIntent
  const preview = await wf.unwrap(
    wf.raw.previewIntent({
      body: {
        action_name: "syndicates.remove_member",
        resource_type: "Club",
        resource_id: "syn_aB3xQ9k2vF8mNp1zT5wY7Qc4",
        params: { member_id: "mem_7Hk2mP9qR4sT1uV6wX8yZ3aB" },
      },
    }),
  );
  console.log(preview);
  // #endregion
  return preview;
}
