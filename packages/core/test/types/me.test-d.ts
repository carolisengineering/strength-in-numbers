import { describe, expectTypeOf, it } from "vitest";
import { type Me, type UpdateMeInput } from "../../src/dto/me.js";
import { type UserId } from "../../src/ids.js";

describe("AC9 — /v1/me DTO types", () => {
  it("Me has camelCase fields matching Spec 01 §5", () => {
    expectTypeOf<Me>().toMatchTypeOf<{
      id: UserId;
      email: string;
      displayName: string | null;
      unitPreference: "kg" | "lb";
      timezone: string;
      createdAt: string;
    }>();
  });

  it("isNewUser is optional", () => {
    expectTypeOf<Me["isNewUser"]>().toEqualTypeOf<boolean | undefined>();
  });

  it("UpdateMeInput is the writable subset, all optional", () => {
    expectTypeOf<UpdateMeInput>().toEqualTypeOf<{
      displayName?: string | null;
      unitPreference?: "kg" | "lb";
      timezone?: string;
    }>();
  });
});
