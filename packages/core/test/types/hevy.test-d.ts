import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type {
  HevyMapping,
  HevyMappingSchema,
  HevyPair,
  HevyPairInputSchema,
  HevyPairSchema,
  HevySectionRule,
  HevySectionRuleSchema,
} from "../../src/index.js";

describe("19.0 Task 6 / Task 7 — the DTOs infer to the shared mapping types", () => {
  it("pair, section rule, mapping", () => {
    expectTypeOf<z.infer<typeof HevyPairSchema>>().toEqualTypeOf<HevyPair>();
    expectTypeOf<z.infer<typeof HevySectionRuleSchema>>().toEqualTypeOf<HevySectionRule>();
    expectTypeOf<z.infer<typeof HevyMappingSchema>>().toEqualTypeOf<HevyMapping>();
    expectTypeOf<z.infer<typeof HevyPairInputSchema>>().toEqualTypeOf<Omit<HevyPair, "exerciseActive">>();
  });
});
