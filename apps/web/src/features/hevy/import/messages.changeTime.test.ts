import { describe, expect, it } from "vitest";
import { preflightZoneDiffers } from "./messages";

describe("17.13 AC9 — the import's zone sentence names Change time", () => {
  it("in sentence case", () => {
    expect(preflightZoneDiffers("America/Chicago")).toContain("Change time uses the Profile zone");
    expect(preflightZoneDiffers("America/Chicago")).not.toContain("Change Time");
  });
});
