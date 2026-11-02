import { screen, within } from "@testing-library/react";
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

import { exerciseId } from "../../test/catalogFixtures";
import { catalog, pushSectioned } from "../../test/routineFixtures";
import { makeRoutine, makeRoutineItem, makeRoutineSection, routineId, sectionId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { GROUP_CAP_LINE } from "../sectionTimer/timerCopy";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

/** "Main" holds Bench, Row and Overhead Press, all loose. */
const threeLoose = makeRoutine({
  id: routineId(3),
  name: "Conditioning",
  sections: [makeRoutineSection({ id: sectionId(3), position: 0, name: "Main", notes: "Rx" })],
  items: [1, 2, 3].map((n, p) => makeRoutineItem({ position: p, exerciseId: exerciseId(n), sectionId: sectionId(3) })),
});
/** A timed "Main" (AMRAP) holding one superset of 8 and a loose 9th. */
const nine = makeRoutine({
  id: routineId(4),
  name: "Long",
  sections: [makeRoutineSection({ id: sectionId(4), position: 0, name: "Main", timer: { format: "amrap", capSeconds: 1200 } })],
  items: Array.from({ length: 9 }, (_, p) =>
    makeRoutineItem({ position: p, exerciseId: exerciseId((p % 3) + 1), sectionId: sectionId(4), supersetGroup: p < 8 ? 1 : null }),
  ),
});

async function open(id: string) {
  const fake = createWorkoutFake({ catalog, routines: [pushSectioned, threeLoose, nine] });
  prepareApp({ auth, catalog, fake });
  const app = renderApp(`/app/workouts/routines/${id}/edit`);
  await screen.findByLabelText("Name");
  return app;
}
const editSection = (name: string) => screen.getByRole("button", { name: `Edit section ${name}` });

describe("10.7 AC9 — the routine section sheet in the editor", () => {
  it("saving Set Timer 5 × 500 shows the plan line under the name, above the note; the name still opens the sheet", async () => {
    const { user } = await open(routineId(3));
    await user.click(editSection("Main"));
    const dialog = await screen.findByRole("dialog", { name: "Edit section" });
    await user.selectOptions(within(dialog).getByLabelText("Timer"), "set_timer");
    await user.type(within(dialog).getByLabelText("Rounds"), "5");
    await user.type(within(dialog).getByLabelText("Round length"), "500");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    const region = screen.getByRole("region", { name: "Main" });
    const line = within(region).getByText("Set Timer 5 × 5:00");
    const note = within(region).getByText("Rx");
    expect(line.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editSection("Main").compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(editSection("Main"));
    expect(await screen.findByRole("dialog", { name: "Edit section" })).toBeInTheDocument();
  });

  it("an untimed header shows no plan line", async () => {
    await open(routineId(2));
    expect(screen.queryByText(/Set Timer|AMRAP|Time Cap|For Time/)).toBeNull();
  });
});

describe("10.7 AC13 — editor coupling (screen)", () => {
  it("making a 3-exercise section AMRAP groups all three; the link toggles still work", async () => {
    const { user } = await open(routineId(3));
    await user.click(editSection("Main"));
    const dialog = await screen.findByRole("dialog", { name: "Edit section" });
    await user.selectOptions(within(dialog).getByLabelText("Timer"), "amrap");
    await user.type(within(dialog).getByLabelText("Time limit"), "1200");
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    const first = screen.getByRole("button", { name: "Superset Bench Press with Barbell Row" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Superset Barbell Row with Overhead Press" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Superset Barbell Row with Overhead Press" }));
    expect(screen.getByRole("button", { name: "Superset Barbell Row with Overhead Press" })).toHaveAttribute("aria-pressed", "false");
  });

  it("a timed section of 8 grouped and a 9th loose shows the cap line under it", async () => {
    await open(routineId(4));
    expect(within(screen.getByRole("region", { name: "Main" })).getByText(GROUP_CAP_LINE)).toBeInTheDocument();
  });
});
