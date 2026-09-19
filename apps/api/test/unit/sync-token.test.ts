import { describe, expect, it } from "vitest";
import { formatSyncToken, parseSyncToken } from "../../src/repositories/sync-token.js";

describe("sync-token codec (server-only, Spec 03.3 D33)", () => {
  it("formats an xid decimal as 1.<xid>", () => {
    expect(formatSyncToken("736")).toBe("1.736");
  });

  it("parses a validated token back to the bare xid decimal", () => {
    expect(parseSyncToken("1.736")).toBe("736");
  });

  it("round-trips the 19-digit maximum", () => {
    const xid = "9999999999999999999";
    expect(parseSyncToken(formatSyncToken(xid))).toBe(xid);
  });

  it("throws on an unvalidated (wrong-prefix) token rather than passing it toward SQL", () => {
    expect(() => parseSyncToken("2.736")).toThrow();
  });
});
