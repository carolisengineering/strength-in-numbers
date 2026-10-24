import { readWorkoutText } from "@sin/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HIRAYA_TEXT, importCatalog } from "../../../test/importFixtures";
import { cardNames, initialCards } from "./cards";
import { NEW_DETAILS_INVALID } from "./messages";
import { NameCard } from "./NameCard";

describe("deferred minor 25 — a New card the schema refuses for a reason other than its name says so", () => {
  it("shows a message on the card for an `invalid` problem", () => {
    const card = { ...initialCards(cardNames(readWorkoutText(HIRAYA_TEXT)), importCatalog)[2]!, selected: "new" as const };
    render(
      <NameCard
        card={card}
        problem={{ kind: "invalid" }}
        visible={importCatalog}
        rows={importCatalog}
        muscleGroups={[]}
        equipment={[]}
        onChange={vi.fn()}
        onChooseAnother={vi.fn()}
        registerSelected={vi.fn()}
      />,
    );
    expect(screen.getByText(NEW_DETAILS_INVALID)).toBeInTheDocument();
  });
});
