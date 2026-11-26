import { describe, expect, it, vi } from "vitest";
import { runThenClean } from "../integration/cross-user/run-then-clean.js";

describe("minor 735 — a cleanup error never hides the case's own failure", () => {
  const fails = (message: string) => () => Promise.reject(new Error(message));
  const passes = () => Promise.resolve();

  it("a failing run and a failing cleanup reject with the run's error", async () => {
    await expect(runThenClean(fails("the case"), fails("the cleanup"))).rejects.toThrow("the case");
  });

  it("a passing run and a failing cleanup reject with the cleanup's error", async () => {
    await expect(runThenClean(passes, fails("the cleanup"))).rejects.toThrow("the cleanup");
  });

  it("both passing resolve, with the cleanup called once after the run", async () => {
    const order: string[] = [];
    const cleanup = vi.fn(async () => void order.push("cleanup"));
    await expect(runThenClean(async () => void order.push("run"), cleanup)).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["run", "cleanup"]);
  });

  it("with no cleanup, the run's outcome", async () => {
    await expect(runThenClean(passes, undefined)).resolves.toBeUndefined();
    await expect(runThenClean(fails("the case"), undefined)).rejects.toThrow("the case");
  });

  it("the cleanup runs even when the case fails", async () => {
    const cleanup = vi.fn(passes);
    await expect(runThenClean(fails("the case"), cleanup)).rejects.toThrow("the case");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
