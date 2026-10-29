import * as core from "@sin/core";
import { readWorkoutText } from "@sin/core";
import { describe, expect, it, vi } from "vitest";

import { cardNames, initialCards } from "./cards";
import { buildHandoff } from "./handoff";

// A spy that still guesses, so the plan is built as usual.
vi.mock("@sin/core", async (importOriginal) => {
  const actual = await importOriginal<typeof core>();
  return { ...actual, guessModality: vi.fn(actual.guessModality) };
});

describe("18.1 AC34 — importer hint", () => {
  it("the handoff's fallback guess for an unmatched, unsaved name uses the hint too", () => {
    const read = readWorkoutText(["Engine", "3 Sets:", "20 Cal Row", "Max Cal Row", "x."].join("\n"));
    const cards = initialCards(cardNames(read), []);
    vi.mocked(core.guessModality).mockClear();
    const h = buildHandoff({ read, cards: cards.map((c) => ({ ...c, selected: "match" as const, match: null })), rows: [], placeholderFor: (k) => `ph-${k}` });
    // No exercise chosen: the plan's modality comes from the guess, and the guess was given the reader's hint.
    expect(vi.mocked(core.guessModality)).toHaveBeenCalledWith("Row", { calories: true });
    expect(vi.mocked(core.guessModality)).toHaveReturnedWith("calories");
    expect(h.plan.items.map((i) => i.notes)).toEqual(["20 Cal", "Max Cal"]);
  });
});
