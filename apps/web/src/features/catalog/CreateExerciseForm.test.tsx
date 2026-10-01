import type { Equipment, Exercise, MuscleGroup } from "@sin/core";
import { render, screen, waitFor } from "@testing-library/react";
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
      <CreateExerciseForm {...merged} onCreated={onCreated} onCancel={onCancel} />
    </CatalogTestProviders>,
  );
  return { onCreated, onCancel, user: userEvent.setup() };
}

const saveButton = () => screen.getByRole("button", { name: "Save" });

describe("AC28 — create form layout", () => {
  it("prefills the name and offers the five modality options as a radio group", () => {
    renderForm();

    expect(screen.getByLabelText("Name")).toHaveValue("Zercher Curl");
    expect(screen.getAllByRole("radio").map((r) => r.parentElement?.textContent)).toEqual([
      "Weight × reps",
      "Bodyweight × reps",
      "Weighted bodyweight",
      "Duration",
      "Distance + duration",
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
