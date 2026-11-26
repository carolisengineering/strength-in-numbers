import type { Exercise } from "@sin/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const COPY = "30000000-0000-4000-8000-000000000099";

vi.mock("./useExerciseMutations", () => ({ useForkExercise: () => ({ mutateAsync: async () => ({ id: COPY }) }) }));
vi.mock("../catalog/useCatalog", () => ({ useCatalog: () => ({ refresh: vi.fn() }) }));

import { ForkButton } from "./ForkButton";
import { exercisePath } from "./paths";

describe("minor 748 — Make your own copy replaces the built-in's entry", () => {
  it("minor 748: Make your own copy replaces the built-in's entry and carries the copied notice", async () => {
    // ForkButton reads only `row.id`.
    const row = { id: "b1" } as Exercise;
    const router = createMemoryRouter([{ path: "/app/exercises/:id", element: <ForkButton row={row} onStatus={vi.fn()} /> }], {
      initialEntries: ["/app/exercises/before", "/app/exercises/b1"],
      initialIndex: 1,
    });
    render(<RouterProvider router={router} />);
    await userEvent.click(screen.getByRole("button", { name: "Make your own copy" }));
    await vi.waitFor(() => expect(router.state.location.pathname).toBe(exercisePath(COPY)));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(router.state.location.state).toEqual({ notice: "copied" });
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/app/exercises/before");
  });
});
