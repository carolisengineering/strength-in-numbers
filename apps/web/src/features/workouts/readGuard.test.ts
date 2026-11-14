import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardReads, rereadFresh, rereadIfStale, rereadUntilLanded } from "./readGuard";

const KEY = ["workouts", "detail", "w1"] as const;
let clients: QueryClient[] = [];
afterEach(() => {
  for (const c of clients) c.clear();
  clients = [];
});

function setup(queryFn: () => Promise<string>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  clients.push(queryClient);
  const fn = vi.fn(queryFn);
  const observer = new QueryObserver(queryClient, { queryKey: KEY, queryFn: fn });
  const unsubscribe = observer.subscribe(() => {});
  return { queryClient, fn, unsubscribe };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("#154 — a read that starts while a write is pending is redone after it settles", () => {
  it("a read started during the write (a focus refetch) marks the guard; the settle re-reads once", async () => {
    const { queryClient, fn } = setup(async () => "server");
    await settle();
    const guard = await guardReads(queryClient, KEY);
    void queryClient.refetchQueries({ queryKey: KEY }); // the focus refetch, mid-write
    await settle();
    const before = fn.mock.calls.length;
    rereadIfStale(queryClient, KEY, guard);
    await settle();
    expect(fn.mock.calls.length).toBe(before + 1);
  });

  it("no read meanwhile: nothing is re-read", async () => {
    const { queryClient, fn } = setup(async () => "server");
    await settle();
    const guard = await guardReads(queryClient, KEY);
    const before = fn.mock.calls.length;
    rereadIfStale(queryClient, KEY, guard);
    await settle();
    expect(fn.mock.calls.length).toBe(before);
  });

  it("a read in flight at the start is canceled, and counts", async () => {
    let release!: (v: string) => void;
    const { queryClient } = setup(() => new Promise<string>((r) => (release = r)));
    expect(queryClient.isFetching({ queryKey: KEY })).toBe(1);
    const guard = await guardReads(queryClient, KEY);
    expect(queryClient.isFetching({ queryKey: KEY })).toBe(0);
    release("late");
    expect(guard.finish()).toBe(true);
  });

  it("finish stops watching and answers once", async () => {
    const { queryClient } = setup(async () => "server");
    await settle();
    const guard = await guardReads(queryClient, KEY);
    expect(guard.finish()).toBe(false);
    void queryClient.refetchQueries({ queryKey: KEY });
    await settle();
    expect(guard.finish()).toBe(false);
  });

  it("a read of another workout does not count", async () => {
    const { queryClient } = setup(async () => "server");
    await settle();
    const guard = await guardReads(queryClient, KEY);
    await queryClient.fetchQuery({ queryKey: ["workouts", "detail", "w2"], queryFn: async () => "other" });
    expect(guard.finish()).toBe(false);
  });
});

describe("#158 — a structure re-read resolves only once an answer has landed", () => {
  it("a re-read canceled by a later write is asked again", async () => {
    let calls = 0;
    const holder: { client?: QueryClient } = {};
    const { queryClient } = setup(async () => {
      calls += 1;
      if (calls === 2) {
        // The structure write's re-read: a set write starts now and cancels it (its guardReads).
        void holder.client!.cancelQueries({ queryKey: KEY });
        await new Promise((r) => setTimeout(r, 5));
      }
      return `answer ${calls}`;
    });
    holder.client = queryClient;
    await settle();
    await rereadUntilLanded(queryClient, KEY);
    expect(calls).toBe(3);
    expect(queryClient.getQueryData(KEY)).toBe("answer 3");
  });

  it("an answer landing in the same millisecond as the last one counts as landed (CI, PR #176)", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    try {
      let calls = 0;
      const { queryClient } = setup(async () => `answer ${++calls}`);
      await settle();
      await rereadUntilLanded(queryClient, KEY);
      expect(calls).toBe(2);
      expect(queryClient.getQueryData(KEY)).toBe("answer 2");
    } finally {
      now.mockRestore();
    }
  });

  it("a failed re-read is not retried", async () => {
    let calls = 0;
    const { queryClient } = setup(async () => {
      calls += 1;
      if (calls > 1) throw new Error("offline");
      return "first";
    });
    await settle();
    await rereadUntilLanded(queryClient, KEY);
    expect(calls).toBe(2);
  });

  it("a screen that has gone (no observer) is not read", async () => {
    const { queryClient, fn, unsubscribe } = setup(async () => "server");
    await settle();
    unsubscribe();
    const before = fn.mock.calls.length;
    await rereadUntilLanded(queryClient, KEY);
    expect(fn.mock.calls.length).toBe(before);
  });
});

describe("minor 321 — rereadFresh: a re-read whose answer can be planned from", () => {
  afterEach(() => onlineManager.setOnline(true));

  it("a read that lands: true, and the new answer is cached", async () => {
    let answer = "first";
    const { queryClient } = setup(async () => answer);
    await settle();
    answer = "second";
    await expect(rereadFresh(queryClient, KEY)).resolves.toBe(true);
    expect(queryClient.getQueryData(KEY)).toBe("second");
  });

  it("a read that fails: false", async () => {
    let calls = 0;
    const { queryClient } = setup(async () => {
      calls += 1;
      if (calls > 1) throw new Error("server down");
      return "first";
    });
    await settle();
    await expect(rereadFresh(queryClient, KEY)).resolves.toBe(false);
  });

  it("Review Focus 1: offline, false at once and nothing is read (a paused read would never settle)", async () => {
    const { queryClient, fn } = setup(async () => "server");
    await settle();
    const before = fn.mock.calls.length;
    onlineManager.setOnline(false);
    await expect(rereadFresh(queryClient, KEY)).resolves.toBe(false);
    expect(fn.mock.calls.length).toBe(before);
  });

  it("every re-read canceled (set writes meanwhile): false, so nothing is planned from the old cache (code review)", async () => {
    let calls = 0;
    const holder: { client?: QueryClient } = {};
    const { queryClient } = setup(async () => {
      calls += 1;
      if (calls > 1) {
        // Each re-read meets a set write's guardReads, which cancels it.
        void holder.client!.cancelQueries({ queryKey: KEY });
        await new Promise((r) => setTimeout(r, 5));
      }
      return `answer ${calls}`;
    });
    holder.client = queryClient;
    await settle();
    await expect(rereadFresh(queryClient, KEY)).resolves.toBe(false);
    expect(queryClient.getQueryData(KEY)).toBe("answer 1");
  });
});
