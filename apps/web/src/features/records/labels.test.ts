import { beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { RecordType } from "@sin/core";
import { recordLabel, resetUnknownTypeReportForTests } from "./labels";

describe("minor 680 — an unknown record type gets a generic label, not a throw", () => {
  beforeEach(() => {
    resetUnknownTypeReportForTests();
    observability.reportError.mockClear();
  });

  it("minor 718: two unknown labels report once per page load", () => {
    expect(recordLabel("future_type" as RecordType)).toBe("Record");
    expect(recordLabel("another_type" as RecordType)).toBe("Record");
    expect(observability.reportError).toHaveBeenCalledTimes(1);
  });

  it('a type this build doesn\'t know reads "Record" and is reported once, with static tags only', () => {
    expect(recordLabel("future_type" as RecordType)).toBe("Record");
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    const [error, context] = observability.reportError.mock.calls[0]!;
    expect((error as Error).message).toBe("unknown record type");
    expect(context).toEqual({ source: "records", op: "unknown-record-type" });
  });

  it("a known type still reads its own name", () => {
    expect(recordLabel("heaviest_weight")).toBe("Heaviest weight");
  });
});
