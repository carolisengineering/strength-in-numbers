import { describe, expect, it } from "vitest";
import type { HevyLinkState } from "@sin/core";

import { inTimeZone } from "../../../test/timeZone";
import type { SendOutcome } from "./runSend";
import { sectionView } from "./sectionState";
import { sentDay } from "./sentDay";

const link = (state: HevyLinkState["state"], origin: HevyLinkState["origin"] = "sent"): HevyLinkState => ({
  state,
  hevyWorkoutId: state === "sent" || state === "changed" ? "h1" : null,
  origin: state === "sent" || state === "changed" ? origin : null,
  syncedAt: state === "sent" || state === "changed" ? "2026-10-24T18:20:00.000Z" : null,
});
const view = (l: HevyLinkState | "error" | "pending", last: SendOutcome | null = null, pending = false, status: "ok" | "hidden" = "ok") =>
  sectionView({ status, link: l, pending, last });

describe("20.2 AC2 — sectionView", () => {
  it.each([
    ["not the owner", view(link("none"), null, false, "hidden"), { kind: "hidden" }],
    ["link failed", view("error"), { kind: "hidden" }],
    ["link loading", view("pending"), { kind: "hidden" }],
    ["none", view(link("none")), { kind: "none" }],
    ["a claim elsewhere", view(link("sending")), { kind: "sending" }],
    ["this device sending", view(link("none"), null, true), { kind: "sending" }],
    ["sent", view(link("sent")), { kind: "sent", label: "sent", syncedAt: "2026-10-24T18:20:00.000Z" }],
    ["imported", view(link("sent", "imported")), { kind: "sent", label: "fromHevy", syncedAt: "2026-10-24T18:20:00.000Z" }],
    ["matched", view(link("sent", "matched")), { kind: "sent", label: "matched", syncedAt: "2026-10-24T18:20:00.000Z" }],
    ["changed", view(link("changed")), { kind: "changed" }],
    ["changed import", view(link("changed", "imported")), { kind: "changed" }],
    ["gone", view(link("none"), { kind: "gone" }), { kind: "hidden" }],
  ])("%s", (_, actual, expected) => {
    expect(actual).toEqual(expected);
  });

  it("a non-terminal outcome overlays the link's state; done and not-sent defer to the link", () => {
    const unsure: SendOutcome = { kind: "unsure", op: "post", fingerprint: "v1:x", hevyWorkoutId: null };
    expect(view(link("sending"), unsure)).toEqual({ kind: "outcome", outcome: unsure, base: "sending" });
    expect(view(link("none"), { kind: "failed", reason: "rejected" })).toMatchObject({ kind: "outcome", base: "none" });
    expect(view(link("sent"), { kind: "done", foundExisting: false, notices: [] })).toMatchObject({ kind: "sent" });
    expect(view(link("none"), { kind: "not-sent" })).toEqual({ kind: "none" });
    // A run in flight wins over an older outcome.
    expect(view(link("none"), unsure, true)).toEqual({ kind: "sending" });
  });
});

describe("20.2 AC2 — sentDay", () => {
  it("reads the sync instant's day in the device zone, like the summary's date", () =>
    inTimeZone("America/Los_Angeles", () => {
      expect(sentDay("2026-10-24T18:20:00.000Z")).toBe("Sat 24 Oct");
      expect(sentDay("2026-10-25T03:00:00.000Z")).toBe("Sat 24 Oct");
      expect(sentDay("2026-10-25T03:00:00.000Z", { timeZone: "Europe/London" })).toBe("Sun 25 Oct");
    }));
});
