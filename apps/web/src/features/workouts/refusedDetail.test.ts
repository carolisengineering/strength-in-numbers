import { describe, expect, it } from "vitest";

import { REFUSED_OTHER, refusedBlocked, refusedIncomplete } from "./messages";
import { refusedDetailFor } from "./refusedDetail";
import { START_CLOCK_MESSAGE } from "./useBeginWorkout";

const input = { rereadDone: false, flagged: 0, online: true, refusedRows: 0, refusedSets: 0 };

describe("minor 692 — offline, an incomplete refusal still says to tap Finish again", () => {
  it("before the re-read lands: offline says to check and tap Finish again; online the lead stands alone (minor 638)", () => {
    expect(refusedDetailFor({ ...input, kind: "incomplete", online: false })).toBe(REFUSED_OTHER);
    expect(refusedDetailFor({ ...input, kind: "incomplete", online: true })).toBeNull();
  });

  it("once the re-read lands, the flagged count wins, with or without signal", () => {
    for (const online of [true, false]) {
      expect(refusedDetailFor({ ...input, kind: "incomplete", rereadDone: true, flagged: 2, online })).toBe(refusedIncomplete(2));
      expect(refusedDetailFor({ ...input, kind: "incomplete", rereadDone: true, flagged: 0, online })).toBe(REFUSED_OTHER);
    }
  });

  it("the other kinds read as before", () => {
    expect(refusedDetailFor({ ...input, kind: "clock" })).toBe(START_CLOCK_MESSAGE);
    expect(refusedDetailFor({ ...input, kind: "other" })).toBe(REFUSED_OTHER);
    expect(refusedDetailFor({ ...input, kind: "blocked", refusedRows: 2, refusedSets: 2 })).toBe(refusedBlocked(2, 2));
  });
});

describe("06.7 AC29 — minor 697: the banner counts refused rows", () => {
  it("a refused note among them makes them things", () => {
    expect(refusedBlocked(3, 2)).toBe("3 things couldn't be saved. Fix or discard them, then tap Finish again.");
    expect(refusedBlocked(1, 0)).toBe("1 thing couldn't be saved. Fix or discard it, then tap Finish again.");
  });

  it("Review Focus 1: a sets-only refusal reads exactly as today", () => {
    expect(refusedBlocked(2, 2)).toBe("2 sets couldn't be saved. Fix or discard them, then tap Finish again.");
    expect(refusedBlocked(1, 1)).toBe("1 set couldn't be saved. Fix or discard it, then tap Finish again.");
  });

  it("the blocked kind passes both counts", () => {
    expect(refusedDetailFor({ ...input, kind: "blocked", refusedRows: 3, refusedSets: 2 })).toBe(refusedBlocked(3, 2));
  });
});
