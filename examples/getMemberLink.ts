// operationId: getMemberLink — what the member did with their link (read:invite_links).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getMemberLink
  const link = await wf.memberLinks.get("il_8kQm2xVb7nRt4WcY9pLe3HdA");
  console.log(link.attributes?.state, link.attributes?.wefunder_user_id, link.attributes?.investment_id);
  // #endregion
  return link;
}
