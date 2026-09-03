import { describe, expect, it } from "vitest";
import { MeSchema, UpdateMeSchema } from "../../src/dto/me.js";

const validMe = {
  id: "018f9c8e-7b1a-7c2d-9e3f-4a5b6c7d8e9f",
  email: "a@b.com",
  displayName: null,
  unitPreference: "kg",
  timezone: "UTC",
  createdAt: "2026-08-30T12:00:00Z",
  isNewUser: true,
};

describe("AC9 — /v1/me DTO pattern", () => {
  it("MeSchema.parse accepts a valid Spec 01 GET /v1/me body", () => {
    expect(MeSchema.parse(validMe)).toMatchObject({ id: validMe.id, email: "a@b.com" });
  });

  it("MeSchema accepts a body without isNewUser (the non-provisioning response)", () => {
    const { isNewUser: _omit, ...rest } = validMe;
    void _omit;
    expect(() => MeSchema.parse(rest)).not.toThrow();
  });

  it("MeSchema rejects an unknown unitPreference value", () => {
    expect(() => MeSchema.parse({ ...validMe, unitPreference: "stone" })).toThrow();
  });

  it("MeSchema rejects a non-datetime createdAt", () => {
    expect(() => MeSchema.parse({ ...validMe, createdAt: "yesterday" })).toThrow();
  });

  it("UpdateMeSchema accepts the writable subset", () => {
    expect(UpdateMeSchema.parse({ displayName: "Carol" })).toEqual({ displayName: "Carol" });
    expect(UpdateMeSchema.parse({ unitPreference: "lb", timezone: "America/Chicago" })).toEqual({
      unitPreference: "lb",
      timezone: "America/Chicago",
    });
    expect(UpdateMeSchema.parse({})).toEqual({});
  });

  it("UpdateMeSchema is strict — unknown keys are rejected (Spec 01: unknown field → 422)", () => {
    expect(() => UpdateMeSchema.parse({ email: "x@y.com" })).toThrow();
    expect(() => UpdateMeSchema.parse({ id: validMe.id })).toThrow();
  });

  it("UpdateMeSchema rejects an unknown unitPreference and an empty timezone", () => {
    expect(() => UpdateMeSchema.parse({ unitPreference: "stone" })).toThrow();
    expect(() => UpdateMeSchema.parse({ timezone: "" })).toThrow();
  });
});
