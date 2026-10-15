import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { server } from "../../test/msw/server";
import {
  ACCOUNT_URL, EXPORT_URL, ME, ME_URL, problem, renderProfile, stubAccountEnv, unstubAccountEnv,
} from "../../test/accountHarness";
import { STEP_SETTLE_MS } from "./messages";

beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
  server.use(http.get(ME_URL, () => HttpResponse.json(ME)));
});
afterEach(unstubAccountEnv);

describe("12 AC23 — accessibility", () => {
  it("each section is a region named by its heading", () => {
    renderProfile();
    const data = screen.getByRole("region", { name: "Your data" });
    const remove = screen.getByRole("region", { name: "Delete account" });
    expect(within(data).getByRole("heading", { level: 2, name: "Your data" })).toBeInTheDocument();
    expect(within(remove).getByRole("heading", { level: 2, name: "Delete account" })).toBeInTheDocument();
  });

  it("the status region exists before it is filled, and busy uses aria-busy", async () => {
    server.use(http.get(EXPORT_URL, () => new Promise<Response>(() => {})));
    renderProfile();
    const data = within(screen.getByRole("region", { name: "Your data" }));
    const status = data.getByRole("status");
    expect(status).toHaveTextContent("");

    await userEvent.click(data.getByRole("button", { name: "Download my data" }));

    const busy = await data.findByRole("button", { name: "Preparing your data…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Preparing your data…");
  });

  it("the dialog is labeled by its title and errors are role=alert text, not color alone", async () => {
    server.use(http.delete(ACCOUNT_URL, () => problem(500, "internal")));
    renderProfile();
    await userEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    const confirm = within(screen.getByRole("dialog", { name: "Are you sure?" })).getByRole("button", { name: "Delete my account" });
    await waitFor(() => expect(confirm).toBeEnabled(), { timeout: STEP_SETTLE_MS + 1500 });
    await userEvent.click(confirm);

    const alert = await within(screen.getByRole("dialog")).findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't delete your account.");
  });

  it("every button has a visible text label", async () => {
    renderProfile();
    await userEvent.click(screen.getByRole("button", { name: "Delete account…" }));
    for (const button of screen.getAllByRole("button", { hidden: true })) {
      expect(button.textContent?.trim(), button.outerHTML).not.toBe("");
    }
  });
});
