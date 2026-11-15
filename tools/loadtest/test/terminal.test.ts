import { describe, expect, it, vi } from "vitest";
import { terminalLog } from "../src/node/terminal.ts";

describe("minor 591 — writes after a hang-up", () => {
  it("a line goes to the terminal with a newline", () => {
    const write = vi.fn();
    terminalLog(write).log("hello");
    expect(write).toHaveBeenCalledWith("hello\n");
  });

  it("a write that throws (EIO on a closed terminal) never stops the caller", () => {
    const t = terminalLog(() => {
      throw Object.assign(new Error("write EIO"), { code: "EIO" });
    });
    expect(() => t.log("x")).not.toThrow();
  });

  it("after hangUp nothing is written", () => {
    const write = vi.fn();
    const t = terminalLog(write);
    t.hangUp();
    t.log("x");
    expect(write).not.toHaveBeenCalled();
  });
});
