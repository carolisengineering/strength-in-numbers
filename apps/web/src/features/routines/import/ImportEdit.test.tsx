import { act, screen, waitFor, within } from "@testing-library/react";
import { chooseSegmentValue } from "../../../test/controls";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false,
    isAuthenticated: true,
    error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { cardGroup, cardGroups, importCatalog, readHiraya } from "../../../test/importFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { IMPORT_PATH } from "../paths";
import { CONTINUE, IMPORTED_NOTICE, NAMES_TITLE, OPEN_ANYWAY, importNoticeText, newOption } from "./messages";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

function start() {
  const fake = createWorkoutFake({ catalog: [...importCatalog] });
  prepareApp({ auth, fake, catalog: [...importCatalog] });
  return { fake, ...renderApp(IMPORT_PATH) };
}

async function continueFromNames(user: UserEvent) {
  await waitFor(() => expect(cardGroups().length).toBeGreaterThan(0));
  await user.click(screen.getByRole("button", { name: CONTINUE }));
  await screen.findByRole("heading", { level: 1, name: "New routine" });
}

const rows = () => [...document.querySelectorAll<HTMLElement>("li[data-name]")];

describe("10.4 AC30 — the editor receives the import", () => {
  it("New routine mode, the info notice, New tags, the draft", async () => {
    const { user } = start();
    await readHiraya(user);
    await continueFromNames(user);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(IMPORTED_NOTICE);
    expect(screen.getByLabelText("Name")).toHaveValue("Second Shift");
    expect(rows()).toHaveLength(8);
    expect(screen.getByRole("button", { name: /^Hand Release Pushups \(New\)/ })).toHaveTextContent("New");
    expect(screen.getByRole("button", { name: /^Power Clean,/ })).not.toHaveTextContent(/\bNew\b/);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(IMPORTED_NOTICE)).toBeNull();
  });

  it("the item sheet follows the pending exercise's type", async () => {
    const { user } = start();
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    await user.click(within(await cardGroup("Front Raise")).getByRole("radio", { name: "Duration" }));
    await continueFromNames(user);
    await user.click(screen.getByRole("button", { name: /^Front Raise \(New\)/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Sets")).toBeInTheDocument();
    expect(within(sheet).queryByLabelText("Reps")).toBeNull();
  });

  it("Remove works on imported rows", async () => {
    const { user } = start();
    await readHiraya(user);
    await continueFromNames(user);
    const row = rows().find((li) => li.dataset.name === "Reverse Fly")!;
    await user.click(within(row).getByRole("button", { name: "Options" }));
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    expect(rows()).toHaveLength(7);
  });

  it("Back goes through Discard changes and returns to Check names with the choices intact", async () => {
    const { user, router } = start();
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    await user.click(within(await cardGroup("Strict Press")).getByRole("radio", { name: newOption("Strict Press") }));
    await continueFromNames(user);
    await act(() => router.navigate(-1));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(await screen.findByRole("heading", { level: 1, name: NAMES_TITLE })).toBeInTheDocument();
    expect(within(await cardGroup("Strict Press")).getByRole("radio", { name: newOption("Strict Press") })).toBeChecked();
  });
});

describe("10.4 AC22 — open anyway lands in the editor", () => {
  it("sections and notes filled, Save disabled until an exercise is added", async () => {
    const { user } = start();
    await readHiraya(user, "11:41\nWarmup\n400m easy Run\nthen 2 Rounds\n- 10 Arm Circles\nCooldown\nWalk it off.\nHome");
    await user.click(await screen.findByRole("button", { name: OPEN_ANYWAY }));
    expect(await screen.findByRole("heading", { level: 1, name: "New routine" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Warmup" })).toHaveTextContent("400m easy Run");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("10.4 AC34 — overflow is visible in the editor", () => {
  it("a long Workout title: cut name and section, two warnings", async () => {
    const { user } = start();
    await readHiraya(user, `Workout: "${"N".repeat(81)}"\n3 Sets:\n10 Curl\nx.`);
    await continueFromNames(user);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toHaveLength(80);
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toContain(importNoticeText({ code: "name-cut" }));
    expect(alerts).toContain(importNoticeText({ code: "section-name-cut", count: 1 }));
  });

  it("31 exercises: 30 rows and the left-out warning", async () => {
    const { user } = start();
    await readHiraya(user, ["Strength", ...Array.from({ length: 31 }, (_, k) => `- 5 Lift ${String.fromCharCode(65 + (k % 26))}${k}x`), "x."].join("\n"));
    await continueFromNames(user);
    expect(rows()).toHaveLength(30);
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(importNoticeText({ code: "items-left-out", count: 1 }));
  });
});

describe("10.7 AC55 — the editor shows the imported timer", () => {
  const TIMER_TEXT = /Set Timer|AMRAP|Time Cap|For Time$/;
  it("Second Shift reads Time Cap 20:00; the other headers show no plan line; the sheet can remove it", async () => {
    const { user } = start();
    await readHiraya(user);
    await continueFromNames(user);
    const second = screen.getByRole("region", { name: "Second Shift" });
    expect(within(second).getByText("Time Cap 20:00")).toBeInTheDocument();
    expect(within(second).getByText(/20 Minute Cap/)).toBeInTheDocument();
    expect(within(second).getByText(/For Time:/)).toBeInTheDocument();
    for (const name of ["Warmup", "Strict Press", "Accessory"]) {
      expect(within(screen.getByRole("region", { name })).queryByText(TIMER_TEXT)).toBeNull();
    }
    await user.click(screen.getByRole("button", { name: "Edit section Second Shift" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit section" });
    await chooseSegmentValue(user, "Timer", "none", within(dialog));
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Second Shift" })).queryByText("Time Cap 20:00")).toBeNull());
  });
});
