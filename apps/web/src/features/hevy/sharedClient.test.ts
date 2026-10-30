import { describe, expect, it, vi } from "vitest";

import { sleep } from "./sharedClient";

describe("minor 254 — sleep", () => {
  it("takes its abort listener off the signal when the wait runs out", async () => {
    const signal = new AbortController().signal;
    const add = vi.spyOn(signal, "addEventListener");
    const remove = vi.spyOn(signal, "removeEventListener");
    await sleep(1, signal);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
  });

  it("an abort still ends the wait at once with an AbortError", async () => {
    const controller = new AbortController();
    const waiting = sleep(60_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });
});
