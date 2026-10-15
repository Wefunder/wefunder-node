// operationId: cancelMemberLink — stop an unused link from opening the deal page (write:invite_links).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region cancelMemberLink
  const link = await wf.memberLinks.cancel("il_8kQm2xVb7nRt4WcY9pLe3HdA");
  console.log(link.attributes?.state); // "canceled"
  // #endregion
  return link;
}
