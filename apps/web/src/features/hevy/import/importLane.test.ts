import { afterEach, describe, expect, it } from "vitest";

import { importLane, resetImportLaneForTests } from "./importLane";

afterEach(() => resetImportLaneForTests());

function deferred() {
  let resolve: () => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("20.1 AC20 — the lane", () => {
  it("starts a second call only after the first settles", async () => {
    const first = deferred();
    const started: string[] = [];
    const a = importLane.run(async () => {
      started.push("a");
      await first.promise;
      return "a";
    });
    const b = importLane.run(async () => {
      started.push("b");
      return "b";
    });
    await tick();
    expect(started).toEqual(["a"]);
    first.resolve();
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(started).toEqual(["a", "b"]);
  });

  it("a rejecting call does not block the next, and its caller still sees the rejection", async () => {
    const first = deferred();
    const a = importLane.run(() => first.promise);
    const b = importLane.run(async () => "b");
    first.reject(new Error("boom"));
    await expect(a).rejects.toThrow("boom");
    expect(await b).toBe("b");
  });
});
