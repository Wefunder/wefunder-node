// operationId: listPartnerSpvs — every SPV you've created, newest first (read:offerings).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region listPartnerSpvs
  const page = await wf.partner.spvs.list({ per_page: 50 });
  for (const spv of page.data ?? []) {
    console.log(spv.id, spv.attributes?.name, spv.attributes?.status);
  }

  // Or stream every SPV lazily, one page fetched at a time:
  for await (const spv of wf.partner.spvs.all()) {
    console.log(spv.id);
  }
  // #endregion
  return page;
}
