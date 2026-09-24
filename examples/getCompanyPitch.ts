// operationId: getCompanyPitch — the deal page's Story and Perks tabs as structured blocks (read:public).
import type { Wefunder } from "../src/index.js";

export async function example(wf: Wefunder) {
  // #region getCompanyPitch
  const { data: pitch } = await wf.unwrap(
    wf.raw.getCompanyPitch({ path: { id: "co_abc123Example" }, query: { sections: ["story", "perks"] } }),
  );
  console.log(pitch?.attributes);
  // #endregion
  return pitch;
}
