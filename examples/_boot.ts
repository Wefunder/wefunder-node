// Hidden harness — NOT shown in docs (no `#region` markers, leading `_` excludes it
// from the manifest builder). Every example is an `example(wf)` function; the compile
// gate type-checks them and the e2e run-gate calls them with this real sandbox client.
import { Wefunder } from "../src/index.js";

export async function bootClient(): Promise<Wefunder> {
  return Wefunder.fromClientCredentials({
    clientId: process.env.WEFUNDER_CLIENT_ID!,
    clientSecret: process.env.WEFUNDER_CLIENT_SECRET!,
    scopes: ["read:public"],
  });
}
