// operationId: createIntent — propose a dangerous/irreversible action for human approval
// (write:syndicates). The proposer can never approve its own intent; a human approves it
// at `review_url` on Wefunder. Shown via `wf.raw.*` + `wf.unwrap` (no ergonomic namespace).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region createIntent
  const { data: intent } = await wf.unwrap(
    wf.raw.createIntent({
      body: {
        action_name: "syndicates.remove_member",
        resource_type: "Club",
        resource_id: "syn_aB3xQ9k2vF8mNp1zT5wY7Qc4",
        params: { member_id: "mem_7Hk2mP9qR4sT1uV6wX8yZ3aB" },
        // Safe to retry: an existing pending/executed intent with this key is returned instead.
        idempotency_key: "remove-mem_7Hk2mP9qR4sT1uV6wX8yZ3aB-2026-10",
        requested_by_agent: "My Deal Bot",
      },
    }),
  );
  // Hand this URL to a human — the action executes only after they approve.
  console.log(intent?.attributes?.review_url);
  // #endregion
  return intent;
}
