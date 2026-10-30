import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
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

import { API_BASE_URL } from "../../../test/accountHarness";
import { setInstantPacing, USER_ID } from "../../../test/hevyHarness";
import { generateHevyWorkouts } from "../../../test/hevyImportFakes";
import { importButton, realBatches, setupImportRun, toSummary } from "../../../test/hevyImportRun";
import { server } from "../../../test/msw/server";
import { pinTimeZone } from "../../../test/timeZone";
import { cleanupApp } from "../../../test/workoutHarness";
import { HEVY_KEYS } from "../keys";
import { hevyKeyStore } from "../keyStore";
import { resetImportLaneForTests } from "./importLane";
import { canStartRun } from "./useImportSession";

pinTimeZone("UTC");
beforeEach(() => setInstantPacing());
afterEach(() => {
  cleanup();
  hevyKeyStore.remove(USER_ID);
  resetImportLaneForTests();
  cleanupApp();
});

/** 60 workouts, the oldest one rejected in the dry run: 59 sendable (25, 25, 9), 1 skipped. */
const sixty = () => {
  const workouts = generateHevyWorkouts(60);
  const rejected = workouts[59]!.id;
  return { workouts, imports: { outcomeFor: (id: string) => (id === rejected ? ("rejected" as const) : undefined) } };
};

const runStatus = () => screen.getByText(/^Importing…/).closest("[role=status]") as HTMLElement;

describe("20.1 AC16 — progress", () => {
  it("counts sent of sendable, the skipped, and the in-flight batch's month in a polite status; nothing goes to Hevy", async () => {
    const { hevy, imports } = setupImportRun(auth, sixty());
    const release = imports.gateRealBatch(2);
    const { user } = await toSummary();
    const hevyRequests = hevy.log.length;
    await user.click(importButton());
    expect(await screen.findByText("Importing… 25 of 59 · 1 skipped")).toBeInTheDocument();
    expect(runStatus()).toHaveTextContent("Oct 2026");
    release();
    expect(await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 })).toBeInTheDocument();
    expect(realBatches(imports).map((b) => b.workouts.length)).toEqual([25, 25, 9]);
    expect(hevy.log).toHaveLength(hevyRequests);
  });

  it("the status text changes once per batch", async () => {
    // A small delay puts each reply in its own task, as a real network does (without it MSW answers all three at once).
    const { workouts, imports: options } = sixty();
    const { imports } = setupImportRun(auth, { workouts, imports: { ...options, delayMs: 5 } });
    const release = imports.gateRealBatch(1);
    const { user } = await toSummary();
    await user.click(importButton());
    const region = await waitFor(() => runStatus());
    const seen: string[] = [region.textContent ?? ""];
    const observer = new MutationObserver(() => {
      const text = region.textContent ?? "";
      if (text !== seen[seen.length - 1]) seen.push(text);
    });
    observer.observe(region, { subtree: true, childList: true, characterData: true });
    release();
    await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 });
    observer.disconnect();
    // The last batch's line and the step change to the finish land in one render.
    expect(seen.filter((t) => t !== "")).toEqual([
      "Importing… 0 of 59 · 1 skipped Oct 2026",
      "Importing… 25 of 59 · 1 skipped Oct 2026",
      "Importing… 50 of 59 · 1 skipped Sep 2026",
    ]);
  });
});

describe("20.1 AC19 — paused UI", () => {
  it("after four failures it pauses with Resume and Stop; coming back online offers Resume, never resumes by itself", async () => {
    const { imports } = setupImportRun(auth, sixty());
    const { user } = await toSummary();
    imports.failSequence([500, 500, 500, 500]);
    await user.click(importButton());
    expect(await screen.findByText("Paused: couldn't reach the server. Everything imported so far is saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    const sent = realBatches(imports).length;
    act(() => void window.dispatchEvent(new Event("online")));
    expect(await screen.findByText("You're back online.")).toBeInTheDocument();
    expect(realBatches(imports)).toHaveLength(sent);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("after Stop, an online event changes nothing", async () => {
    const { imports } = setupImportRun(auth, sixty());
    const { user } = await toSummary();
    imports.failSequence([500, 500, 500, 500]);
    await user.click(importButton());
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Stopped" })).toBeInTheDocument();
    const sent = realBatches(imports).length;
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.queryByText("You're back online.")).toBeNull();
    expect(realBatches(imports)).toHaveLength(sent);
  });

  it("a 404 stops with the gate sentence", async () => {
    const { imports } = setupImportRun(auth, sixty());
    const { user } = await toSummary();
    imports.failSequence([404]);
    await user.click(importButton());
    expect(await screen.findByText("The Hevy import isn't available on this account")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });

  it("a 422 stops with the static message and the first error path, never a title", async () => {
    const { workouts, imports: options } = sixty();
    const { imports } = setupImportRun(auth, { workouts, imports: options });
    const { user } = await toSummary();
    imports.failSequence([{ status: 422, path: "workouts.3.startTime" }]);
    await user.click(importButton());
    const stopped = (await screen.findByRole("heading", { level: 2, name: "Stopped" })).closest("section") as HTMLElement;
    expect(within(stopped).getByText("The server didn't accept a workout in this batch.")).toBeInTheDocument();
    expect(within(stopped).getByText("Field: workouts.3.startTime")).toBeInTheDocument();
    for (const w of workouts.slice(0, 25)) expect(stopped.textContent).not.toContain(w.title!);
  });
});

describe("20.1 AC20 — stop and leave", () => {
  it("Stop during batch 2 lets it finish, then shows Stopped with the counts, Resume and Finish up", async () => {
    const { imports } = setupImportRun(auth, sixty());
    const release = imports.gateRealBatch(2);
    const { user } = await toSummary();
    await user.click(importButton());
    await screen.findByText("Importing… 25 of 59 · 1 skipped");
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Stopping after this batch…")).toBeInTheDocument();
    release();
    expect(await screen.findByRole("heading", { level: 2, name: "Stopped" })).toBeInTheDocument();
    expect(screen.getByText("50 of 59 workouts sent. What's imported so far stays.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish up" })).toBeInTheDocument();
    expect(realBatches(imports)).toHaveLength(2);
  });

  it("the Back link while running asks first; Cancel keeps the run going", async () => {
    const { imports } = setupImportRun(auth, sixty());
    const release = imports.gateRealBatch(2);
    const { user } = await toSummary();
    await user.click(importButton());
    await screen.findByText("Importing… 25 of 59 · 1 skipped");
    await user.click(screen.getByRole("link", { name: /Back to Hevy/ }));
    const dialog = await screen.findByRole("dialog", { name: "Stop the import?" });
    expect(within(dialog).getByText("What's imported so far stays, and you can run it again.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    release();
    expect(await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 })).toBeInTheDocument();
    expect(realBatches(imports)).toHaveLength(3);
  });

  it("confirming the leave stops after the batch in flight and navigates", async () => {
    const { imports } = setupImportRun(auth, sixty());
    const release = imports.gateRealBatch(2);
    const { user } = await toSummary();
    await user.click(importButton());
    await screen.findByText("Importing… 25 of 59 · 1 skipped");
    await user.click(screen.getByRole("link", { name: /Back to Hevy/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Stop the import?" })).getByRole("button", { name: "Stop and leave" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Hevy" })).toBeInTheDocument();
    release();
    await waitFor(() => expect(imports.links.size).toBe(50));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(realBatches(imports)).toHaveLength(2);
  });

  it("beforeunload is listened for only while running", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { imports } = setupImportRun(auth, sixty());
    const release = imports.gateRealBatch(1);
    const { user } = await toSummary();
    expect(add.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(0);
    await user.click(importButton());
    await waitFor(() => expect(add.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(1));
    release();
    await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 });
    expect(remove.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("20.1 Review Focus 2 — one runner", () => {
  it("two taps on Import in one tick send batch 1 once", async () => {
    const { imports } = setupImportRun(auth, sixty());
    await toSummary();
    const button = importButton();
    act(() => {
      button.click();
      button.click();
    });
    await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 });
    expect(realBatches(imports)).toHaveLength(3);
  });

  it("two taps on Resume re-send the failed batch once", async () => {
    const { imports } = setupImportRun(auth, sixty());
    const { user } = await toSummary();
    imports.failSequence([500, 500, 500, 500]);
    await user.click(importButton());
    const resume = await screen.findByRole("button", { name: "Resume" });
    act(() => {
      resume.click();
      resume.click();
    });
    await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 });
    const firsts = realBatches(imports).map((b) => b.workouts[0]!.hevyWorkoutId);
    expect(firsts.filter((id) => id === firsts[0])).toHaveLength(5);
    expect(realBatches(imports)).toHaveLength(7);
  });
});

describe("20.1 AC28 — pre-write safety", () => {
  it("canStartRun needs the status, the key, the mapping and a fresh summary", () => {
    const ok = { statusOk: true, hasKey: true, mappingOk: true, stale: false };
    expect(canStartRun(ok)).toBe(true);
    expect(canStartRun({ ...ok, statusOk: false })).toBe(false);
    expect(canStartRun({ ...ok, hasKey: false })).toBe(false);
    expect(canStartRun({ ...ok, mappingOk: false })).toBe(false);
    expect(canStartRun({ ...ok, stale: true })).toBe(false);
  });

  it("removing the key on the summary takes Import away with the reason (the route shows the key card, AC1)", async () => {
    const { imports } = setupImportRun(auth, sixty());
    await toSummary();
    expect(importButton()).toBeEnabled();
    act(() => hevyKeyStore.remove(USER_ID));
    expect(await screen.findByText("Add your Hevy key first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Import \d/ })).toBeNull();
    expect(realBatches(imports)).toEqual([]);
  });

  it("a mapping that fails to load disables Import with a static sentence", async () => {
    setupImportRun(auth, sixty());
    const { queryClient } = await toSummary();
    server.use(http.get(`${API_BASE_URL}/v1/hevy/mapping`, () => HttpResponse.json({ type: "about:blank", title: "Boom", status: 500 }, { status: 500 })));
    await act(() => queryClient.refetchQueries({ queryKey: HEVY_KEYS.mapping }));
    await waitFor(() => expect(importButton()).toBeDisabled());
    expect(screen.getByText("Couldn't load your pairings. Check your connection and try again.")).toBeInTheDocument();
  });

  it("a status refetch that can't reach the server disables Import and says so, not 'not available'", async () => {
    setupImportRun(auth, sixty());
    const { queryClient } = await toSummary();
    server.use(http.get(`${API_BASE_URL}/v1/hevy/status`, () => HttpResponse.error()));
    await act(() => queryClient.refetchQueries({ queryKey: HEVY_KEYS.statusAll }));
    await waitFor(() => expect(importButton()).toBeDisabled());
    expect(screen.getByText("Couldn't reach the server. Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText("The Hevy import isn't available on this account")).toBeNull();
  });

  it("a status refetch answering 404 disables Import; the screen stays drawn", async () => {
    setupImportRun(auth, sixty());
    const { queryClient } = await toSummary();
    server.use(http.get(`${API_BASE_URL}/v1/hevy/status`, () => HttpResponse.json({ type: "about:blank", title: "Not Found", status: 404 }, { status: 404 })));
    await act(() => queryClient.refetchQueries({ queryKey: HEVY_KEYS.statusAll }));
    await waitFor(() => expect(importButton()).toBeDisabled());
    expect(screen.getByText("The Hevy import isn't available on this account")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Summary" })).toBeInTheDocument();
  });
});
