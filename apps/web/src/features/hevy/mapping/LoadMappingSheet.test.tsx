import { MAPPING_CSV_HEADER } from "@sin/core";
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

import { API_BASE_URL, stubAccountEnv, unstubAccountEnv } from "../../../test/accountHarness";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { USER_ID, VALID_KEY, clearHevyKey, renderHevyScreen, templatesHandler, setInstantPacing, userInfoOk } from "../../../test/hevyHarness";
import { server } from "../../../test/msw/server";
import { TREATMENT_LABELS } from "../labels";
import { hevyClientFor } from "../sharedClient";
import { hevyTemplatesQuery } from "./useHevyTemplates";
import { hevyKeyStore } from "../keyStore";
import {
  COUNT_CALORIES,
  CATALOG_NOT_READY,
  FILE_READ_FAILED,
  sectionRulesRemovedLine,
  CSV_ERROR_COPY,
  FILE_TOO_BIG,
  LEFT_OUT_COPY,
  MAPPING_OFFLINE,
  mappingRateLimited,
  MAPPING_REJECTED,
  exportAsTwiceNotice,
  idTitleNotice,
  leaveOutNote,
  needsRuleLine,
  loadButton,
  loaded,
  pairedCount,
  readingTemplates,
  willBeRemovedLine,
  willChangeLine,
} from "../messages";

const MAPPING_URL = `${API_BASE_URL}/v1/hevy/mapping`;
const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });
const ROW = makeExercise({ id: exerciseId(2), name: "Row Erg", modality: "calories" });
const CATALOG = [BENCH, ROW];
const tpl = (id: string, title: string, type = "weight_reps") => ({ id, title, type, is_custom: false, primary_muscle_group: "chest", secondary_muscle_groups: [], equipment: "barbell" });
const TEMPLATES = [tpl("T-BENCH", "Bench Press (Barbell)"), tpl("T-ROW", "Echo Bike (calories)", "reps_only"), tpl("T-SQUAT", "Squat")];

const csv = (...rows: string[]) => [MAPPING_CSV_HEADER, ...rows].join("\r\n");
const GOOD = csv(`exercise,T-BENCH,,${BENCH.id},,,yes`, "skip,T-SQUAT,,,,,", `exercise,,Nope,,Nothing,,`);

let puts: unknown[] = [];
let hevyCalls = 0;
beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  setInstantPacing();
  clearHevyKey();
  hevyKeyStore.set(USER_ID, VALID_KEY, { remember: false });
  puts = [];
  hevyCalls = 0;
  server.events.on("request:start", async ({ request }) => {
    if (new URL(request.url).pathname === "/v1/exercise_templates") hevyCalls += 1;
    if (request.method === "PUT") puts.push(await request.clone().json());
  });
  server.use(templatesHandler(TEMPLATES), userInfoOk());
});
afterEach(() => {
  server.events.removeAllListeners();
  clearHevyKey();
  unstubAccountEnv();
});

async function openSheet() {
  renderHevyScreen(undefined, { catalog: CATALOG });
  await userEvent.click(await screen.findByRole("button", { name: "Load a file" }));
  return screen.findByRole("dialog", { name: "Load a mapping file" });
}
async function choose(dialog: HTMLElement, text: string, name = "m.csv") {
  await userEvent.upload(within(dialog).getByLabelText("Choose a file"), new File([text], name, { type: "text/csv" }));
}

describe("20.0 AC18 — choosing a file", () => {
  it("the file input takes CSV and is reachable by Tab", async () => {
    const dialog = await openSheet();
    const input = within(dialog).getByLabelText("Choose a file");
    expect(input).toHaveAttribute("accept", ".csv,text/csv");
    expect(input).not.toHaveAttribute("tabindex", "-1");
  });

  it("a file over 1 MiB, or over 5,000 lines, is too big, before parsing and before any Hevy request (Review Focus 5)", async () => {
    let dialog = await openSheet();
    await choose(dialog, "x".repeat(1_048_577));
    expect(await within(dialog).findByText(FILE_TOO_BIG)).toBeInTheDocument();
    dialog = screen.getByRole("dialog");
    await choose(dialog, csv(...Array.from({ length: 5_000 }, (_, i) => `skip,S${i},Stretch,,,,`)));
    expect(await within(dialog).findByText(FILE_TOO_BIG)).toBeInTheDocument();
    expect(hevyCalls).toBe(0);
  });

  it("a bad header names line 1 and offers no confirm", async () => {
    const dialog = await openSheet();
    await choose(dialog, "a,b,c\r\n1,2,3");
    expect(await within(dialog).findByText(`Line 1: ${CSV_ERROR_COPY.bad_header}`)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^Load \d+ pairings$/ })).toBeNull();
  });
});

describe("20.0 AC19 — reading Hevy", () => {
  it("shows page progress, and Cancel goes back to Choose with nothing written", async () => {
    const many = Array.from({ length: 250 }, (_, i) => tpl(`T${i}`, `Ex ${i}`));
    server.use(templatesHandler(many, { hold: 3 }));
    const dialog = await openSheet();
    await choose(dialog, GOOD);
    expect(await within(dialog).findByText(readingTemplates(2, 3))).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await within(dialog).findByLabelText("Choose a file")).toBeInTheDocument();
    expect(puts).toEqual([]);
  });
});

describe("20.0 AC21 — the preview", () => {
  it("shows paired, left out (line, both names, reason), sections, and what will be removed (Review Focus 4)", async () => {
    server.use(
      http.get(MAPPING_URL, () =>
        HttpResponse.json({
          pairs: [{ hevyTemplateId: "T-OLD", hevyTitle: "Made on Pairings", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: false }],
          sectionRules: [],
        }),
      ),
    );
    const dialog = await openSheet();
    await choose(dialog, GOOD);
    const preview = await within(dialog).findByRole("region", { name: "Preview" });
    expect(within(preview).getByText("Will be paired: 2")).toBeInTheDocument();
    const leftOut = within(preview).getByRole("list", { name: "Left out" });
    expect(within(leftOut).getByText(/Line 4/)).toHaveTextContent(`Line 4 · Nope · Nothing · ${LEFT_OUT_COPY.hevy_not_found}`);
    expect(within(preview).getByText(willBeRemovedLine(1))).toBeInTheDocument();
    expect(within(preview).getByText("Made on Pairings")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(puts).toEqual([]);
  });
});

describe("20.0 AC22 — confirm", () => {
  it("a calories line needs its rule accepted before Load is enabled; then one PUT, a status line and the card count", async () => {
    const dialog = await openSheet();
    await choose(dialog, csv(`exercise,T-BENCH,,${BENCH.id},,,`, `exercise,T-ROW,,${ROW.id},,,`, `exercise,,Nope,,Nothing,,`));
    const confirm = await within(dialog).findByRole("button", { name: loadButton(1) });
    expect(confirm).toBeDisabled();
    // The fake stores what it was sent and answers it back with `exerciseActive` filled in.
    server.use(
      http.put(MAPPING_URL, async ({ request }) => {
        const body = (await request.json()) as { pairs: object[]; sectionRules: object[] };
        return HttpResponse.json({ pairs: body.pairs.map((p) => ({ ...p, exerciseActive: true })), sectionRules: body.sectionRules });
      }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: COUNT_CALORIES }));
    const ready = within(dialog).getByRole("button", { name: loadButton(2) });
    expect(ready).toBeEnabled();
    expect(ready).toHaveAccessibleDescription(leaveOutNote(1));
    await userEvent.click(ready);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      pairs: [
        { hevyTemplateId: "T-BENCH", hevyTitle: "Bench Press (Barbell)", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, measureRule: null, exportAs: true },
        { hevyTemplateId: "T-ROW", hevyTitle: "Echo Bike (calories)", hevyType: "reps_only", role: "exercise", exerciseId: ROW.id, measureRule: "calories_as_reps", exportAs: true },
      ],
      sectionRules: [],
    });
    const status = await screen.findByText(loaded(2));
    await waitFor(() => expect(status).toHaveFocus());
    expect(screen.getByText(pairedCount(2))).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["a 422", () => HttpResponse.json({ type: "x/validation", title: "t", status: 422, detail: "d", instance: "i", errors: [{ path: "pairs.0.hevyTitle", message: "m" }] }, { status: 422, headers: { "content-type": "application/problem+json" } }), `${MAPPING_REJECTED} (pairs.0.hevyTitle)`],
    ["offline", () => HttpResponse.error(), MAPPING_OFFLINE],
    ["a 429", () => HttpResponse.json({ type: "x/rate-limited", title: "t", status: 429, detail: "d", instance: "i" }, { status: 429, headers: { "content-type": "application/problem+json" } }), mappingRateLimited(null)],
  ])("%s keeps the preview open with its sentence", async (_label, reply, sentence) => {
    server.use(http.put(MAPPING_URL, reply));
    const dialog = await openSheet();
    await choose(dialog, GOOD);
    await userEvent.click(await within(dialog).findByRole("button", { name: loadButton(2) }));
    expect(await within(dialog).findByText(sentence)).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "Preview" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Bench Press (Barbell)", { exact: false })).not.toBeNull();
  });
});

describe("20.0 AC19, AC21, AC22 — final review fixes", () => {
  it("the rule sentence names the SIN exercise, not the line", async () => {
    const dialog = await openSheet();
    await choose(dialog, csv(`exercise,T-ROW,,${ROW.id},,,`));
    expect(await within(dialog).findByText(needsRuleLine("Echo Bike (calories)", "Row Erg"))).toBeInTheDocument();
  });

  it("lists the id/title and export_as notices with their lines", async () => {
    const dialog = await openSheet();
    await choose(dialog, csv(`exercise,T-BENCH,Wrong Title,${BENCH.id},,,yes`, `exercise,T-SQUAT,,${BENCH.id},,,yes`));
    const notices = await within(dialog).findByRole("list", { name: "Notices" });
    expect(within(notices).getByText(idTitleNotice(2))).toBeInTheDocument();
    expect(within(notices).getByText(exportAsTwiceNotice(3))).toBeInTheDocument();
  });

  it("names a pairing the file changes (Sent as moved since the download), never silently", async () => {
    server.use(
      http.get(MAPPING_URL, () =>
        HttpResponse.json({
          pairs: [
            { hevyTemplateId: "T-BENCH", hevyTitle: "Bench Press (Barbell)", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: false },
            { hevyTemplateId: "T-SQUAT", hevyTitle: "Squat", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: true },
          ],
          sectionRules: [],
        }),
      ),
    );
    const dialog = await openSheet();
    await choose(dialog, csv(`exercise,T-BENCH,,${BENCH.id},,,yes`, `exercise,T-SQUAT,,${BENCH.id},,,no`));
    const preview = await within(dialog).findByRole("region", { name: "Preview" });
    expect(within(preview).getByText(willChangeLine(2))).toBeInTheDocument();
    const changed = within(preview).getByRole("list", { name: "Will change" });
    expect(within(changed).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Bench Press (Barbell)", "Squat"]);
  });
});

describe("20.0 AC19 — never resolved against an exercise list that has not synced (code review)", () => {
  it("a file picked before the first catalog sync is refused, so a replace can't wipe the pairings", async () => {
    renderHevyScreen(undefined, { unsyncedCatalog: true });
    await userEvent.click(await screen.findByRole("button", { name: "Load a file" }));
    const dialog = await screen.findByRole("dialog", { name: "Load a mapping file" });
    await choose(dialog, GOOD);
    expect(await within(dialog).findByText(CATALOG_NOT_READY)).toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "Preview" })).toBeNull();
    expect(puts).toEqual([]);
  });
});

const HEVY_TEMPLATES = "https://api.hevyapp.com/v1/exercise_templates";

describe("Minor 184 — leaving mid-read stops the Hevy reads", () => {
  it("unmounting after page 1 sends no request for page 3", async () => {
    const many = Array.from({ length: 250 }, (_, i) => tpl(`T${i}`, `Ex ${i}`));
    const asked: number[] = [];
    let release!: () => void;
    const page2 = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(HEVY_TEMPLATES, async ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page"));
        asked.push(page);
        if (page === 2) await page2;
        return HttpResponse.json({ page, page_count: 3, exercise_templates: many.slice((page - 1) * 100, page * 100) });
      }),
    );
    const { unmount } = renderHevyScreen(undefined, { catalog: CATALOG });
    await userEvent.click(await screen.findByRole("button", { name: "Load a file" }));
    const dialog = await screen.findByRole("dialog", { name: "Load a mapping file" });
    await choose(dialog, GOOD);
    await waitFor(() => expect(asked).toContain(2));
    unmount();
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).not.toContain(3);
  });

  it("a file the browser can't read says so", async () => {
    const dialog = await openSheet();
    const unreadable = new File(["x"], "m.csv", { type: "text/csv" });
    Object.defineProperty(unreadable, "text", { value: () => Promise.reject(new Error("NotReadableError")) });
    await userEvent.upload(within(dialog).getByLabelText("Choose a file"), unreadable);
    expect(await within(dialog).findByText(FILE_READ_FAILED)).toBeInTheDocument();
  });
});

describe("Minor 185 — the sheet's live regions are mounted empty", () => {
  it("the progress and error regions are there, empty, when the sheet opens", async () => {
    const dialog = await openSheet();
    expect(within(dialog).getByTestId("hevy-load-progress")).toHaveTextContent("");
    expect(within(dialog).getByTestId("hevy-load-progress")).toHaveAttribute("role", "status");
    expect(within(dialog).getByTestId("hevy-load-errors")).toHaveTextContent("");
    expect(within(dialog).getByTestId("hevy-load-errors")).toHaveAttribute("role", "alert");
  });
});

describe("Minor 186 — the preview's sections", () => {
  it("rules read as words, the file's markers are listed, and a stored rule the file changes is named", async () => {
    server.use(
      http.get(MAPPING_URL, () => HttpResponse.json({ pairs: [], sectionRules: [{ name: "Finisher", treatment: "notes_on_first" }] })),
      templatesHandler([...TEMPLATES, tpl("T-WARM", "Warmup", "reps_only")]),
    );
    const dialog = await openSheet();
    await choose(dialog, csv(`exercise,T-BENCH,,${BENCH.id},,,`, "placeholder,T-WARM,,,,warmup,", "section,,,,Warm-up,warmup_placeholder,"));
    const preview = await within(dialog).findByRole("region", { name: "Preview" });
    expect(within(preview).getByText(`Warm-up: ${TREATMENT_LABELS.warmup_placeholder}`)).toBeInTheDocument();
    expect(within(preview).queryByText(/warmup_placeholder/)).toBeNull();
    expect(within(preview).getByText(/Warmup marker: Warmup/)).toBeInTheDocument();
    expect(within(preview).getByText(sectionRulesRemovedLine(1))).toBeInTheDocument();
    expect(within(preview).getByText(/Finisher/)).toBeInTheDocument();
  });
});

describe("Minor 190 — bad section lines are left out with their line", () => {
  it("a repeated name (any case) is left out with its line; one Warm-up rule is sent", async () => {
    server.use(
      http.put(MAPPING_URL, async ({ request }) => {
        const body = (await request.json()) as { pairs: object[]; sectionRules: object[] };
        return HttpResponse.json({ pairs: body.pairs.map((p) => ({ ...p, exerciseActive: true })), sectionRules: body.sectionRules });
      }),
    );
    const dialog = await openSheet();
    // An empty name is already refused by the parser (no_sin_ref), before any preview.
    await choose(dialog, csv(`exercise,T-BENCH,,${BENCH.id},,,`, "section,,,,Warm-up,warmup_placeholder,", "section,,,,warm-up,notes_on_first,"));
    const leftOut = await within(dialog).findByRole("list", { name: "Left out" });
    expect(within(leftOut).getByText(/Line 4/)).toHaveTextContent(LEFT_OUT_COPY.section_invalid);
    await userEvent.click(within(dialog).getByRole("button", { name: loadButton(1) }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0] as { sectionRules: unknown[] }).sectionRules).toEqual([{ name: "Warm-up", treatment: "warmup_placeholder" }]);
  });
});

describe("Minor 191 — the sheet and the hook share one template read", () => {
  it("a read the markers sheet started is reused, not repeated", async () => {
    const reads: number[] = [];
    server.use(
      http.get(HEVY_TEMPLATES, async ({ request }) => {
        reads.push(Number(new URL(request.url).searchParams.get("page")));
        return HttpResponse.json({ page: 1, page_count: 1, exercise_templates: TEMPLATES });
      }),
    );
    const { queryClient } = renderHevyScreen(undefined, { catalog: CATALOG });
    // The hook's read (the Pairings and markers screens use it), then the sheet's.
    await queryClient.fetchQuery(hevyTemplatesQuery(hevyClientFor(() => VALID_KEY)));
    await userEvent.click(await screen.findByRole("button", { name: "Load a file" }));
    const dialog = await screen.findByRole("dialog", { name: "Load a mapping file" });
    await choose(dialog, GOOD);
    await within(dialog).findByRole("region", { name: "Preview" });
    expect(reads).toEqual([1]);
  });
});
