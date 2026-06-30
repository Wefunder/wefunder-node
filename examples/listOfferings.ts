// operationId: listOfferings — the public discovery feed (read:public).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listOfferings
  // Browse live offerings, sorted. The cursor is opaque and handled for you.
  const page = await wf.offerings.list({ sort: "most_raised" });
  for (const offering of page.data ?? []) {
    console.log(offering.id, offering.attributes?.company_name);
  }

  // Or stream every offering lazily, one page fetched at a time:
  for await (const offering of wf.offerings.all({ sort: "newest" })) {
    console.log(offering.id);
  }
  // #endregion
  return page;
}
