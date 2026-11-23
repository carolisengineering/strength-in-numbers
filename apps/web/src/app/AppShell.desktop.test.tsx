import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { isLoading: false, isAuthenticated: true, getAccessTokenSilently: vi.fn(), logout: vi.fn() },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { ME_QUERY_KEY } from "../features/me/useMe";
import { stubAccountEnv, unstubAccountEnv } from "../test/accountHarness";
import { resetDesktop, setDesktop } from "../test/desktop";
import { AppShell, SKIP_TO_CONTENT } from "./AppShell";
import { NAV_ITEMS } from "./navItems";

const HERE = dirname(fileURLToPath(import.meta.url));

const ME = {
  id: "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c",
  email: "lifter@example.com",
  displayName: "Carol",
  unitPreference: "kg",
  timezone: "Europe/London",
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

/** A screen with a text field, standing in for a half-typed form (the routine editor's name). */
function FormScreen() {
  return (
    <section aria-label="Form">
      <label>
        Routine name
        <input name="routine-name" />
      </label>
    </section>
  );
}

function HeadingScreen() {
  return (
    <section aria-labelledby="t">
      <h1 id="t">History</h1>
      <input aria-label="Search" />
    </section>
  );
}

function renderShell(path = "/app/workouts", element = <FormScreen />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(ME_QUERY_KEY, ME);
  const router = createMemoryRouter([{ path: "/app", element: <AppShell />, children: [{ path: "*", element }] }], {
    initialEntries: [path],
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, shell: screen.getByTestId("app-shell") };
}

const mainOf = () => screen.getByRole("main");
const primaryNav = () => screen.getByRole("navigation", { name: "Primary" });
const precedes = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => stubAccountEnv());
afterEach(() => {
  resetDesktop();
  unstubAccountEnv();
});

describe("17.12 AC3 — phone and tablet keep today's shell", () => {
  it("with no matchMedia: a header, the bottom nav after <main>, and no skip link", () => {
    const { shell } = renderShell();
    expect(shell.querySelector("header")).not.toBeNull();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(precedes(mainOf(), primaryNav())).toBe(true);
    expect(screen.queryByText(SKIP_TO_CONTENT)).toBeNull();
    expect(shell).not.toHaveAttribute("data-layout");
  });

  it("below 64rem with matchMedia present, the same", () => {
    setDesktop(false);
    const { shell } = renderShell();
    expect(shell.querySelector("header")).not.toBeNull();
    expect(screen.queryByText(SKIP_TO_CONTENT)).toBeNull();
  });
});

describe("17.12 AC4 — the rail", () => {
  beforeEach(() => setDesktop(true));

  it("is the one Primary nav: the four sections in order, each with its icon, then the user link", () => {
    renderShell("/app/history");
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const links = within(primaryNav()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([...NAV_ITEMS.map((item) => item.label), "Carol"]);
    for (const link of links.slice(0, NAV_ITEMS.length)) expect(link.querySelector("svg")).not.toBeNull();
    const user = links.at(-1)!;
    expect(user).toHaveAttribute("data-testid", "app-shell-user");
    expect(user).toHaveAccessibleName("Profile: Carol");
    expect(user).toHaveAttribute("href", "/app/profile");
  });

  it("marks the current section with aria-current", () => {
    renderShell("/app/history/abc");
    expect(within(primaryNav()).getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    expect(within(primaryNav()).getByRole("link", { name: "Workouts" })).not.toHaveAttribute("aria-current");
  });

  it("names the app as plain text, not a link or a heading, and there is no header", () => {
    const { shell } = renderShell();
    const name = within(primaryNav()).getByText("Strength in Numbers");
    expect(name.closest("a")).toBeNull();
    expect(name.closest("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(shell.querySelector("header")).toBeNull();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(shell).toHaveAttribute("data-layout", "wide");
  });
});

describe("17.12 AC5 — DOM order matches the picture", () => {
  it("wide: the rail comes before <main>", () => {
    setDesktop(true);
    renderShell();
    expect(precedes(primaryNav(), mainOf())).toBe(true);
  });

  it("narrow: <main> comes before the bottom nav, as today", () => {
    renderShell();
    expect(precedes(mainOf(), primaryNav())).toBe(true);
  });
});

describe("17.12 AC6 — skip link and focus order", () => {
  beforeEach(() => setDesktop(true));

  it("Review Focus 1 (minor 645): with no h1 on the screen, Skip to content moves focus to <main>, which keeps no tabindex after", async () => {
    const user = userEvent.setup();
    renderShell();
    expect(mainOf()).not.toHaveAttribute("tabindex");
    await user.tab();
    const skip = screen.getByRole("link", { name: SKIP_TO_CONTENT });
    expect(skip).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(mainOf()).toHaveFocus();
    await user.tab();
    expect(mainOf()).not.toHaveFocus();
    expect(mainOf()).not.toHaveAttribute("tabindex");
  });

  it("minor 694 — a click after Skip to content drops main's borrowed tabindex", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(mainOf()).toHaveFocus();
    expect(mainOf()).toHaveAttribute("tabindex", "-1");
    fireEvent.pointerDown(mainOf());
    expect(mainOf()).not.toHaveAttribute("tabindex");
  });

  it("17.12 AC6 — minor 645: Skip to content focuses the page's heading, named by the page, with no tabindex left after", async () => {
    const user = userEvent.setup();
    renderShell("/app/history", <HeadingScreen />);
    await user.tab();
    await user.keyboard("{Enter}");
    const heading = screen.getByRole("heading", { level: 1, name: "History" });
    expect(heading).toHaveFocus();
    expect(mainOf()).not.toHaveAttribute("tabindex");
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus();
    expect(heading).not.toHaveAttribute("tabindex");
  });

  it("review focus 5: skip link, the four sections, the user link, then the page's content (the app name never)", async () => {
    const user = userEvent.setup();
    renderShell();
    const order: string[] = [];
    for (let i = 0; i < NAV_ITEMS.length + 3; i += 1) {
      await user.tab();
      const active = document.activeElement as HTMLElement;
      order.push(active.getAttribute("aria-label") ?? active.getAttribute("name") ?? active.textContent ?? "");
    }
    expect(order).toEqual([SKIP_TO_CONTENT, ...NAV_ITEMS.map((item) => item.label), "Profile: Carol", "routine-name"]);
  });
});

/** The bodies of every `@media <condition> { … }` block in `css`, braces balanced, joined. */
function mediaBlock(css: string, condition: string): string {
  const bodies: string[] = [];
  for (let start = css.indexOf(`@media ${condition} {`); start >= 0; start = css.indexOf(`@media ${condition} {`, start + 1)) {
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      if (depth === 0) {
        bodies.push(css.slice(open + 1, i));
        break;
      }
    }
  }
  return bodies.join("\n");
}

/** `css` with every `@media … { … }` block cut out (the rules that apply at every width). */
function outsideMedia(css: string): string {
  let out = css;
  for (let start = out.indexOf("@media"); start >= 0; start = out.indexOf("@media")) {
    let depth = 0;
    let end = out.indexOf("{", start);
    for (let i = end; i < out.length; i += 1) {
      if (out[i] === "{") depth += 1;
      if (out[i] === "}") depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    out = out.slice(0, start) + out.slice(end + 1);
  }
  return out;
}

const escape = (selector: string) => selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rule = (css: string, selector: string) => css.match(new RegExp(`(?:^|[}\\s])${escape(selector)}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
const shellCss = readFileSync(join(HERE, "AppShell.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const DESKTOP = "(min-width: 64rem)";
const BELOW_DESKTOP = "not all and (min-width: 64rem)";

describe("17.12 AC7 — <main> fills the rest of the width", () => {
  it("at 64rem the wide shell is a rail column and a 1fr column, and <main> drops the 48rem cap", () => {
    const wide = mediaBlock(shellCss, DESKTOP);
    expect(rule(wide, '.shell[data-layout="wide"]')).toMatch(/grid-template-columns:\s*var\(--sidebar-width\) minmax\(0, 1fr\)/);
    expect(rule(wide, '.shell[data-layout="wide"] .main')).toMatch(/max-width:\s*none/);
  });
});

describe("17.12 AC8 — the frame is still fixed, and the rail stays under the keyboard", () => {
  const keyboard = (selector: string) => `:global(:root[data-keyboard="open"]) ${selector}`;

  it("the frame keeps position: fixed and inset: 0, outside any media block", () => {
    const shell = rule(outsideMedia(shellCss), ".shell");
    expect(shell).toMatch(/position:\s*fixed/);
    expect(shell).toMatch(/inset:\s*0/);
  });

  it("the keyboard frame's top and height apply at every width", () => {
    const frame = rule(outsideMedia(shellCss), keyboard(".shell"));
    expect(frame).toMatch(/top:\s*var\(--app-top\)/);
    expect(frame).toMatch(/height:\s*var\(--app-height\)/);
  });

  it("review focus 2: the header and bottom nav hide under the keyboard only below 64rem; the rail never does", () => {
    const below = mediaBlock(shellCss, BELOW_DESKTOP);
    expect(rule(below, keyboard(".nav"))).toMatch(/display:\s*none/);
    expect(rule(below, keyboard(".header"))).toMatch(/display:\s*none/);
    const elsewhere = outsideMedia(shellCss);
    expect(rule(elsewhere, keyboard(".nav"))).toBe("");
    expect(rule(elsewhere, keyboard(".header"))).toBe("");
    expect(shellCss).not.toMatch(/data-keyboard="open"\]\)\s*\.rail/);
  });
});

// Final review #1: with no header and no bottom nav, nothing else pads the wide shell for an iPad's safe areas
// (`viewport-fit=cover`); a bar at <main>'s bottom would sit under the home indicator.
describe("17.12 AC8 — the safe areas at desktop widths", () => {
  const actionBarCss = readFileSync(join(HERE, "..", "ui", "ActionBar.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("the wide shell clears the top inset itself, as the keyboard frame does (the same value, so never twice)", () => {
    expect(rule(mediaBlock(shellCss, DESKTOP), '.shell[data-layout="wide"]')).toMatch(/padding-top:\s*env\(safe-area-inset-top\)/);
  });

  it("the rail clears the bottom inset", () => {
    expect(rule(outsideMedia(shellCss), ".rail")).toMatch(/padding-bottom:[^;]*env\(safe-area-inset-bottom\)/);
  });

  it("a bottom action bar (the editor's, the workout's) clears the bottom inset at 64rem, where no nav is under it", () => {
    expect(rule(mediaBlock(actionBarCss, DESKTOP), ".bar")).toMatch(/padding-bottom:\s*calc\(var\(--space-3\) \+ env\(safe-area-inset-bottom\)\)/);
  });

  // Code review #1: while a keyboard is up the bar rides on it (the frame ends at the keyboard), so the home
  // indicator's inset would leave a gap above the keyboard, as a sheet's row drops it too.
  it("with a keyboard up, the bar drops the inset again", () => {
    expect(rule(mediaBlock(actionBarCss, DESKTOP), ':global(:root[data-keyboard="open"]) .bar')).toMatch(/padding-bottom:\s*var\(--space-3\)/);
  });
});

describe("17.12 review focus 1 — a resize across 64rem keeps the page's state", () => {
  it("a half-typed field survives the switch both ways, as the same node", async () => {
    const user = userEvent.setup();
    setDesktop(false);
    renderShell("/app/workouts/routines/new");
    const field = screen.getByRole("textbox", { name: "Routine name" });
    await user.type(field, "Push");
    act(() => setDesktop(true));
    expect(screen.getByRole("textbox", { name: "Routine name" })).toBe(field);
    expect(field).toHaveValue("Push");
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-layout", "wide");
    act(() => setDesktop(false));
    expect(screen.getByRole("textbox", { name: "Routine name" })).toBe(field);
    expect(field).toHaveValue("Push");
  });
});
