import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EXPORT_FORMAT_VERSION,
  ACCOUNT_PURGE_GRACE_DAYS,
  AccountDeletedResponseSchema,
  AccountExportProfileSchema,
  AccountExportSchema,
} from "@sin/core";

const PROFILE = {
  id: "018fcb3e-3b8a-7d6e-9c1a-000000000001",
  email: "a@b.com",
  displayName: null,
  unitPreference: "kg",
  timezone: "UTC",
  createdAt: "2026-10-01T00:00:00.000Z",
};
const DOC = {
  formatVersion: 1,
  exportedAt: "2026-10-11T18:00:00.000Z",
  profile: PROFILE,
  exercises: [],
  routines: [],
  workouts: [],
};

describe("AC34 — account DTOs compose the read DTOs", () => {
  it("accepts a hand-built document", () => {
    expect(AccountExportSchema.parse(DOC)).toEqual(DOC);
  });

  it("rejects any formatVersion other than 1", () => {
    expect(AccountExportSchema.safeParse({ ...DOC, formatVersion: 2 }).success).toBe(false);
  });

  it("strips an unknown top-level key (allowlist schema)", () => {
    expect(AccountExportSchema.parse({ ...DOC, authSub: "auth0|x" })).not.toHaveProperty("authSub");
  });

  it("the profile shape has no isNewUser", () => {
    expect(Object.keys(AccountExportProfileSchema.shape)).not.toContain("isNewUser");
    expect(AccountExportProfileSchema.parse({ ...PROFILE, isNewUser: true })).not.toHaveProperty("isNewUser");
  });

  it("the delete response has exactly deletedAt and purgeEligibleAt", () => {
    expect(Object.keys(AccountDeletedResponseSchema.shape).sort()).toEqual(["deletedAt", "purgeEligibleAt"]);
  });
});

describe("AC20 — the grace constant", () => {
  it("is 30 days and the format version is 1", () => {
    expect(ACCOUNT_PURGE_GRACE_DAYS).toBe(30);
    expect(ACCOUNT_EXPORT_FORMAT_VERSION).toBe(1);
  });
});
