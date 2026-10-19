import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AuthError } from "./AuthError";

function renderAuthError(description?: string) {
  const router = createMemoryRouter(
    [
      { path: "/callback", element: <AuthError description={description} /> },
      { path: "/", element: <p>home</p> },
    ],
    { initialEntries: ["/callback"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const normalized = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("BL-20 — the sign-in error on the front door", () => {
  it("the heading is the error, and the decorative name is hidden from assistive tech", () => {
    renderAuthError("Invalid state");
    const main = screen.getByTestId("auth-error");

    const [heading, ...others] = within(main).getAllByRole("heading");
    expect(others).toEqual([]);
    expect(heading).toHaveAccessibleName("Couldn't sign you in.");
    expect(heading!.tagName).toBe("H1");

    const name = within(main).getByText("in Numbers").parentElement!;
    expect(normalized(name)).toBe("Strength in Numbers");
    expect(name).toHaveAttribute("aria-hidden", "true");
  });

  it("says the workouts are safe and shows Auth0's description verbatim after Details:", () => {
    renderAuthError("Invalid state");
    expect(screen.getByText("Your workouts are safe.")).toBeInTheDocument();
    expect(screen.getByTestId("auth-error-detail")).toHaveTextContent(/^Details: Invalid state$/);
  });

  it("shows no detail line without a description", () => {
    renderAuthError();
    expect(screen.queryByTestId("auth-error-detail")).toBeNull();
    expect(screen.queryByText(/Details:/)).toBeNull();
    expect(screen.getByText("Your workouts are safe.")).toBeInTheDocument();
  });

  it("Try again is the one button and returns to /?signin (Spec 04.0 AC6 loop guard)", async () => {
    const router = renderAuthError("Invalid state");
    const [button, ...others] = screen.getAllByRole("button");
    expect(others).toEqual([]);
    expect(button).toHaveAccessibleName("Try again");

    await userEvent.click(button!);
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.location.search).toBe("?signin");
  });
});
