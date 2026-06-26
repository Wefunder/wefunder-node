import { describe, it, expect, vi } from "vitest";
import { paginate, collect, type Page, type Cursor } from "../src/pagination.js";

describe("paginate (opaque cursor)", () => {
  it("walks pages until next_cursor is null, yielding items lazily", async () => {
    const pages: Record<string, Page<number>> = {
      first: { data: [1, 2], meta: { has_more: true, next_cursor: 100 } },
      "100": { data: [3, 4], meta: { has_more: true, next_cursor: 200 } },
      "200": { data: [5], meta: { has_more: false, next_cursor: null } },
    };
    const fetchPage = vi.fn(async (cursor?: Cursor) => pages[cursor === undefined ? "first" : String(cursor)]!);
    const out: number[] = [];
    for await (const n of paginate(fetchPage)) out.push(n);
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("treats the cursor as OPAQUE — passes a string timestamp back verbatim", async () => {
    const seen: (Cursor | undefined)[] = [];
    const fetchPage = vi.fn(async (cursor?: Cursor): Promise<Page<string>> => {
      seen.push(cursor);
      if (cursor === undefined) return { data: ["a"], meta: { next_cursor: "2025-01-01T00:00:00Z" } };
      return { data: ["b"], meta: { next_cursor: null } };
    });
    expect(await collect(fetchPage)).toEqual(["a", "b"]);
    expect(seen).toEqual([undefined, "2025-01-01T00:00:00Z"]); // string cursor, not coerced
  });

  it("stops when has_more is false even if a cursor is present", async () => {
    const fetchPage = vi.fn(async (): Promise<Page<number>> => ({ data: [1], meta: { has_more: false, next_cursor: 999 } }));
    expect(await collect(fetchPage)).toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("guards against an endpoint that repeats the same cursor (no infinite loop)", async () => {
    const fetchPage = vi.fn(async (): Promise<Page<number>> => ({ data: [1], meta: { next_cursor: 7 } }));
    const out = await collect(fetchPage);
    expect(out).toEqual([1, 1]); // first page + the cursor=7 page, then 7 seen again -> stop
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("handles an empty result set", async () => {
    const fetchPage = vi.fn(async (): Promise<Page<number>> => ({ data: [], meta: {} }));
    expect(await collect(fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
