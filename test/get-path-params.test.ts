// `syndicates.get` / `intents.get` must fill the generated ops' named path params
// (`{syndicate_id}`, `{intent_id}`). They used to pass `path: { id }` behind an `as never`
// cast, so the template was never substituted and requests went to the literal
// `/syndicates/%7Bsyndicate_id%7D`.
import { describe, it, expect } from "vitest";
import { Wefunder } from "../src/index.js";
import { makeFetch, json, noSleep } from "./helpers.js";

const mk = () => {
  const { fetch, calls } = makeFetch(() => json({ data: { id: "x" } }));
  return { wf: new Wefunder({ accessToken: "at_live_x", fetch, sleep: noSleep }), calls };
};

describe("get() request paths", () => {
  it("syndicates.get GETs /syndicates/{syndicate_id}", async () => {
    const { wf, calls } = mk();
    await wf.syndicates.get("syn_aB3xQ9k2vF8mNp1zT5wY7Qc4");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(new URL(calls[0]!.url).pathname).toBe("/syndicates/syn_aB3xQ9k2vF8mNp1zT5wY7Qc4");
  });

  it("intents.get GETs /intents/{intent_id}", async () => {
    const { wf, calls } = mk();
    await wf.intents.get("int_aB3xQ9k2vF8mNp1zT5wY7Qc4");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(new URL(calls[0]!.url).pathname).toBe("/intents/int_aB3xQ9k2vF8mNp1zT5wY7Qc4");
  });
});
