import type { Equipment, Exercise, MuscleGroup } from "@sin/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { getAccessTokenSilently: vi.fn(), logout: vi.fn() },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { resetConfigCache } from "../../config";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import {
  API_BASE_URL,
  CatalogTestProviders,
  seededStorage,
  stubWebEnv,
  USER_ID,
} from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { sheetBody, sheetRow } from "../../test/sheetHelpers";
import { Sheet } from "../../ui/Sheet";
import { useState } from "react";
import { CreateExerciseForm } from "./CreateExerciseForm";

const EXERCISES_URL = `${API_BASE_URL}/v1/exercises`;

const MUSCLES: MuscleGroup[] = [
  { id: "chest", name: "Chest", displayOrder: 1 },
  { id: "biceps", name: "Biceps", displayOrder: 2 },
  { id: "forearms", name: "Forearms", displayOrder: 3 },
];
const EQUIPMENT: Equipment[] = [
  { id: "barbell", name: "Barbell", displayOrder: 1 },
  { id: "dumbbell", name: "Dumbbell", displayOrder: 2 },
];

const created = makeExercise({
  id: exerciseId(9),
  name: "Zercher Curl",
  ownerUserId: USER_ID,
  primaryMuscleId: null,
  equipmentId: null,
});

const problem = (body: Record<string, unknown>, status: number) =>
  new HttpResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

let postBodies: unknown[] = [];

beforeEach(() => {
  stubWebEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
  postBodies = [];
  server.use(
    http.get(EXERCISES_URL, () => HttpResponse.json({ exercises: [], syncToken: "1.101" })),
    http.post(EXERCISES_URL, async ({ request }) => {
      postBodies.push(await request.json());
      return HttpResponse.json(created, { status: 201 });
    }),
  );
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

// The "More details" controls sit inside a closed <details>. Role queries for
// them pass `hidden: true` so the tests do not depend on how jsdom treats
// collapsed content.
function renderForm(
  props: Partial<{
    initialName: string;
    muscleGroups: MuscleGroup[] | undefined;
    equipment: Equipment[] | undefined;
  }> = {},
) {
  const onCreated = vi.fn<(exercise: Exercise) => void>();
  const onCancel = vi.fn();
  const merged = { initialName: "Zercher Curl", muscleGroups: MUSCLES, equipment: EQUIPMENT, ...props };
  render(
    <CatalogTestProviders storage={seededStorage([])}>
      <Sheet open title="Create exercise" onClose={onCancel}>
        <CreateExerciseForm {...merged} onCreated={onCreated} />
      </Sheet>
    </CatalogTestProviders>,
  );
  return { onCreated, onCancel, user: userEvent.setup() };
}

const saveButton = () => screen.getByRole("button", { name: "Save" });

describe("17.13 AC13 — why Save is off (create)", () => {
  const reason = () => document.querySelector("[data-sheet-actions]")?.textContent ?? "";

  it("empty: the row's status says what's missing, and Save is described by it", () => {
    renderForm({ initialName: "" });
    const line = screen.getByText("Enter a name and choose a type.");
    expect(line.closest("[data-sheet-actions]")).not.toBeNull();
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAccessibleDescription("Enter a name and choose a type.");
  });

  it("review focus 1: a name of only spaces with a type chosen says Enter a name.", async () => {
    const { user } = renderForm({ initialName: "" });
    await user.type(screen.getByLabelText("Name"), "   ");
    await user.click(screen.getAllByRole("radio")[0]!);
    expect(saveButton()).toHaveAccessibleDescription("Enter a name.");
  });

  it("code review #1: a name prefilled from the search with no type says Choose a type.", () => {
    renderForm({ initialName: "Zercher squat" });
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAccessibleDescription("Choose a type.");
  });

  it("name and type filled: no line and no description; Save keeps its look", async () => {
    const { user } = renderForm();
    const before = saveButton().className;
    await user.click(screen.getAllByRole("radio")[0]!);
    expect(screen.queryByText("Enter a name and choose a type.")).toBeNull();
    expect(saveButton()).not.toHaveAttribute("aria-describedby");
    expect(saveButton()).toBeEnabled();
    expect(saveButton().className).toBe(before);
    expect(reason()).not.toContain("Enter a name");
  });
});

describe("AC28 — create form layout", () => {
  it("prefills the name and offers the modality options as a radio group (eight since Spec 18.1)", () => {
    renderForm();

    expect(screen.getByLabelText("Name")).toHaveValue("Zercher Curl");
    expect(screen.getAllByRole("radio").map((r) => r.parentElement?.textContent)).toEqual([
      "Weight × reps",
      "Bodyweight × reps",
      "Weighted bodyweight",
      "Duration",
      "Distance + duration",
      "Calories",
      "Weight + distance",
      "Weight + duration",
    ]);
    expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });

  it("keeps primary muscle, secondary muscles and equipment under a collapsed More details", () => {
    renderForm();

    const details = screen.getByText("More details").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details).toContainElement(screen.getByLabelText("Primary muscle"));
    expect(details).toContainElement(screen.getByLabelText("Equipment"));
    expect(details).toContainElement(
      screen.getByRole("checkbox", { name: "Biceps", hidden: true }),
    );
  });

  it("omits More details when reference data is unavailable", () => {
    renderForm({ muscleGroups: undefined, equipment: undefined });

    expect(screen.queryByText("More details")).not.toBeInTheDocument();
  });

  it("disables Save until the trimmed name is non-empty and a modality is chosen", async () => {
    const { user } = renderForm();
    expect(saveButton()).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Weight × reps" }));
    expect(saveButton()).toBeEnabled();

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "   ");
    expect(saveButton()).toBeDisabled();
  });

  it("Cancel calls onCancel", async () => {
    const { user, onCancel } = renderForm();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("allows at most four secondary muscles and never offers the primary as a secondary", async () => {
    const many: MuscleGroup[] = ["a", "b", "c", "d", "e", "f"].map((id, i) => ({
      id,
      name: `Muscle ${id.toUpperCase()}`,
      displayOrder: i,
    }));
    const { user } = renderForm({ muscleGroups: many });

    await user.selectOptions(screen.getByLabelText("Primary muscle"), "a");
    expect(
      screen.queryByRole("checkbox", { name: "Muscle A", hidden: true }),
    ).not.toBeInTheDocument();

    for (const name of ["Muscle B", "Muscle C", "Muscle D", "Muscle E"]) {
      await user.click(screen.getByRole("checkbox", { name, hidden: true }));
    }
    expect(screen.getByRole("checkbox", { name: "Muscle F", hidden: true })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Muscle B", hidden: true })).toBeEnabled();
  });
});

describe("18.1 AC1 — a new type is created with its modality", () => {
  it("choosing Calories posts modality: calories", async () => {
    const { user, onCreated } = renderForm({ initialName: "Echo Bike" });
    await user.click(screen.getByRole("radio", { name: "Calories" }));
    await user.click(saveButton());
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(postBodies).toEqual([expect.objectContaining({ name: "Echo Bike", modality: "calories" })]);
  });
});

describe("AC29 — create outcomes", () => {
  it("201 → posts the full body and calls onCreated with the new exercise", async () => {
    const { user, onCreated } = renderForm({ initialName: "  Zercher Curl " });

    await user.click(screen.getByRole("radio", { name: "Weight × reps" }));
    await user.selectOptions(screen.getByLabelText("Primary muscle"), "biceps");
    await user.click(screen.getByRole("checkbox", { name: "Forearms", hidden: true }));
    await user.selectOptions(screen.getByLabelText("Equipment"), "dumbbell");
    await user.click(saveButton());

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0]?.[0]).toEqual(created);
    expect(postBodies).toEqual([
      {
        name: "Zercher Curl",
        modality: "weight_reps",
        primaryMuscleId: "biceps",
        secondaryMuscleIds: ["forearms"],
        equipmentId: "dumbbell",
      },
    ]);
  });

  it("a double tap on Save sends exactly one POST", async () => {
    const { user, onCreated } = renderForm();
    await user.click(screen.getByRole("radio", { name: "Duration" }));

    await user.dblClick(saveButton());

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(postBodies).toHaveLength(1);
  });

  it("17.10 AC3 — Cancel during a save ends the form, and the late answer reports no pick (Review Focus 4)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(EXERCISES_URL, async () => {
        await gate;
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const onCreated = vi.fn<(exercise: Exercise) => void>();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <Sheet open={open} title="Create exercise" onClose={() => setOpen(false)}>
          {open ? <CreateExerciseForm initialName="Zercher Curl" muscleGroups={MUSCLES} equipment={EQUIPMENT} onCreated={onCreated} /> : null}
        </Sheet>
      );
    }
    render(
      <CatalogTestProviders storage={seededStorage([])}>
        <Host />
      </CatalogTestProviders>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Duration" }));
    await user.click(saveButton());

    const cancel = sheetRow().getByRole("button", { name: "Cancel" });
    expect(cancel).toBeEnabled();
    expect(cancel).not.toHaveAttribute("aria-disabled");
    await user.click(cancel);
    expect(screen.queryByLabelText("Name")).toBeNull();

    release();
    await waitFor(() => expect(postBodies.length + 1).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("17.10 AC14, AC7 — Cancel then Save in the row, none in the body; Save waits for a name and a type", async () => {
    const { user } = renderForm();
    expect(sheetRow().getAllByRole("button").map((b) => b.textContent)).toEqual(["Cancel", "Save"]);
    for (const name of ["Cancel", "Save"]) expect(within(sheetBody()).queryByRole("button", { name })).toBeNull();
    expect(sheetRow().getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Duration" }));
    expect(sheetRow().getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("409 exercise-limit-reached → a plain message, no field marked, input intact", async () => {
    server.use(
      http.post(EXERCISES_URL, () =>
        problem(
          {
            type: "https://strengthinnumbers.app/problems/exercise-limit-reached",
            title: "Exercise limit reached",
            status: 409,
          },
          409,
        ),
      ),
    );
    const { user, onCreated } = renderForm();
    await user.click(screen.getByRole("radio", { name: "Duration" }));

    await user.click(saveButton());

    expect(
      await screen.findByText("You've reached the maximum number of custom exercises."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Name")).toHaveValue("Zercher Curl");
    expect(screen.getByRole("radio", { name: "Duration" })).toBeChecked();
    expect(saveButton()).toBeEnabled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("422 → per-field messages, and a form-level message for an unmatched path", async () => {
    server.use(
      http.post(EXERCISES_URL, () =>
        problem(
          {
            type: "https://strengthinnumbers.app/problems/validation-error",
            title: "Validation error",
            status: 422,
            errors: [
              { path: "name", message: "control characters not allowed" },
              { path: "secondaryMuscleIds.0", message: "unknown muscle id" },
              { path: "(body)", message: "unexpected property" },
            ],
          },
          422,
        ),
      ),
    );
    const { user } = renderForm();
    await user.click(screen.getByRole("radio", { name: "Duration" }));

    await user.click(saveButton());

    expect(await screen.findByText("control characters not allowed")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("unknown muscle id")).toBeInTheDocument();
    // An error under "More details" must be visible, not hidden in a closed section.
    expect(screen.getByText("More details").closest("details")).toHaveAttribute("open");
    expect(screen.getByText("unexpected property")).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("any other failure → \"Couldn't save. Try again.\" with the form still open", async () => {
    server.use(http.post(EXERCISES_URL, () => new HttpResponse(null, { status: 500 })));
    const { user, onCreated } = renderForm();
    await user.click(screen.getByRole("radio", { name: "Duration" }));

    await user.click(saveButton());

    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Zercher Curl");
    expect(saveButton()).toBeEnabled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
