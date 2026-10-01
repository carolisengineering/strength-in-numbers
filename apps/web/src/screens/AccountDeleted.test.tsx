import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({ logout: auth.logout }),
}));

import { AccountDeleted } from "./AccountDeleted";

beforeEach(() => {
  auth.logout.mockReset();
  window.localStorage.clear();
});

describe("AC20 — <AccountDeleted> clears user data when it logs out", () => {
  it("removes user-scoped keys, keeps unrelated ones, and calls Auth0 logout", () => {
    window.localStorage.setItem("sin:catalog:v1:user-a", "{}");
    window.localStorage.setItem("theme", "dark");

    render(<AccountDeleted />);

    expect(auth.logout).toHaveBeenCalledWith({
      logoutParams: { returnTo: window.location.origin },
    });
    expect(window.localStorage.getItem("sin:catalog:v1:user-a")).toBeNull();
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });
});
