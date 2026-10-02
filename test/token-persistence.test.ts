// Rotated tokens must be durable BEFORE any caller can use them (wefunder-ruby#1, applied to every SDK).
import { describe, it, expect, vi } from "vitest";
import {
  TokenManager,
  WefunderTokenPersistenceError,
} from "../src/token-manager.js";
import { makeFetch, json } from "./helpers.js";

const oauth = () =>
  makeFetch(() => json({ access_token: "at_live_NEW", refresh_token: "r2" }))
    .fetch;
const tokens = () => ({ accessToken: "at_live_OLD", refreshToken: "r1" });

describe("TokenManager persistence gating", () => {
  it("the store sees the OLD token still current while saving", async () => {
    const observed: Array<[string, string]> = [];
    const tm = new TokenManager({
      tokens: tokens(),
      clientId: "c",
      fetch: oauth(),
      store: {
        save: (s) => {
          observed.push([s.accessToken, tm.current.accessToken]);
        },
      },
    });
    await tm.refresh();
    expect(observed).toEqual([["at_live_NEW", "at_live_OLD"]]);
    expect(tm.current.accessToken).toBe("at_live_NEW");
  });

  it("barrier: a concurrent reader behind an in-flight save never sees the undurable token", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const saveEntered = new Promise<void>((r) => (entered = r));
    const tm = new TokenManager({
      tokens: tokens(),
      clientId: "c",
      fetch: oauth(),
      store: {
        save: async () => {
          entered();
          await held;
        },
      },
    });
    const refreshing = tm.refresh();
    await saveEntered; // refresh is inside store.save
    let readerDone = false;
    const reader = tm.getAccessToken().then((t) => {
      readerDone = true;
      return t;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(readerDone).toBe(false); // the reader is coalesced onto the in-flight refresh, not served the pending set
    expect(tm.current.accessToken).toBe("at_live_OLD");
    release();
    expect((await refreshing).accessToken).toBe("at_live_NEW");
    expect(await reader).toBe("at_live_NEW"); // served only after the save completed
  });

  it("a failing store keeps the set pending, never uses it, and retries the save on the next call", async () => {
    let attempts = 0;
    const save = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error("disk full");
    });
    const tm = new TokenManager({
      tokens: tokens(),
      clientId: "c",
      fetch: oauth(),
      store: { save },
    });
    await expect(tm.refresh()).rejects.toBeInstanceOf(
      WefunderTokenPersistenceError,
    );
    await tm
      .refresh()
      .catch((e: WefunderTokenPersistenceError) =>
        expect(e.tokens.refreshToken).toBe("r2"),
      );
    expect(tm.current.accessToken).toBe("at_live_OLD"); // not published
    expect(tm.pendingTokens?.accessToken).toBe("at_live_NEW");
    // Next call retries the save (no second rotation) and publishes.
    expect(await tm.getAccessToken()).toBe("at_live_NEW");
    expect(tm.pendingTokens).toBeUndefined();
  });

  it("markPersisted publishes a pending set the caller saved out of band", async () => {
    const tm = new TokenManager({
      tokens: tokens(),
      clientId: "c",
      fetch: oauth(),
      store: {
        save: async () => {
          throw new Error("disk full");
        },
      },
    });
    await expect(tm.refresh()).rejects.toBeInstanceOf(
      WefunderTokenPersistenceError,
    );
    await tm.markPersisted();
    expect(tm.current.accessToken).toBe("at_live_NEW");
    expect(tm.pendingTokens).toBeUndefined();
  });
});
