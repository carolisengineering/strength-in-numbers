import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ignoreWriteErrors } from "../src/node/terminal.ts";

describe("minor 591 (code review) — a write error on the terminal never crashes the CLI", () => {
  it("an EIO or EPIPE error event on a guarded stream is swallowed", () => {
    const stream = new PassThrough();
    ignoreWriteErrors([stream]);
    expect(() => stream.emit("error", Object.assign(new Error("write EIO"), { code: "EIO" }))).not.toThrow();
  });

  it("guarding twice adds one listener, not two", () => {
    const stream = new PassThrough();
    ignoreWriteErrors([stream]);
    ignoreWriteErrors([stream]);
    expect(stream.listenerCount("error")).toBe(1);
  });
});
