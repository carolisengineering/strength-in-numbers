import { describe, expect, it, vi } from "vitest";
import { HevyError } from "./hevyErrors";
import { listAll } from "./listAll";

type Page = { page: number; page_count: number; items: number[] };
const pages = (count: number) => (page: number): Promise<Page> => Promise.resolve({ page, page_count: count, items: [page] });

describe("20.0 AC12 — listAll", () => {
  it("walks pages 1 to page_count and reports each", async () => {
    const onPage = vi.fn();
    const out = await listAll(pages(3), { onPage });
    expect(out.error).toBeNull();
    expect(out.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(onPage.mock.calls).toEqual([[{ page: 1, pageCount: 3 }], [{ page: 2, pageCount: 3 }], [{ page: 3, pageCount: 3 }]]);
  });

  it("page_count 0 or missing is one page", async () => {
    expect((await listAll(pages(0))).pages).toHaveLength(1);
    const missing = (page: number) => Promise.resolve({ page } as unknown as Page);
    expect((await listAll(missing)).pages).toHaveLength(1);
  });

  it("an abort after page 2 stops with the two pages and an aborted error", async () => {
    const ac = new AbortController();
    const out = await listAll(pages(5), { signal: ac.signal, onPage: ({ page }) => (page === 2 ? ac.abort() : undefined) });
    expect(out.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(out.error?.kind).toBe("aborted");
  });

  it("a page that fails after its retries returns the pages so far and the error", async () => {
    const fetchPage = async (page: number): Promise<Page> => {
      if (page === 3) throw new HevyError("server", { status: 503 });
      return { page, page_count: 5, items: [page] };
    };
    const out = await listAll(fetchPage);
    expect(out.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(out.error).toMatchObject({ kind: "server" });
  });
});
