import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HEVY_EXPORT_NOTICES } from "@sin/core";

import type { HevyErrorKind } from "../client/hevyErrors";
import { HEVY_COPY } from "../messages";
import { HEVY_SEND_COPY, hevyFailureSentence, needsMatching, noticeSentence } from "./messages";

const KINDS: readonly HevyErrorKind[] = ["bad_key", "limit", "rate_limited", "rejected", "not_found", "server", "network", "unexpected_reply", "aborted"];

describe("20.2 AC19 — every kind, slug and notice has a static sentence", () => {
  it("every Hevy error kind has a sentence; AC8's three are its own, network and the limit are 20.0's", () => {
    for (const kind of KINDS) expect(hevyFailureSentence(kind)).toMatch(/\S/);
    expect(hevyFailureSentence("rejected")).toBe("Hevy didn't accept this workout.");
    expect(hevyFailureSentence("limit")).toBe("Your Hevy account has reached a limit.");
    expect(hevyFailureSentence("bad_key")).toBe("Hevy didn't accept your key. Check it in Profile.");
    expect(hevyFailureSentence("network")).toBe(HEVY_COPY.network);
    expect(HEVY_SEND_COPY.network).toBe("Couldn't reach Hevy. Check your connection and try again.");
    expect(HEVY_SEND_COPY.templateLimit).toBe(HEVY_COPY.limit);
  });

  it("every export notice code and left_out has a sentence (title_fallback has none)", () => {
    for (const code of HEVY_EXPORT_NOTICES) {
      const sentence = noticeSentence({ code, count: 2, ...(code === "section_no_placeholder" ? { names: ["A"] } : {}) });
      if (code === "title_fallback") expect(sentence).toBeNull();
      else expect(sentence).toMatch(/\S/);
    }
    expect(noticeSentence({ code: "left_out", name: "Row" })).toMatch(/\S/);
  });

  it("no copy value holds a placeholder brace, and messages.ts is American English", () => {
    for (const value of Object.values(HEVY_SEND_COPY)) expect(value).not.toMatch(/[{}]/);
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "messages.ts"), "utf8");
    expect(source).not.toMatch(/colour|cancelled|grey|favourite|behaviour/i);
  });
});

describe("20.2 AC15 — notice sentences", () => {
  it.each([
    [{ code: "sets_not_sent" as const, count: 2 }, "2 sets weren't sent because they were incomplete."],
    [{ code: "sets_not_sent" as const, count: 1 }, "1 set wasn't sent because it was incomplete."],
    [{ code: "rpe_dropped" as const, count: 1 }, "RPE below 6 was left out of 1 set."],
    [{ code: "rpe_dropped" as const, count: 3 }, "RPE below 6 was left out of 3 sets."],
    [{ code: "rpe_rounded" as const, count: 4 }, "RPE was rounded to Hevy's steps on 4 sets."],
    [{ code: "distance_rounded" as const, count: 2 }, "Distances were rounded to whole meters."],
    [{ code: "section_no_placeholder" as const, count: 1, names: ["Warm-up"] }, "Section 'Warm-up' had no marker exercise, so its note went on the first exercise."],
    [
      { code: "section_no_placeholder" as const, count: 2, names: ["Warm-up", "Finisher"] },
      "Sections 'Warm-up' and 'Finisher' had no marker exercise, so their notes went on the first exercise.",
    ],
    [{ code: "left_out" as const, name: "Echo Bike" }, "Echo Bike was left out."],
  ])("%j", (notice, sentence) => {
    expect(noticeSentence(notice)).toBe(sentence);
  });
});

describe("20.2 AC23 / AC25 — auto-push copy", () => {
  it("the switch label and help, verbatim", () => {
    expect(HEVY_SEND_COPY.autoPushLabel).toBe("Send each workout to Hevy when I finish it");
    expect(HEVY_SEND_COPY.autoPushHelp).toBe("Works while the app is open. If something can't be sent, the workout's screen has a Send to Hevy button.");
  });

  it("the needs-matching line, singular and plural", () => {
    expect(needsMatching(1)).toBe("1 exercise needs matching before this can go to Hevy.");
    expect(needsMatching(3)).toBe("3 exercises need matching before this can go to Hevy.");
  });
});
