import { HevyError } from "./hevyErrors";

/**
 * Spec 20.0 AC12: every page of a Hevy list, in order. It stops at the first failure (after the client's own
 * retries) or an abort and returns the pages read so far with that error, so a caller can show what it has.
 * A `page_count` of 0 or missing is one page. React-free.
 */
export async function listAll<P extends { page: number; page_count: number }>(
  fetchPage: (page: number, signal?: AbortSignal) => Promise<P>,
  opts: { onPage?: (p: { page: number; pageCount: number }) => void; signal?: AbortSignal } = {},
): Promise<{ pages: P[]; error: HevyError | null }> {
  const pages: P[] = [];
  for (let page = 1; ; page++) {
    if (opts.signal?.aborted) return { pages, error: new HevyError("aborted") };
    let p: P;
    try {
      p = await fetchPage(page, opts.signal);
    } catch (err) {
      if (err instanceof HevyError) return { pages, error: err };
      throw err;
    }
    pages.push(p);
    const pageCount = Math.max(1, typeof p.page_count === "number" ? p.page_count : 1);
    opts.onPage?.({ page, pageCount });
    if (page >= pageCount) return { pages, error: null };
  }
}
