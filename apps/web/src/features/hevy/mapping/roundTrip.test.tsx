import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false, isAuthenticated: true, error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(), logout: vi.fn(), getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

const saved = vi.hoisted(() => ({ blobs: [] as { blob: Blob; filename: string }[] }));
vi.mock("../../account/saveBlob", () => ({ saveBlob: (blob: Blob, filename: string) => void saved.blobs.push({ blob, filename }) }));

import { API_BASE_URL, stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { USER_ID, VALID_KEY, clearHevyKey, renderHevyScreen, templatesHandler, setInstantPacing, userInfoOk } from "../../../test/hevyHarness";
import { server } from "../../../test/msw/server";
import { hevyKeyStore } from "../keyStore";
import { leftOutHeading, loadButton, willBeRemovedLine } from "../messages";
import { MAPPING_FILENAME } from "./downloadMapping";

const MAPPING_URL = `${API_BASE_URL}/v1/hevy/mapping`;
const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });
const ROW = makeExercise({ id: exerciseId(2), name: "Row Erg", modality: "calories" });
const tpl = (id: string, title: string, type: string) => ({ id, title, type, is_custom: true, primary_muscle_group: "chest", secondary_muscle_groups: [], equipment: "none" });
/** The fake API's stored mapping, typed loosely: it holds whatever the client sent. */
type FakePair = { hevyTemplateId: string; hevyTitle: string; hevyType: string; exerciseId: string | null; exerciseActive: boolean | null } & Record<string, unknown>;
type FakeMapping = { pairs: FakePair[]; sectionRules: { name: string; treatment: string }[] };
/** Review Focus 1: a title with a comma, a quote and an é; a skip; both placeholders; a calories pairing; no stored rules. */
const ORIGINAL: FakeMapping = {
  pairs: [
    { hevyTemplateId: "T-B", hevyTitle: 'Développé, "couché"', hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: true },
    { hevyTemplateId: "T-R", hevyTitle: "Echo Bike (calories)", hevyType: "reps_only", role: "exercise", exerciseId: ROW.id, exerciseActive: true, measureRule: "calories_as_reps", exportAs: true },
    { hevyTemplateId: "T-S", hevyTitle: "Stretching", hevyType: "duration", role: "skip", exerciseId: null, exerciseActive: null, measureRule: null, exportAs: false },
    // Minor 189: a title a spreadsheet would run as a formula still round-trips.
    { hevyTemplateId: "T-F", hevyTitle: '=HYPERLINK("x")', hevyType: "duration", role: "skip", exerciseId: null, exerciseActive: null, measureRule: null, exportAs: false },
    { hevyTemplateId: "T-W", hevyTitle: "Warmup", hevyType: "reps_only", role: "warmup_placeholder", exerciseId: null, exerciseActive: null, measureRule: null, exportAs: false },
    { hevyTemplateId: "T-X", hevyTitle: "Section", hevyType: "reps_only", role: "workout_placeholder", exerciseId: null, exerciseActive: null, measureRule: null, exportAs: false },
  ],
  sectionRules: [],
};
const TEMPLATES = ORIGINAL.pairs.map((p) => tpl(p.hevyTemplateId, p.hevyTitle, p.hevyType));
const DEFAULTS = [
  { name: "Accessory", treatment: "notes_on_first" },
  { name: "Warm-up", treatment: "warmup_placeholder" },
];

/** The fake API holds one mapping and answers reads and the replace from it. */
let stored: FakeMapping;
let reads = 0;
beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  clearHevyKey();
  hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
  saved.blobs = [];
  stored = structuredClone(ORIGINAL);
  reads = 0;
  server.use(
    userInfoOk(),
    templatesHandler(TEMPLATES),
    http.get(MAPPING_URL, () => {
      reads += 1;
      return HttpResponse.json(stored);
    }),
    http.put(MAPPING_URL, async ({ request }) => {
      const body = (await request.json()) as FakeMapping;
      stored = { pairs: body.pairs.map((p) => ({ ...p, exerciseActive: p.exerciseId === null ? null : true })), sectionRules: body.sectionRules };
      return HttpResponse.json(stored);
    }),
  );
});
afterEach(() => {
  clearHevyKey();
  unstubAccountEnv();
});

describe("20.0 AC23 — download", () => {
  it("re-reads the mapping, then saves hevy-mapping.csv", async () => {
    renderHevyScreen(undefined, { catalog: [BENCH, ROW] });
    const download = await screen.findByRole("button", { name: "Download file" });
    await waitFor(() => expect(download).toBeEnabled());
    const before = reads;
    await userEvent.click(download);
    await waitFor(() => expect(saved.blobs).toHaveLength(1));
    expect(reads).toBe(before + 1);
    expect(saved.blobs[0]!.filename).toBe(MAPPING_FILENAME);
    expect(saved.blobs[0]!.blob.type).toBe("text/csv;charset=utf-8");
  });
});

describe("20.0 AC23 — round trip", () => {
  it("download, then load the same file: nothing left out or removed, and the mapping is unchanged (Review Focus 1)", async () => {
    renderHevyScreen(undefined, { catalog: [BENCH, ROW] });
    const download = await screen.findByRole("button", { name: "Download file" });
    await waitFor(() => expect(download).toBeEnabled());
    await userEvent.click(download);
    await waitFor(() => expect(saved.blobs).toHaveLength(1));
    const text = await saved.blobs[0]!.blob.text();

    await userEvent.click(screen.getByRole("button", { name: "Load a file" }));
    const dialog = await screen.findByRole("dialog", { name: "Load a mapping file" });
    await userEvent.upload(within(dialog).getByLabelText("Choose a file"), new File([text], "hevy-mapping.csv", { type: "text/csv" }));
    const confirm = await within(dialog).findByRole("button", { name: loadButton(6) });
    expect(within(dialog).queryByText(leftOutHeading(1), { exact: false })).toBeNull();
    expect(within(dialog).queryByText(/Left out/)).toBeNull();
    expect(within(dialog).queryByText(willBeRemovedLine(1), { exact: false })).toBeNull();
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const byId = (m: FakeMapping) => [...m.pairs].sort((a, b) => a.hevyTemplateId.localeCompare(b.hevyTemplateId));
    expect(byId(stored)).toEqual(byId(ORIGINAL));
    expect([...stored.sectionRules].sort((a, b) => a.name.localeCompare(b.name))).toEqual(DEFAULTS);
  });
});
