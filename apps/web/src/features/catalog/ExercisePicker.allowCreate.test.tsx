import type { Exercise } from "@sin/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { getAccessTokenSilently: vi.fn(), logout: vi.fn() },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { resetConfigCache } from "../../config";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { API_BASE_URL, CatalogTestProviders, seededStorage, stubWebEnv } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { ExercisePicker } from "./ExercisePicker";

const squat = makeExercise({ id: exerciseId(1), name: "Back Squat", primaryMuscleId: "legs", equipmentId: "barbell" });

beforeEach(() => {
  stubWebEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  server.use(
    http.get(`${API_BASE_URL}/v1/exercises`, () => HttpResponse.json({ exercises: [], syncToken: "1.101" })),
    http.get(`${API_BASE_URL}/v1/muscle-groups`, () => HttpResponse.json({ muscleGroups: [] })),
    http.get(`${API_BASE_URL}/v1/equipment`, () => HttpResponse.json({ equipment: [] })),
  );
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

function renderPicker(props: { allowCreate?: boolean }) {
  const onPick = vi.fn<(exercise: Exercise) => void>();
  const onClose = vi.fn();
  render(
    <CatalogTestProviders storage={seededStorage([squat], [])}>
      <ExercisePicker open onPick={onPick} onClose={onClose} {...props} />
    </CatalogTestProviders>,
  );
  return { onPick, onClose, user: userEvent.setup() };
}

describe("10.4 AC25 — allowCreate={false} offers no way to create", () => {
  it("no create row, empty or searching; picking still works and does not close", async () => {
    const { onPick, onClose, user } = renderPicker({ allowCreate: false });
    expect(await screen.findByRole("region", { name: "All exercises" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create a custom exercise/ })).toBeNull();
    await user.type(screen.getByLabelText("Search exercises"), "zzz");
    expect(screen.queryByRole("button", { name: /Can't find it\?/ })).toBeNull();
    await user.clear(screen.getByLabelText("Search exercises"));
    await user.click(within(screen.getByRole("region", { name: "All exercises" })).getByRole("button", { name: /Back Squat/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0]).toMatchObject({ id: squat.id });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("default still offers the create row", async () => {
    renderPicker({});
    expect(await screen.findByRole("button", { name: "Create a custom exercise" })).toBeInTheDocument();
  });
});
