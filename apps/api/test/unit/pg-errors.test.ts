import { describe, expect, it } from "vitest";
import { isRawUniqueViolation, rawSqlState } from "../../src/repositories/pg-errors.js";

const prismaError = (code: string, meta?: { code?: string }) => Object.assign(new Error("prisma"), { code, ...(meta ? { meta } : {}) });

describe("Minor 159 — rawSqlState reads a raw query's SQLSTATE", () => {
  it("a P2010 gives its driver SQLSTATE", () => {
    expect(rawSqlState(prismaError("P2010", { code: "23503" }))).toBe("23503");
  });

  it("a P2010 with no driver code gives null", () => {
    expect(rawSqlState(prismaError("P2010"))).toBeNull();
  });

  it("a typed-client P2002 gives null", () => {
    expect(rawSqlState(prismaError("P2002", { code: "23505" }))).toBeNull();
  });

  it.each([new Error("plain"), "23505", null, { code: "P2010", meta: { code: "23505" } }])("%j gives null", (err) => {
    expect(rawSqlState(err)).toBeNull();
  });

  it("isRawUniqueViolation still answers as before", () => {
    expect(isRawUniqueViolation(prismaError("P2010", { code: "23505" }))).toBe(true);
    expect(isRawUniqueViolation(prismaError("P2010", { code: "23503" }))).toBe(false);
    expect(isRawUniqueViolation(prismaError("P2002", { code: "23505" }))).toBe(false);
    expect(isRawUniqueViolation(new Error("plain"))).toBe(false);
  });
});
