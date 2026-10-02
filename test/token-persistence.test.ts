// Rotated tokens must be durable BEFORE any caller can use them (wefunder-ruby#1, applied to every SDK).
// Every configured persistence path (store.save AND onTokenRefresh) must succeed before publication.
import { describe, it, expect, vi } from "vitest";
import {
  Wefunder,
  TokenManager,
  WefunderTokenPersistenceError,
  type TokenSet,
} from "../src/index.js";
import { makeFetch, json, noSleep, type RecordedCall } from "./helpers.js";

const oauth = () =>
  makeFetch(() => json({ access_token: "at_live_NEW", refresh_token: "r2" }))
    .fetch;
const tokens = () => ({ accessToken: "at_live_OLD", refreshToken: "r1" });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

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

  for (const path of ["store", "callback"] as const) {
    it(`barrier (${path}): a reader behind an in-flight ${path} save never sees the undurable token`, async () => {
      const held = deferred();
      const entered = deferred();
      const persist = async () => {
        entered.resolve();
        await held.promise;
      };
      const tm = new TokenManager({
        tokens: tokens(),
        clientId: "c",
        fetch: oauth(),
        ...(path === "store"
          ? { store: { save: persist } }
          : { onTokenRefresh: persist }),
      });
      const refreshing = tm.refresh();
      await entered.promise;
      let readerDone = false;
      const reader = tm.getAccessToken().then((t) => {
        readerDone = true;
        return t;
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(readerDone).toBe(false);
      expect(tm.current.accessToken).toBe("at_live_OLD");
      held.resolve();
      expect((await refreshing).accessToken).toBe("at_live_NEW");
      expect(await reader).toBe("at_live_NEW");
    });

    it(`failure (${path}): a failing ${path} keeps the set pending, never uses it, and the next call retries`, async () => {
      let attempts = 0;
      const persist = vi.fn(async () => {
        attempts++;
        if (attempts === 1) throw new Error("disk full");
      });
      const tm = new TokenManager({
        tokens: tokens(),
        clientId: "c",
        fetch: oauth(),
        ...(path === "store"
          ? { store: { save: persist } }
          : { onTokenRefresh: persist }),
      });
      const err = await tm.refresh().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WefunderTokenPersistenceError);
      expect((err as WefunderTokenPersistenceError).tokens.refreshToken).toBe(
        "r2",
      );
      expect((err as Error).message).toContain("disk full");
      expect(tm.current.accessToken).toBe("at_live_OLD"); // not published
      expect(tm.pendingTokens?.accessToken).toBe("at_live_NEW");
      expect(await tm.getAccessToken()).toBe("at_live_NEW"); // save retried, no second rotation
      expect(attempts).toBe(2);
      expect(tm.pendingTokens).toBeUndefined();
    });
  }

  it("onTokenRefresh runs before publication, after store.save", async () => {
    const order: string[] = [];
    const tm = new TokenManager({
      tokens: tokens(),
      clientId: "c",
      fetch: oauth(),
      store: {
        save: async () => {
          order.push(`save current=${tm.current.accessToken}`);
        },
      },
      onTokenRefresh: async () => {
        order.push(`callback current=${tm.current.accessToken}`);
      },
    });
    await tm.refresh();
    expect(order).toEqual([
      "save current=at_live_OLD",
      "callback current=at_live_OLD",
    ]);
  });

  it("markPersisted is bound to the exact set that was saved: a stale r2 ack cannot publish r3", async () => {
    let mint = 0;
    const fetch = makeFetch(() => {
      mint++;
      return json({
        access_token: `at_live_${mint + 1}`,
        refresh_token: `r${mint + 1}`,
      });
    }).fetch;
    const saves: string[] = [];
    let failNext = true;
    const tm = new TokenManager({
      tokens: tokens(),
      clientId: "c",
      fetch,
      store: {
        save: async (s) => {
          saves.push(s.refreshToken!);
          if (failNext) {
            failNext = false;
            throw new Error("down");
          }
        },
      },
    });
    // r1 -> r2, save fails; caller A holds err.tokens (r2) for an out-of-band save.
    const errA = (await tm
      .refresh()
      .catch((e: unknown) => e)) as WefunderTokenPersistenceError;
    expect(errA.tokens.refreshToken).toBe("r2");
    // Caller B retries persistence successfully (publishes r2), then rotates again: r2 -> r3, save fails.
    expect(await tm.getAccessToken()).toBe("at_live_2");
    failNext = true;
    const errB = (await tm
      .refresh()
      .catch((e: unknown) => e)) as WefunderTokenPersistenceError;
    expect(errB.tokens.refreshToken).toBe("r3");
    expect(tm.pendingTokens?.refreshToken).toBe("r3");
    // A's delayed r2 acknowledgment arrives: it must NOT publish the unsaved r3.
    expect(await tm.markPersisted(errA.tokens)).toBe(false);
    expect(tm.pendingTokens?.refreshToken).toBe("r3");
    expect(tm.current.refreshToken).toBe("r2");
    // The correct acknowledgment does publish.
    expect(await tm.markPersisted(errB.tokens)).toBe(true);
    expect(tm.current.refreshToken).toBe("r3");
    expect(tm.pendingTokens).toBeUndefined();
  });
});

describe("persistence errors through the public client (package entry)", () => {
  const isOAuth = (c: RecordedCall) => c.url.includes("/oauth/token");
  const api = (
    store: { save: (t: TokenSet) => Promise<void> },
    extra?: Partial<ConstructorParameters<typeof Wefunder>[0]>,
  ) => {
    const { fetch, calls } = makeFetch((c) => {
      if (isOAuth(c))
        return json({ access_token: "at_live_NEW", refresh_token: "r2" });
      return c.headers["authorization"] === "Bearer at_live_OLD"
        ? new Response("{}", { status: 401 })
        : json({ data: { id: "usr_1" } });
    });
    const wf = new Wefunder({
      tokens: {
        accessToken: "at_live_OLD",
        refreshToken: "r1",
        expiresAt: 10_000_000_000_000,
      },
      clientId: "c",
      store,
      fetch,
      sleep: noSleep,
      ...extra,
    });
    return { wf, calls };
  };

  it("401 recovery: a failing store surfaces WefunderTokenPersistenceError from wf.users.me(), then markPersisted recovers", async () => {
    let fail = true;
    const { wf, calls } = api({
      save: async () => {
        if (fail) throw new Error("db down");
      },
    });
    const err = await wf.users.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WefunderTokenPersistenceError);
    expect((err as WefunderTokenPersistenceError).tokens.refreshToken).toBe(
      "r2",
    );
    expect(
      calls.filter((c) => !isOAuth(c)).map((c) => c.headers["authorization"]),
    ).toEqual(["Bearer at_live_OLD"]); // NEW never sent
    // Caller saves err.tokens out of band (the original store still failing) and acknowledges.
    expect(
      await wf.markPersisted((err as WefunderTokenPersistenceError).tokens),
    ).toBe(true);
    expect(wf.pendingTokens).toBeUndefined();
    fail = false;
    expect(((await wf.users.me()) as { id: string }).id).toBe("usr_1");
  });

  it("proactive refresh: a failing store surfaces WefunderTokenPersistenceError before any API call", async () => {
    const { wf, calls } = api(
      {
        save: async () => {
          throw new Error("db down");
        },
      },
      {
        tokens: {
          accessToken: "at_live_OLD",
          refreshToken: "r1",
          expiresAt: 1_000_000,
        },
        now: () => 1_000_000,
      },
    );
    await expect(wf.users.me()).rejects.toBeInstanceOf(
      WefunderTokenPersistenceError,
    );
    expect(calls.filter((c) => !isOAuth(c))).toHaveLength(0);
    expect(wf.pendingTokens?.refreshToken).toBe("r2");
  });
});
