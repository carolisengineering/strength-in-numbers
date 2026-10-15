import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => ({ logout: auth.logout }) }));

import { makeQueryClient } from "../../test/accountHarness";
import { AccountDeletedConfirmation } from "./AccountDeletedConfirmation";

const deletion = (timeZone: string) => ({
  response: { deletedAt: "2026-10-14T02:00:00.000Z", purgeEligibleAt: "2026-11-13T02:00:00.000Z" },
  timeZone,
});
const renderIt = (timeZone = "America/Los_Angeles") =>
  render(<QueryClientProvider client={makeQueryClient()}><AccountDeletedConfirmation deletion={deletion(timeZone)} /></QueryClientProvider>);

beforeEach(() => {
  auth.logout.mockReset();
  window.localStorage.clear();
});

describe("12 AC21 — the confirmation screen", () => {
  it("shows the title, the erase date in the profile zone, the owner line, and exactly one button", () => {
    renderIt("America/Los_Angeles");
    expect(screen.getByRole("heading", { level: 1, name: "Your account is scheduled for deletion" })).toBeInTheDocument();
    expect(screen.getByText("Your account is locked. Your data won't be erased before November 12, 2026.")).toBeInTheDocument();
    expect(screen.getByText("To restore your account before then, contact the app owner.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("uses the next calendar day for a zone ahead of UTC", () => {
    renderIt("Pacific/Auckland");
    expect(screen.getByText(/won't be erased before November 13, 2026\./)).toBeInTheDocument();
  });
  it("moves focus to the heading", () => {
    renderIt();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });
});

describe("12 AC22 — Sign out", () => {
  it("clears user-scoped storage, keeps unrelated keys, and calls Auth0 logout once", async () => {
    window.localStorage.setItem("sin:catalog:v1:user-a", "{}");
    window.localStorage.setItem("theme", "dark");
    renderIt();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(auth.logout).toHaveBeenCalledWith({ logoutParams: { returnTo: window.location.origin } });
    expect(window.localStorage.getItem("sin:catalog:v1:user-a")).toBeNull();
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });
});
