import type { SectionTimer } from "@sin/core";
import { describe, expect, it } from "vitest";
import { makeTimedSection } from "../../../test/workoutFixtures";
import { sectionBody } from "./sectionFields";

const AMRAP12: SectionTimer = { format: "amrap", capSeconds: 720 };
const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };

describe("10.7 AC15 — request bodies", () => {
  describe("add", () => {
    it("no timer sends no timer key", () => {
      expect(sectionBody("add", { name: "Main", notes: "", timer: null })).toStrictEqual({ name: "Main" });
    });

    it("an AMRAP sends its cap", () => {
      expect(sectionBody("add", { name: "Main", notes: "", timer: AMRAP12 })).toStrictEqual({ name: "Main", timer: { format: "amrap", capSeconds: 720 } });
    });

    it("a Time Cap with no cap sends only the format", () => {
      const body = sectionBody("add", { name: "Main", notes: "", timer: { format: "time_cap", capSeconds: null } });
      expect(Object.keys(body!.timer!)).toEqual(["format"]);
    });

    it("a note and a timer go together", () => {
      expect(sectionBody("add", { name: "Main", notes: "Go", timer: SET5 })).toStrictEqual({ name: "Main", notes: "Go", timer: SET5 });
    });
  });

  describe("edit", () => {
    const stored = makeTimedSection({ name: "Main", timer: SET5 });

    it("a name-only change on a timed section has no timer key (Review Focus 1)", () => {
      const body = sectionBody("edit", { name: "Main set", notes: "", timer: { ...SET5 } }, stored);
      expect(body).toStrictEqual({ name: "Main set" });
    });

    it("removing the timer sends timer: null", () => {
      expect(sectionBody("edit", { name: "Main", notes: "", timer: null }, stored)).toStrictEqual({ timer: null });
    });

    it("name and timer both changed send both keys", () => {
      expect(sectionBody("edit", { name: "Finisher", notes: "", timer: AMRAP12 }, stored)).toStrictEqual({ name: "Finisher", timer: AMRAP12 });
    });

    it("nothing changed gives null", () => {
      expect(sectionBody("edit", { name: "Main", notes: "", timer: { rounds: 5, format: "set_timer", roundSeconds: 300 } }, stored)).toBeNull();
    });

    it("a changed Time Cap with no cap sends only the format", () => {
      const body = sectionBody("edit", { name: "Main", notes: "", timer: { format: "time_cap", capSeconds: null } }, stored);
      expect(body).toStrictEqual({ timer: { format: "time_cap" } });
    });
  });
});
