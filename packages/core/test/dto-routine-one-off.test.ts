import { describe, expect, it } from "vitest";
import { ROUTINE_ONE_OFF_DAYS, RoutineCreateSchema, RoutineWriteSchema } from "../src/dto/routine.js";

const EX = "018fcb3e-3b8a-7d6e-9c1a-000000000010";
const body = (over: Record<string, unknown> = {}) => ({ name: "Push A", items: [{ exerciseId: EX }], ...over });
const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; code: string }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => ({ path: i.path.join("."), code: i.code }));

describe("09.3 AC5 — RoutineCreateSchema", () => {
  it("holds the 14-day constant", () => {
    expect(ROUTINE_ONE_OFF_DAYS).toBe(14);
  });

  it("accepts oneOff: true and an absent oneOff", () => {
    expect(RoutineCreateSchema.safeParse(body({ oneOff: true })).data?.oneOff).toBe(true);
    const plain = RoutineCreateSchema.safeParse(body());
    expect(plain.success).toBe(true);
    expect(plain.data).not.toHaveProperty("oneOff");
  });

  it.each([false, null, "true", 1])("rejects oneOff: %j on oneOff", (value) => {
    expect(issues(RoutineCreateSchema.safeParse(body({ oneOff: value }))).map((i) => i.path)).toEqual(["oneOff"]);
  });

  it("a client can never send the expiry (strict)", () => {
    expect(issues(RoutineCreateSchema.safeParse(body({ oneOffUntil: "2026-11-02T00:00:00Z" })))).toEqual([
      { path: "", code: "unrecognized_keys" },
    ]);
  });

  it("the document rules still apply", () => {
    const r = RoutineCreateSchema.safeParse(body({ oneOff: true, items: [{ exerciseId: EX, targetRepsLow: 8 }] }));
    expect(issues(r).map((i) => i.path)).toEqual(["items.0.targetRepsHigh"]);
  });
});

describe("09.3 AC5 — RoutineWriteSchema stays closed", () => {
  it("rejects oneOff and oneOffUntil as unknown keys", () => {
    expect(issues(RoutineWriteSchema.safeParse(body({ oneOff: true })))).toEqual([{ path: "", code: "unrecognized_keys" }]);
    expect(issues(RoutineWriteSchema.safeParse(body({ oneOffUntil: "2026-11-02T00:00:00Z" })))).toEqual([
      { path: "", code: "unrecognized_keys" },
    ]);
  });

  it("still accepts today's body", () => {
    expect(RoutineWriteSchema.safeParse(body()).success).toBe(true);
  });
});
