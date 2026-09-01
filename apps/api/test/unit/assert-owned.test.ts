import { describe, it, expect } from "vitest";
import { assertOwned } from "../../src/repositories/user.js";
import { NotFoundError } from "../../src/errors/app-error.js";

describe("assertOwned (Spec 01 §6.3, DESIGN R8)", () => {
  it("returns the row when the acting user owns it", () => {
    const row = { userId: "u-1", value: 42 };
    expect(assertOwned(row, "u-1")).toBe(row);
  });

  it("throws NotFoundError (not 403) on an owner mismatch", () => {
    expect(() => assertOwned({ userId: "u-2" }, "u-1")).toThrow(NotFoundError);
  });

  it("throws NotFoundError for a missing row", () => {
    expect(() => assertOwned(null, "u-1")).toThrow(NotFoundError);
    expect(() => assertOwned(undefined, "u-1")).toThrow(NotFoundError);
  });
});
