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
import { renderHevyScreen } from "../../../test/hevyHarness";
import { server } from "../../../test/msw/server";
import { PAIRINGS_PATH } from "../paths";
import { PAIRINGS_LOADING, PAIRINGS_PATCH_FAILED, lastPairingBody, mappingRateLimited, removedDone, sentAsDone } from "../messages";
import { PairingsScreen } from "./PairingsScreen";

const MAPPING_URL = `${API_BASE_URL}/v1/hevy/mapping`;
const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });
const ROW = makeExercise({ id: exerciseId(2), name: "Row Erg", modality: "calories" });
const GONE = makeExercise({ id: exerciseId(3), name: "Old Curl", isActive: false });
const p = (id: string, title: string, role: string, exId: string | null, extra: Record<string, unknown> = {}) => ({
  hevyTemplateId: id,
  hevyTitle: title,
  hevyType: "weight_reps",
  role,
  exerciseId: exId,
  exerciseActive: exId === null ? null : true,
  measureRule: null,
  exportAs: false,
  ...extra,
});
const MAPPING = {
  pairs: [
    p("B1", "Bench Press (Barbell)", "exercise", BENCH.id, { exportAs: true }),
    p("B2", "Bench Press - Close Grip (Barbell)", "exercise", BENCH.id),
    p("R1", "Echo Bike (calories)", "exercise", ROW.id, { hevyType: "reps_only", measureRule: "calories_as_reps", exportAs: true }),
    p("G1", "Curl (Dumbbell)", "exercise", GONE.id, { exerciseActive: false, exportAs: true }),
    p("S1", "Stretching", "skip", null),
    p("S2", "Foam rolling", "skip", null),
    p("W1", "Warmup", "warmup_placeholder", null),
  ],
  sectionRules: [],
};

let patches: unknown[] = [];
beforeEach(() => {
  stubAccountEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  patches = [];
  server.use(http.get(MAPPING_URL, () => HttpResponse.json(MAPPING)));
  server.events.on("request:start", async ({ request }) => {
    if (request.method === "PATCH") patches.push(await request.clone().json());
  });
});
afterEach(() => {
  server.events.removeAllListeners();
  unstubAccountEnv();
});

const open = (catalog = [BENCH, ROW, GONE]) =>
  renderHevyScreen(undefined, { catalog, path: PAIRINGS_PATH, routes: [{ path: PAIRINGS_PATH, element: <PairingsScreen /> }] });
const group = async (name: string) => screen.findByRole("region", { name });

describe("20.0 AC24 — the list", () => {
  it("shows each exercise's pairings with type, rule badge and Sent as this; deleted, skipped and markers apart", async () => {
    open();
    expect(await screen.findByRole("heading", { level: 1, name: "Pairings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Hevy" })).toHaveAttribute("href", "/app/profile/hevy");
    const bench = await group("Bench Press");
    expect(within(bench).getByText("Bench Press (Barbell)")).toBeInTheDocument();
    expect(within(bench).getAllByText("Weight & reps").length).toBe(2);
    expect(within(bench).getByText("Sent as this")).toBeInTheDocument();
    expect(within(bench).getByRole("button", { name: "Send as this: Bench Press - Close Grip (Barbell)" })).toBeInTheDocument();
    const row = await group("Row Erg");
    expect(within(row).getByText("calories as reps")).toBeInTheDocument();
    const deleted = await group("Exercises you deleted (1)");
    expect(within(deleted).getByText("Curl (Dumbbell)")).toBeInTheDocument();
    expect(within(deleted).queryByRole("button", { name: /Send as this/ })).toBeNull();
    expect(within(deleted).getByRole("button", { name: "Remove pairing: Curl (Dumbbell)" })).toBeInTheDocument();
    expect(await group("Skipped in Hevy (2)")).toHaveTextContent("Stretching");
    expect(await group("Section markers (1)")).toHaveTextContent("Warmup");
    const names = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(names.indexOf("Bench Press")).toBeLessThan(names.indexOf("Row Erg"));
  });

  it("search narrows by the SIN name", async () => {
    open();
    await group("Bench Press");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search exercises" }), "row");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Bench Press" })).toBeNull());
    expect(screen.getByRole("region", { name: "Row Erg" })).toBeInTheDocument();
  });

  it("renders 600 pairings at once, with no virtualization", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => makeExercise({ id: exerciseId(100 + i), name: `Exercise ${String(i).padStart(3, "0")}` }));
    server.use(http.get(MAPPING_URL, () => HttpResponse.json({ pairs: rows.map((r, i) => p(`T${i}`, `Hevy ${i}`, "exercise", r.id, { exportAs: true })), sectionRules: [] })));
    open(rows);
    await group("Exercise 599");
    expect(screen.getAllByText("Sent as this")).toHaveLength(600);
  });
});

describe("20.0 AC25 — actions", () => {
  it("Send as this patches that pair as the export pair, and the list shows the response", async () => {
    server.use(
      http.patch(MAPPING_URL, () =>
        HttpResponse.json({ ...MAPPING, pairs: MAPPING.pairs.map((x) => (x.exerciseId === BENCH.id ? { ...x, exportAs: x.hevyTemplateId === "B2" } : x)) }),
      ),
    );
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Send as this: Bench Press - Close Grip (Barbell)" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      upsert: [{ hevyTemplateId: "B2", hevyTitle: "Bench Press - Close Grip (Barbell)", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, measureRule: null, exportAs: true }],
    });
    expect(await screen.findByRole("button", { name: "Send as this: Bench Press (Barbell)" })).toBeInTheDocument();
  });

  it("Remove pairing asks, naming the Hevy exercise, then patches the removal", async () => {
    server.use(http.patch(MAPPING_URL, () => HttpResponse.json({ ...MAPPING, pairs: MAPPING.pairs.filter((x) => x.hevyTemplateId !== "B2") })));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Remove pairing: Bench Press - Close Grip (Barbell)" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Bench Press - Close Grip (Barbell)");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove pairing" }));
    await waitFor(() => expect(patches).toEqual([{ remove: ["B2"] }]));
    await waitFor(() => expect(screen.queryByText("Bench Press - Close Grip (Barbell)")).toBeNull());
  });

  it("removing an exercise's last pairing says it won't be sent", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Remove pairing: Echo Bike (calories)" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(lastPairingBody("Row Erg"));
  });

  it("a failed patch shows a static notice and leaves the list, and is not retried", async () => {
    let calls = 0;
    server.use(http.patch(MAPPING_URL, () => {
      calls += 1;
      return HttpResponse.json({ type: "x/internal", title: "t", status: 500, detail: "d", instance: "i" }, { status: 500, headers: { "content-type": "application/problem+json" } });
    }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Send as this: Bench Press - Close Grip (Barbell)" }));
    expect(await screen.findByText(PAIRINGS_PATCH_FAILED)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send as this: Bench Press - Close Grip (Barbell)" })).toBeInTheDocument();
    expect(calls).toBe(1);
  });
});

describe("Minor 179 — Pairings before the first catalog sync (Review Focus 3)", () => {
  it("shows a loading line, not 'Exercises you deleted', for active pairs whose exercise isn't loaded yet", async () => {
    server.use(http.get(MAPPING_URL, () => HttpResponse.json({ pairs: [p("B1", "Bench Press (Barbell)", "exercise", BENCH.id, { exportAs: true })], sectionRules: [] })));
    renderHevyScreen(undefined, { unsyncedCatalog: true, path: PAIRINGS_PATH, routes: [{ path: PAIRINGS_PATH, element: <PairingsScreen /> }] });
    expect(await screen.findByText(PAIRINGS_LOADING)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Exercises you deleted/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove pairing/ })).toBeNull();
  });
});

describe("Minor 180 — Send as and Remove announce, and Remove keeps focus", () => {
  const status = () => screen.getByTestId("hevy-pairings-status");

  it("the status line is empty at first paint, then names the Send as, with focus", async () => {
    server.use(
      http.patch(MAPPING_URL, () =>
        HttpResponse.json({ ...MAPPING, pairs: MAPPING.pairs.map((x) => (x.exerciseId === BENCH.id ? { ...x, exportAs: x.hevyTemplateId === "B2" } : x)) }),
      ),
    );
    open();
    await screen.findByRole("button", { name: "Send as this: Bench Press - Close Grip (Barbell)" });
    expect(status()).toHaveTextContent("");
    expect(status()).toHaveAttribute("role", "status");
    await userEvent.click(screen.getByRole("button", { name: "Send as this: Bench Press - Close Grip (Barbell)" }));
    await waitFor(() => expect(status()).toHaveTextContent(sentAsDone("Bench Press - Close Grip (Barbell)")));
    await waitFor(() => expect(status()).toHaveFocus());
  });

  it("after Remove the status names it and holds focus (not the body)", async () => {
    server.use(http.patch(MAPPING_URL, () => HttpResponse.json({ ...MAPPING, pairs: MAPPING.pairs.filter((x) => x.hevyTemplateId !== "B2") })));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Remove pairing: Bench Press - Close Grip (Barbell)" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove pairing" }));
    await waitFor(() => expect(status()).toHaveTextContent(removedDone("Bench Press - Close Grip (Barbell)")));
    await waitFor(() => expect(status()).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("Minor 181 — Pairings' 429 says how long", () => {
  it("a PATCH 429 with Retry-After 12 shows the 12-second sentence", async () => {
    server.use(
      http.patch(MAPPING_URL, () =>
        HttpResponse.json({ type: "x/rate-limited", title: "t", status: 429, detail: "d", instance: "i" }, { status: 429, headers: { "content-type": "application/problem+json", "retry-after": "12" } }),
      ),
    );
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Send as this: Bench Press - Close Grip (Barbell)" }));
    expect(await screen.findByText(mappingRateLimited(12_000))).toBeInTheDocument();
  });
});
