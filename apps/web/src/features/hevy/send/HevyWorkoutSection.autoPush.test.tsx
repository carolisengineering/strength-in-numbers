import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";
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
const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { API_BASE_URL } from "../../../test/accountHarness";
import { EXERCISE_A, EXERCISE_B, sendFixture } from "../../../test/hevySendFakes";
import { cleanupSendScreen, setupSendScreen, WORKOUT_ID } from "../../../test/hevySendHarness";
import { server } from "../../../test/msw/server";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { renderApp } from "../../../test/workoutHarness";
import { setHevyAutoPush } from "../../../ui/hevyAutoPush";

const HISTORY = `/app/history/${WORKOUT_ID}`;
const section = () => screen.findByRole("region", { name: "Hevy" });
const sendButton = () => screen.findByRole("button", { name: "Send to Hevy" });
const NO_PAIRS = { pairs: [], sectionRules: [] };

/** Three exercises, none paired. */
const threeUnmatched = () =>
  makeWorkoutDetail({
    id: WORKOUT_ID,
    title: "Push A",
    startedAt: "2026-10-24T17:05:00.000Z",
    endedAt: "2026-10-24T18:10:00.000Z",
    exercises: [
      { exerciseId: EXERCISE_A, name: "Bench Press", modality: "weight_reps", sets: [makeSet()] },
      { exerciseId: EXERCISE_B, name: "Row", modality: "weight_reps", sets: [makeSet()] },
      { exerciseId: "e0000000-0000-4000-8000-00000000000c", name: "Curl", modality: "weight_reps", sets: [makeSet()] },
    ],
  });

/** Counts the mapping reads (the harness serves them). */
function countMappingReads() {
  const reads = { n: 0 };
  server.events.on("request:start", ({ request }) => {
    if (request.method === "GET" && new URL(request.url).pathname === "/v1/hevy/mapping") reads.n += 1;
  });
  return reads;
}

beforeEach(() => setHevyAutoPush(true));
afterEach(() => {
  server.events.removeAllListeners();
  cleanup();
  cleanupSendScreen();
  setHevyAutoPush(false);
});

describe("20.2 AC25 — the needs-matching line", () => {
  it("auto-push on, an unsent workout with 3 unmatched exercises: the plural line, above Send", async () => {
    setupSendScreen(auth, { detail: threeUnmatched(), mapping: NO_PAIRS });
    renderApp(HISTORY);
    const region = await section();
    const line = await within(region).findByText("3 exercises need matching before this can go to Hevy.");
    expect(line.compareDocumentPosition(await sendButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("one unmatched exercise: the singular line", async () => {
    const { mapping } = sendFixture();
    setupSendScreen(auth, { mapping: { ...mapping, pairs: mapping.pairs.slice(0, 1) } });
    renderApp(HISTORY);
    expect(await within(await section()).findByText("1 exercise needs matching before this can go to Hevy.")).toBeInTheDocument();
  });

  it("every exercise matched: no line", async () => {
    setupSendScreen(auth);
    renderApp(HISTORY);
    await sendButton();
    await waitFor(() => expect(screen.queryByText(/need(s)? matching/)).toBeNull());
  });

  it("auto-push off: no line, and the section reads no mapping", async () => {
    setHevyAutoPush(false);
    const reads = countMappingReads();
    setupSendScreen(auth, { detail: threeUnmatched(), mapping: NO_PAIRS });
    renderApp(HISTORY);
    await sendButton();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/need(s)? matching/)).toBeNull();
    expect(reads.n).toBe(0);
  });

  it("a sent workout: no line", async () => {
    const s = setupSendScreen(auth, { mapping: NO_PAIRS });
    s.link.link(WORKOUT_ID, "h9");
    renderApp(HISTORY);
    expect(await within(await section()).findByText(/^Sent to Hevy/)).toBeInTheDocument();
    expect(screen.queryByText(/need(s)? matching/)).toBeNull();
  });

  it("no key: no line", async () => {
    setupSendScreen(auth, { detail: threeUnmatched(), mapping: NO_PAIRS, key: false });
    renderApp(HISTORY);
    expect(await within(await section()).findByText("Add your Hevy key in Profile to send workouts.")).toBeInTheDocument();
    expect(screen.queryByText(/need(s)? matching/)).toBeNull();
  });

  it("a failed mapping read: no line, and Send still works", async () => {
    setupSendScreen(auth, { detail: threeUnmatched(), mapping: NO_PAIRS });
    server.use(http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => new Response(null, { status: 503 })));
    renderApp(HISTORY);
    expect(await sendButton()).toBeEnabled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/need(s)? matching/)).toBeNull();
  });

  it("tapping Send opens Match exercises for Hevy", async () => {
    setupSendScreen(auth, { detail: threeUnmatched(), mapping: NO_PAIRS });
    const { user } = renderApp(HISTORY);
    await within(await section()).findByText("3 exercises need matching before this can go to Hevy.");
    await user.click(await sendButton());
    expect(await screen.findByRole("dialog", { name: "Match exercises for Hevy" })).toBeInTheDocument();
  });
});
