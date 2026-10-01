import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Exercise } from "@sin/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { getAccessTokenSilently: vi.fn(), logout: vi.fn() },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

const observability = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));

import { resetConfigCache } from "../../config";
import { memoryStorageAdapter, type StorageAdapter } from "../../storage/storage";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import {
  API_BASE_URL,
  CatalogTestProviders,
  seededStorage,
  stubWebEnv,
  USER_ID,
} from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { ExercisePicker } from "./ExercisePicker";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXERCISES_URL = `${API_BASE_URL}/v1/exercises`;
const MUSCLES_URL = `${API_BASE_URL}/v1/muscle-groups`;
const EQUIPMENT_URL = `${API_BASE_URL}/v1/equipment`;

const squat = makeExercise({
  id: exerciseId(1),
  name: "Back Squat",
  primaryMuscleId: "legs",
  equipmentId: "barbell",
});
const bench = makeExercise({
  id: exerciseId(2),
  name: "Bench Press",
  primaryMuscleId: "chest",
  equipmentId: "barbell",
});
const curl = makeExercise({
  id: exerciseId(3),
  name: "Dumbbell Curl",
  ownerUserId: USER_ID,
  primaryMuscleId: "arms",
  equipmentId: "dumbbell",
});
const created = makeExercise({
  id: exerciseId(9),
  name: "Zercher",
  ownerUserId: USER_ID,
  primaryMuscleId: null,
  equipmentId: null,
});

let syncCalls = 0;
let referenceCalls = 0;

beforeEach(() => {
  stubWebEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
  observability.track.mockReset();
  syncCalls = 0;
  referenceCalls = 0;
  server.use(
    http.get(EXERCISES_URL, () => {
      syncCalls += 1;
      return HttpResponse.json({ exercises: [], syncToken: "1.101" });
    }),
    http.get(MUSCLES_URL, () => {
      referenceCalls += 1;
      return HttpResponse.json({
        muscleGroups: [
          { id: "legs", name: "Legs", displayOrder: 2 },
          { id: "chest", name: "Chest", displayOrder: 1 },
          { id: "arms", name: "Arms", displayOrder: 3 },
        ],
      });
    }),
    http.get(EQUIPMENT_URL, () => {
      referenceCalls += 1;
      return HttpResponse.json({
        equipment: [
          { id: "dumbbell", name: "Dumbbell", displayOrder: 2 },
          { id: "barbell", name: "Barbell", displayOrder: 1 },
        ],
      });
    }),
  );
});

afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

function renderPicker(options: { storage?: StorageAdapter } = {}) {
  const onPick = vi.fn<(exercise: Exercise) => void>();
  const onClose = vi.fn();
  const storage = options.storage ?? seededStorage([squat, bench, curl], [bench.id]);
  render(
    <CatalogTestProviders storage={storage}>
      <ExercisePicker open onPick={onPick} onClose={onClose} />
    </CatalogTestProviders>,
  );
  return { onPick, onClose, user: userEvent.setup() };
}

const recentRegion = () => screen.queryByRole("region", { name: "Recent" });
const allRegion = () => screen.getByRole("region", { name: "All exercises" });
const search = () => screen.getByLabelText("Search exercises");

describe("AC25 — picker layout", () => {
  it("renders recents above the A–Z list", () => {
    renderPicker();

    const recent = recentRegion();
    expect(recent).not.toBeNull();
    expect(within(recent!).getByRole("button", { name: /Bench Press/ })).toBeInTheDocument();
    expect(
      recent!.compareDocumentPosition(allRegion()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(allRegion())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      expect.stringContaining("Back Squat"),
      expect.stringContaining("Bench Press"),
      expect.stringContaining("Dumbbell Curl"),
      "Create a custom exercise",
    ]);
  });

  it("hides recents entirely while a search is active", async () => {
    const { user } = renderPicker();

    await user.type(search(), "squat");

    expect(recentRegion()).toBeNull();
  });

  it("hides recents entirely while a filter is active", async () => {
    const { user } = renderPicker();

    await user.selectOptions(await screen.findByLabelText("Muscle"), "legs");

    expect(recentRegion()).toBeNull();
    expect(
      within(allRegion()).getByRole("button", { name: /Back Squat/ }),
    ).toBeInTheDocument();
    expect(
      within(allRegion()).queryByRole("button", { name: /Bench Press/ }),
    ).not.toBeInTheDocument();
  });

  it("does not focus the search input on open", () => {
    renderPicker();

    expect(search()).not.toHaveFocus();
  });

  it("shows the modality label, the equipment name, and a Custom tag only for owned rows", async () => {
    renderPicker();

    const squatRow = within(allRegion()).getByRole("button", { name: /Back Squat/ });
    await waitFor(() => expect(squatRow).toHaveTextContent("Weight × reps · Barbell"));
    expect(squatRow).not.toHaveTextContent("Custom");
    expect(within(allRegion()).getByRole("button", { name: /Dumbbell Curl/ })).toHaveTextContent(
      "Custom",
    );
  });

  it("sizes every row to var(--tap-target-min) and lets a long name wrap", () => {
    renderPicker();
    const css = readFileSync(join(HERE, "ExercisePicker.module.css"), "utf8");
    const block = (selector: string) =>
      css.match(new RegExp(`\\.${selector}\\s*\\{[^}]*\\}`))?.[0] ?? "";

    expect(block("row")).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    expect(block("createRow")).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    expect(block("rowName")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(block("rowMain")).toMatch(/min-width:\s*0/);
    expect(
      within(allRegion()).getByRole("button", { name: /Back Squat/ }).className,
    ).toMatch(/row/);
  });

  it("lists filter options in displayOrder behind an All option", async () => {
    renderPicker();

    const muscle = await screen.findByLabelText("Muscle");
    expect(within(muscle).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All muscles",
      "Chest",
      "Legs",
      "Arms",
    ]);
    expect(
      within(screen.getByLabelText("Equipment"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All equipment", "Barbell", "Dumbbell"]);
  });

  it("omits the filters, and still lists exercises, when reference data fails to load", async () => {
    server.use(
      http.get(MUSCLES_URL, () => {
        referenceCalls += 1;
        return new HttpResponse(null, { status: 500 });
      }),
      http.get(EQUIPMENT_URL, () => {
        referenceCalls += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    renderPicker();

    await waitFor(() => expect(referenceCalls).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByLabelText("Muscle")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Equipment")).not.toBeInTheDocument();
    expect(within(allRegion()).getByRole("button", { name: /Back Squat/ })).toHaveTextContent(
      "Weight × reps",
    );
  });

  it("keeps a create row last, worded from the search text", async () => {
    const { user } = renderPicker();
    expect(screen.getByRole("button", { name: "Create a custom exercise" })).toBeInTheDocument();

    await user.type(search(), "  curl ");

    const buttons = within(allRegion()).getAllByRole("button");
    expect(buttons.at(-1)).toHaveTextContent('Can\'t find it? Create "curl"');
  });
});

describe("AC26 — picker states", () => {
  it("no rows and a refresh in flight → spinner", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(EXERCISES_URL, async () => {
        await gate;
        return HttpResponse.json({ exercises: [squat], syncToken: "1.101" });
      }),
    );
    renderPicker({ storage: memoryStorageAdapter() });

    expect(await screen.findByRole("status")).toHaveTextContent("Loading exercises…");

    release();
    expect(await screen.findByRole("button", { name: /Back Squat/ })).toBeInTheDocument();
  });

  it("no rows and a failed refresh → error text and a Retry that requests again", async () => {
    let calls = 0;
    server.use(
      http.get(EXERCISES_URL, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ exercises: [squat], syncToken: "1.101" });
      }),
    );
    const { user } = renderPicker({ storage: memoryStorageAdapter() });

    expect(await screen.findByText("Couldn't load exercises")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("button", { name: /Back Squat/ })).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("cached rows and a failed background refresh → the list, with no error text", async () => {
    server.use(
      http.get(EXERCISES_URL, () => {
        syncCalls += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    renderPicker();

    await waitFor(() => expect(syncCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(within(allRegion()).getByRole("button", { name: /Back Squat/ })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load exercises")).not.toBeInTheDocument();
  });

  it("a search that matches nothing → \"No exercises match\" plus the create row", async () => {
    const { user } = renderPicker();

    await user.type(search(), "zzz");

    expect(screen.getByText("No exercises match")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: 'Can\'t find it? Create "zzz"' }),
    ).toBeInTheDocument();
  });
});

describe("AC27 — picking", () => {
  it("a recents row → onPick with the full exercise, source: recent", async () => {
    const { user, onPick } = renderPicker();

    await user.click(within(recentRegion()!).getByRole("button", { name: /Bench Press/ }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]?.[0]).toEqual(bench);
    expect(observability.track).toHaveBeenCalledWith("exercise_picked", {
      source: "recent",
      msSinceOpen: expect.any(Number),
    });
  });

  it("a list row → source: list, the pick moves to the front of recents, the sheet stays open", async () => {
    const { user, onPick, onClose } = renderPicker();

    await user.click(within(allRegion()).getByRole("button", { name: /Back Squat/ }));

    expect(onPick.mock.calls[0]?.[0]).toEqual(squat);
    expect(observability.track).toHaveBeenCalledWith("exercise_picked", {
      source: "list",
      msSinceOpen: expect.any(Number),
    });
    expect(
      within(recentRegion()!)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([expect.stringContaining("Back Squat"), expect.stringContaining("Bench Press")]);
    expect(screen.getByRole("dialog", { name: "Add exercise" })).toHaveAttribute("open");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a list row during a search → source: search", async () => {
    const { user } = renderPicker();
    await user.type(search(), "curl");

    await user.click(within(allRegion()).getByRole("button", { name: /Dumbbell Curl/ }));

    expect(observability.track).toHaveBeenCalledWith("exercise_picked", {
      source: "search",
      msSinceOpen: expect.any(Number),
    });
  });

  it("never puts an exercise name or id in an event", async () => {
    const { user } = renderPicker();

    await user.click(within(allRegion()).getByRole("button", { name: /Back Squat/ }));

    const payload = JSON.stringify(observability.track.mock.calls);
    expect(payload).not.toContain("Back Squat");
    expect(payload).not.toContain(squat.id);
  });
});

describe("AC28 — the create form opens from the create row", () => {
  it("swaps the sheet to the form with the search text as the name; Cancel restores the list and the search", async () => {
    const { user } = renderPicker();
    await user.type(search(), "Zercher");

    await user.click(screen.getByRole("button", { name: 'Can\'t find it? Create "Zercher"' }));

    expect(screen.getByRole("dialog", { name: "Create exercise" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Zercher");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Add exercise" })).toBeInTheDocument();
    expect(search()).toHaveValue("Zercher");
  });
});

describe("AC29 — a created exercise is picked", () => {
  it("201 → onPick with the new exercise, back to the list, and it is in recents", async () => {
    server.use(
      http.post(EXERCISES_URL, () => HttpResponse.json(created, { status: 201 })),
    );
    const { user, onPick } = renderPicker();
    await user.type(search(), "Zercher");
    await user.click(screen.getByRole("button", { name: 'Can\'t find it? Create "Zercher"' }));
    await user.click(screen.getByRole("radio", { name: "Weight × reps" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0]?.[0]).toEqual(created);
    expect(await screen.findByRole("dialog", { name: "Add exercise" })).toBeInTheDocument();

    await user.clear(search());
    expect(
      within(recentRegion()!)
        .getAllByRole("button")
        .map((b) => b.textContent)[0],
    ).toContain("Zercher");
  });
});

describe("closing resets the picker", () => {
  it("clears the search when the sheet is closed and reopened", async () => {
    const storage = seededStorage([squat, bench]);
    const user = userEvent.setup();
    const { rerender } = render(
      <CatalogTestProviders storage={storage}>
        <ExercisePicker open onPick={() => undefined} onClose={() => undefined} />
      </CatalogTestProviders>,
    );
    await user.type(search(), "squat");

    rerender(
      <CatalogTestProviders storage={storage}>
        <ExercisePicker open={false} onPick={() => undefined} onClose={() => undefined} />
      </CatalogTestProviders>,
    );
    rerender(
      <CatalogTestProviders storage={storage}>
        <ExercisePicker open onPick={() => undefined} onClose={() => undefined} />
      </CatalogTestProviders>,
    );

    expect(search()).toHaveValue("");
  });
});
