// operationId: listOfferingMemberLinks — your app's member links on one offering (read:invite_links).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listOfferingMemberLinks
  for await (const link of wf.memberLinks.all("ofr_2nVb8KxQ4tLm9RcW7pHs3FdY")) {
    console.log(link.id, link.attributes?.reference, link.attributes?.state);
  }
  // #endregion
}
