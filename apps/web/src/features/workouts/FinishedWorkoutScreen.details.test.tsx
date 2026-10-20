import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

function open(section: "workouts" | "history", details: { title?: string | null; notes?: string | null }) {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    routineName: "Push Day",
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1 })] }],
    ...details,
  });
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake });
  renderApp(`/app/${section}/${workout.id}`);
  return screen.findByRole("heading", { name: "Workout summary" });
}
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("18.0 AC50 — the summary shows the title and notes", () => {
  it.each(["workouts", "history"] as const)("on /app/%s/:id: the title before the date (not a heading); the notes section after From routine, before the stats", async (section) => {
    await open(section, { title: "Heavy bench day", notes: "Shoulder felt tight on set 3." });
    const title = screen.getByText("Heavy bench day");
    expect(title.tagName).toBe("P");
    expect(follows(title, screen.getByText("Fri 2 Oct"))).toBe(true);
    const notes = screen.getByRole("region", { name: "Workout notes" });
    expect(notes).toHaveTextContent("Notes");
    expect(notes).toHaveTextContent("Shoulder felt tight on set 3.");
    expect(follows(screen.getByText("From routine: Push Day"), notes)).toBe(true);
    expect(follows(notes, screen.getByText("duration"))).toBe(true);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Workout summary"]);
  });

  it("with no title and no notes: no title element, no Workout notes section, no Notes label", async () => {
    await open("history", { title: null, notes: null });
    expect(screen.queryByRole("region", { name: "Workout notes" })).toBeNull();
    expect(screen.queryByText("Notes")).toBeNull();
    expect(screen.queryByText("No title")).toBeNull();
  });
});

describe("18.0 AC51 — plain text", () => {
  it("markup in the notes renders as literal text with its line breaks; no element is created", async () => {
    const notes = "<img src=x onerror=alert(1)>\n<script>x</script>\n**bold**";
    await open("history", { title: "<b>T</b>", notes });
    const section = screen.getByRole("region", { name: "Workout notes" });
    expect(section.querySelector("img, script, strong, b")).toBeNull();
    expect(screen.getByText("<b>T</b>")).toBeInTheDocument();
    const text = [...section.querySelectorAll("p")].find((p) => p.textContent?.includes("onerror"))!;
    expect(text.textContent).toBe(notes);
  });
});
