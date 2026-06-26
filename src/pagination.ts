// Lazy auto-pagination. The cursor is treated as an OPAQUE token (plan §4.1 #5):
// different endpoints back it with an int id, an ISO timestamp, or an offset, so we
// never inspect or arithmetic it — we just feed `meta.next_cursor` back verbatim.
// Streams items one page at a time (never buffers the whole result set).

export type Cursor = string | number;

export interface Page<T> {
  data?: T[] | null;
  meta?: {
    has_more?: boolean;
    next_cursor?: Cursor | null;
    [k: string]: unknown;
  };
}

/** Fetches a single page given an opaque cursor (undefined = first page). */
export type PageFetcher<T> = (cursor?: Cursor) => Promise<Page<T>>;

/** Yields every item across all pages, lazily. */
export async function* paginate<T>(fetchPage: PageFetcher<T>): AsyncGenerator<T> {
  let cursor: Cursor | undefined;
  const seen = new Set<Cursor>();
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.data ?? []) yield item;

    const meta = page.meta ?? {};
    const next = meta.next_cursor;
    // Stop conditions: explicit has_more=false, no next cursor, or a cursor that
    // doesn't advance (defensive guard against an endpoint that loops).
    if (meta.has_more === false) return;
    if (next === undefined || next === null) return;
    if (seen.has(next)) return;
    seen.add(next);
    cursor = next;
  }
}

/** Collect all items into an array. Convenience over `paginate` for small result sets. */
export async function collect<T>(fetchPage: PageFetcher<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of paginate(fetchPage)) out.push(item);
  return out;
}
