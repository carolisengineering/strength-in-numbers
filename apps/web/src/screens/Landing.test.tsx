import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ loginWithRedirect: vi.fn() }));
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({ loginWithRedirect: auth.loginWithRedirect }),
}));

import { resetConfigCache } from "../config";
import { Landing } from "./Landing";

beforeEach(() => {
  resetConfigCache();
  vi.stubEnv("VITE_AUTH0_DOMAIN", "dev-tenant.us.auth0.com");
  vi.stubEnv("VITE_AUTH0_CLIENT_ID", "spaClient123");
  vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.strengthinnumbers.app");
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
  vi.stubEnv("VITE_APP_ENV", "staging");
  auth.loginWithRedirect = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function renderLanding(returnTo?: string) {
  return render(
    <MemoryRouter>
      <Landing returnTo={returnTo} />
    </MemoryRouter>,
  );
}

const normalized = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

function pageshow(persisted: boolean): Event {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

describe("17.3 AC1 — exact landing copy", () => {
  it("renders the name in two lines, the two-line sentence and Log in", () => {
    renderLanding();
    const main = screen.getByTestId("landing");

    const heading = within(main).getByRole("heading", { level: 1 });
    expect(heading).toHaveAccessibleName("Strength in Numbers");
    expect([...heading.querySelectorAll("span")].map((s) => s.textContent)).toEqual(["Strength", "in Numbers"]);

    const line = main.querySelector("p")!;
    expect(normalized(line)).toBe("Log your lifts. Count your progress.");
    expect([...line.querySelectorAll("span")].map((s) => s.textContent)).toEqual([
      "Log your lifts.",
      "Count your progress.",
    ]);

    expect(within(main).getByRole("button")).toHaveTextContent(/^Log in$/);
  });
});

describe("17.3 AC2 — nothing else on the landing", () => {
  it("holds one heading, one paragraph and one button, and no other content element", () => {
    renderLanding();
    const main = screen.getByTestId("landing");

    const tags = [...main.querySelectorAll("*")].map((el) => el.tagName.toLowerCase());
    expect(tags.filter((t) => t === "h1")).toHaveLength(1);
    expect(tags.filter((t) => t === "p")).toHaveLength(1);
    expect(tags.filter((t) => t === "button")).toHaveLength(1);
    expect(tags.filter((t) => !["div", "h1", "p", "span", "button"].includes(t))).toEqual([]);
    expect(main.querySelector("[aria-live]")).toBeNull();

    // Every text node lives inside the heading, the paragraph or the button.
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      expect(node.parentElement!.closest("h1, p, button")).not.toBeNull();
    }
  });
});

describe("17.3 AC3 / AC29 — landmark, heading and names", () => {
  it("has one main with one h1, a Log in button, in h1 / p / button order, with no added aria", () => {
    renderLanding();

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    const button = screen.getByRole("button", { name: /^log in$/i });

    const main = screen.getByRole("main");
    const order = [...main.querySelectorAll("h1, p, button")].map((el) => el.tagName.toLowerCase());
    expect(order).toEqual(["h1", "p", "button"]);
    for (const el of main.querySelectorAll("*")) {
      expect(el.hasAttribute("aria-label")).toBe(false);
      expect(el.hasAttribute("aria-labelledby")).toBe(false);
      expect(el.hasAttribute("role")).toBe(false);
    }
    expect(button).toBeVisible();
  });
});

describe("17.3 AC4 — the login control is the shared primary block Button", () => {
  it("carries the Button classes for the primary variant and block", () => {
    renderLanding();
    const className = screen.getByRole("button", { name: /log in/i }).className;
    expect(className).toMatch(/primary/);
    expect(className).toMatch(/block/);
  });
});

describe("17.3 AC6 — Log in runs the same login", () => {
  it("defaults returnTo to /app", async () => {
    renderLanding();
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));

    expect(auth.loginWithRedirect).toHaveBeenCalledTimes(1);
    expect(auth.loginWithRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        appState: { returnTo: "/app" },
        authorizationParams: expect.objectContaining({
          audience: "https://api.strengthinnumbers.app",
          scope: "openid profile email offline_access",
        }),
      }),
    );
  });

  it("forwards an explicit returnTo", async () => {
    renderLanding("/app/history/123");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));

    expect(auth.loginWithRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: "/app/history/123" } }),
    );
  });
});

describe("17.3 AC7 — the landing is inert on arrival", () => {
  it("makes no request and starts no login on mount", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderLanding();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(auth.loginWithRedirect).not.toHaveBeenCalled();
  });
});

describe("17.3 AC11 — stable test hooks", () => {
  it("keeps the landing and landing-login test ids", () => {
    renderLanding();
    expect(screen.getByTestId("landing").tagName).toBe("MAIN");
    expect(screen.getByTestId("landing-login")).toBe(screen.getByRole("button", { name: /log in/i }));
  });
});

describe("17.3 AC12 — a second tap does nothing", () => {
  it("two rapid clicks start exactly one login, and the button turns busy", async () => {
    renderLanding();
    const button = screen.getByRole("button", { name: /log in/i });

    await userEvent.click(button);
    await userEvent.click(button);

    expect(auth.loginWithRedirect).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/^Log in$/);
  });

  it("two clicks in the same task, before any re-render, still start one login", () => {
    renderLanding();
    const button = screen.getByRole("button", { name: /log in/i });

    act(() => {
      button.click();
      button.click();
    });

    expect(auth.loginWithRedirect).toHaveBeenCalledTimes(1);
  });

  it("Enter and Space after the first activation call nothing more", async () => {
    renderLanding();
    const button = screen.getByRole("button", { name: /log in/i });

    button.focus();
    await userEvent.keyboard("{Enter}");
    button.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");

    expect(auth.loginWithRedirect).toHaveBeenCalledTimes(1);
  });
});

describe("17.3 AC13 — Back restores a usable button", () => {
  it("a back/forward-cache restore clears the busy state", async () => {
    renderLanding();
    const button = screen.getByRole("button", { name: /log in/i });
    await userEvent.click(button);

    act(() => {
      window.dispatchEvent(pageshow(true));
    });

    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    await userEvent.click(button);
    expect(auth.loginWithRedirect).toHaveBeenCalledTimes(2);
  });

  it("an ordinary pageshow leaves the button busy", async () => {
    renderLanding();
    const button = screen.getByRole("button", { name: /log in/i });
    await userEvent.click(button);

    act(() => {
      window.dispatchEvent(pageshow(false));
    });

    expect(button).toBeDisabled();
  });

  it("starts not busy and removes its listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderLanding();
    expect(screen.getByRole("button", { name: /log in/i })).toBeEnabled();

    unmount();
    expect(remove).toHaveBeenCalledWith("pageshow", expect.any(Function));
  });
});

describe("17.3 AC28 — one tab stop, nothing auto-focused", () => {
  it("Tab from the document start lands on Log in, and nothing has tabindex or autofocus", async () => {
    renderLanding();
    expect(document.activeElement).toBe(document.body);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /log in/i }));
    await userEvent.tab();
    expect(document.activeElement).toBe(document.body);

    const main = screen.getByTestId("landing");
    expect(main.querySelector("[tabindex], [autofocus]")).toBeNull();
  });
});
