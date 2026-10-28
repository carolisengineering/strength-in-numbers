import { describe, expect, it } from "vitest";
import { createPacer, HEVY_MIN_GAP_MS, inQuietMinute } from "./pacer";

/** A fake clock: `sleep` resumes on a later microtask, then moves `now` to the instant it was asked to wake. */
function clock(startIso: string) {
  let now = Date.parse(startIso);
  const sleep = async (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const wake = now + Math.max(0, ms);
    await Promise.resolve();
    now = Math.max(now, wake);
  };
  return { now: () => now, sleep, iso: () => new Date(now).toISOString() };
}

describe("20.0 AC10 — pacing", () => {
  it("never starts in the first minute of a UTC hour", async () => {
    const c = clock("2026-10-28T13:00:30.000Z");
    await createPacer(c).wait();
    expect(c.iso()).toBe("2026-10-28T13:01:00.000Z");
  });

  it("the 600 ms gap that lands in the first minute moves to :01:00 (the spec's case)", async () => {
    const c = clock("2026-10-28T12:59:59.700Z");
    const pacer = createPacer(c);
    await pacer.wait();
    expect(c.iso()).toBe("2026-10-28T12:59:59.700Z");
    await pacer.wait();
    expect(c.iso()).toBe("2026-10-28T13:01:00.000Z");
  });

  it("two waits at the same instant go 600 ms apart, in call order", async () => {
    const c = clock("2026-10-28T12:30:00.000Z");
    const pacer = createPacer(c);
    const order: string[] = [];
    const a = pacer.wait().then(() => order.push(`a@${c.now()}`));
    const b = pacer.wait().then(() => order.push(`b@${c.now()}`));
    await Promise.all([a, b]);
    const start = Date.parse("2026-10-28T12:30:00.000Z");
    expect(order).toEqual([`a@${start}`, `b@${start + HEVY_MIN_GAP_MS}`]);
  });

  it("deferUntil holds the next request back", async () => {
    const c = clock("2026-10-28T12:30:00.000Z");
    const pacer = createPacer(c);
    const start = c.now();
    pacer.deferUntil(start + 7000);
    await pacer.wait();
    expect(c.now() - start).toBeGreaterThanOrEqual(7000);
  });

  it("a Retry-After that arrives while a request is already queued still holds it back", async () => {
    const c = clock("2026-10-28T12:30:00.000Z");
    const pacer = createPacer(c);
    const start = c.now();
    await pacer.wait();
    const queued = pacer.wait();
    pacer.deferUntil(start + 7000);
    await queued;
    expect(c.now()).toBeGreaterThanOrEqual(start + 7000);
  });

  it("an aborted signal rejects at once with kind aborted", async () => {
    const c = clock("2026-10-28T12:30:00.000Z");
    const pacer = createPacer(c);
    await pacer.wait();
    const ac = new AbortController();
    ac.abort();
    await expect(pacer.wait(ac.signal)).rejects.toMatchObject({ name: "HevyError", kind: "aborted" });
  });
});

/** A clock whose sleeps wait until `advance`, and reject when their signal aborts. */
function heldClock(startIso: string) {
  let now = Date.parse(startIso);
  const asked: number[] = [];
  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      asked.push(ms);
      if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      void resolve;
    });
  return { now: () => now, sleep, asked, set: (iso: string) => void (now = Date.parse(iso)) };
}

describe("Minor 173 — an aborted waiter gives its slot back", () => {
  it("the last slot's holder releases it, so the next request is not pushed back", async () => {
    const c = heldClock("2026-10-28T12:30:00.000Z");
    const pacer = createPacer(c);
    await pacer.wait(); // slot t0, no sleep
    const stop = new AbortController();
    const second = pacer.wait(stop.signal); // slot t0 + 600
    stop.abort();
    await expect(second).rejects.toMatchObject({ kind: "aborted" });
    void pacer.wait(); // takes t0 + 600 again, not t0 + 1200
    await Promise.resolve();
    expect(c.asked).toEqual([HEVY_MIN_GAP_MS, HEVY_MIN_GAP_MS]);
  });

  it("an aborted waiter that doesn't hold the last slot changes nothing", async () => {
    const c = heldClock("2026-10-28T12:30:00.000Z");
    const pacer = createPacer(c);
    await pacer.wait();
    const stop = new AbortController();
    const second = pacer.wait(stop.signal); // t0 + 600
    void pacer.wait(); // t0 + 1200
    stop.abort();
    await expect(second).rejects.toMatchObject({ kind: "aborted" });
    void pacer.wait(); // t0 + 1800
    await Promise.resolve();
    expect(c.asked).toEqual([HEVY_MIN_GAP_MS, 2 * HEVY_MIN_GAP_MS, 3 * HEVY_MIN_GAP_MS]);
  });
});

describe("Minor 167 — the quiet minute", () => {
  it.each([
    ["2026-10-28T13:00:00.000Z", true],
    ["2026-10-28T13:00:59.999Z", true],
    ["2026-10-28T13:01:00.000Z", false],
    ["2026-10-28T12:59:59.999Z", false],
  ])("%s → %s", (iso, quiet) => {
    expect(inQuietMinute(Date.parse(iso))).toBe(quiet);
  });
});
