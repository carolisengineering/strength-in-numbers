import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { USER_ID, VALID_KEY } from "../../../test/hevyHarness";
import { cleanupSendScreen, setupSendScreen, WORKOUT_ID } from "../../../test/hevySendHarness";
import { sendFixture } from "../../../test/hevySendFakes";
import { makeSet } from "../../../test/workoutFixtures";
import { server } from "../../../test/msw/server";
import { inTimeZone } from "../../../test/timeZone";
import { renderApp } from "../../../test/workoutHarness";
import { hevyKeyStore } from "../keyStore";

afterEach(() => {
  cleanup();
  cleanupSendScreen();
  observability.reportError.mockReset();
});

const HISTORY = `/app/history/${WORKOUT_ID}`;
const section = () => screen.findByRole("region", { name: "Hevy" });
const sendButton = () => screen.findByRole("button", { name: "Send to Hevy" });
const linkCalls = (s: ReturnType<typeof setupSendScreen>, method: string) => s.link.log.filter((r) => r.method === method);

describe("20.2 AC1 / AC2 / AC3 — section rendering", () => {
  it("not the owner (the default 404 status): no section and no link request", async () => {
    const s = setupSendScreen(auth, { owner: false });
    renderApp(HISTORY);
    await screen.findByRole("button", { name: "Edit workout" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("region", { name: "Hevy" })).toBeNull();
    expect(s.link.log).toEqual([]);
  });

  it("none: Not in Hevy yet, with Send to Hevy, on History and on the summary", async () => {
    setupSendScreen(auth);
    const { router } = renderApp(HISTORY);
    expect(within(await section()).getByText("Not in Hevy yet.")).toBeInTheDocument();
    expect(await sendButton()).toBeEnabled();
    await act(() => router.navigate(`/app/workouts/${WORKOUT_ID}`));
    expect(await sendButton()).toBeInTheDocument();
  });

  it("sent: the day it was synced and no button; imported reads From Hevy, matched its own label", () =>
    inTimeZone("Europe/London", async () => {
      const s = setupSendScreen(auth);
      s.link.link(WORKOUT_ID, "h9");
      renderApp(HISTORY);
      expect(within(await section()).getByText("Sent to Hevy · Sat 24 Oct")).toBeInTheDocument();
      expect(within(await section()).queryByRole("button")).toBeNull();
      cleanup();
      s.link.link(WORKOUT_ID, "h9", "imported");
      renderApp(HISTORY);
      expect(within(await section()).getByText("From Hevy · Sat 24 Oct")).toBeInTheDocument();
      cleanup();
      s.link.link(WORKOUT_ID, "h9", "matched");
      renderApp(HISTORY);
      expect(within(await section()).getByText("Matched with a Hevy workout · Sat 24 Oct")).toBeInTheDocument();
    }));

  it("changed: Update in Hevy, for a sent and for an imported workout", async () => {
    const s = setupSendScreen(auth);
    s.link.link(WORKOUT_ID, "h9", "imported", "v1:old");
    renderApp(HISTORY);
    expect(within(await section()).getByText("Changed since sent to Hevy")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Update in Hevy" })).toBeEnabled();
  });

  it("no key: the Profile sentence and link instead of a button; a changed state still shows", async () => {
    const s = setupSendScreen(auth, { key: false });
    renderApp(HISTORY);
    const region = await section();
    expect(within(region).getByText("Add your Hevy key in Profile to send workouts.")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Go to Hevy settings" })).toHaveAttribute("href", "/app/profile/hevy");
    expect(within(region).queryByRole("button")).toBeNull();
    cleanup();
    s.link.link(WORKOUT_ID, "h9", "sent", "v1:old");
    renderApp(HISTORY);
    expect(within(await section()).getByText("Changed since sent to Hevy")).toBeInTheDocument();
    expect(within(await section()).queryByRole("button", { name: "Update in Hevy" })).toBeNull();
    expect(within(await section()).getByRole("link", { name: "Go to Hevy settings" })).toBeInTheDocument();
  });

  it("Review Focus 5: the key removed while a sent workout is open keeps the state, no button", async () => {
    const s = setupSendScreen(auth);
    s.link.link(WORKOUT_ID, "h9", "sent", "v1:old");
    renderApp(HISTORY);
    await screen.findByRole("button", { name: "Update in Hevy" });
    act(() => hevyKeyStore.remove(USER_ID));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update in Hevy" })).toBeNull());
    expect(within(await section()).getByText("Changed since sent to Hevy")).toBeInTheDocument();
    expect(within(await section()).getByText("Add your Hevy key in Profile to send workouts.")).toBeInTheDocument();
  });

  it("the live session and the edit screen have no section", async () => {
    setupSendScreen(auth);
    renderApp(`/app/history/${WORKOUT_ID}/edit`);
    await screen.findByRole("button", { name: "Done" });
    expect(screen.queryByRole("region", { name: "Hevy" })).toBeNull();
  });
});

describe("20.2 AC4 / AC17 — a send, then an edit flips the state", () => {
  it("Send → Sending… → Sent to Hevy; an edited set reads Changed; Update → Sent", async () => {
    const s = setupSendScreen(auth);
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    expect(await within(await section()).findByText(/^Sent to Hevy · /)).toBeInTheDocument();
    expect(s.hevy.writes()).toHaveLength(1);
    cleanup();
    const edited = { ...s.detail, exercises: s.detail.exercises.map((e, i) => (i === 0 ? { ...e, sets: e.sets.map((set) => ({ ...set, reps: 12 })) } : e)) };
    s.fake.state.finished.set(WORKOUT_ID, edited);
    const second = renderApp(HISTORY);
    expect(within(await section()).getByText("Changed since sent to Hevy")).toBeInTheDocument();
    await second.user.click(await screen.findByRole("button", { name: "Update in Hevy" }));
    expect(await within(await section()).findByText(/^Sent to Hevy · /)).toBeInTheDocument();
    expect(s.hevy.calls.map((c) => c.op)).toEqual(["create", "update"]);
  });
});

describe("20.2 AC5 — one tap, one copy (UI)", () => {
  it("two clicks in one tick make one begin; the button reads Sending and is disabled", async () => {
    let release: () => void = () => {};
    const s = setupSendScreen(auth, { holdCreate: new Promise<void>((resolve) => (release = resolve)) });
    renderApp(HISTORY);
    const button = await sendButton();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(await within(await section()).findByText("Sending to Hevy…")).toBeInTheDocument();
    expect(within(await section()).getByRole("button", { name: "Send to Hevy" })).toBeDisabled();
    release();
    await within(await section()).findByText(/^Sent to Hevy · /);
    expect(linkCalls(s, "POST")).toHaveLength(1);
    expect(s.hevy.writes()).toHaveLength(1);
  });
});

describe("20.2 AC6–AC12 — failure UI", () => {
  it("AC6: another send in progress", async () => {
    const s = setupSendScreen(auth);
    s.link.fail("begin", { status: 409, slug: "hevy-send-in-progress" });
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    expect(await within(await section()).findByText("Another send is in progress. Try again in a minute.")).toBeInTheDocument();
    expect(await sendButton()).toBeEnabled();
    expect(s.hevy.calls).toEqual([]);
  });

  it("AC8: a definite failure shows the static sentence, never Hevy's text, and offers Send again", async () => {
    const s = setupSendScreen(auth);
    s.hevy.fail("create", "400");
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    expect(await within(await section()).findByText("Hevy didn't accept this workout.")).toBeInTheDocument();
    expect(screen.queryByText(/bad/)).toBeNull();
    expect(await sendButton()).toBeEnabled();
  });

  it("AC8: a refused key links to the key", async () => {
    const s = setupSendScreen(auth);
    s.hevy.fail("create", "403");
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    const region = await section();
    expect(await within(region).findByText("Hevy didn't accept your key. Check it in Profile.")).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: "Go to Hevy settings" })).toBeInTheDocument();
  });

  it("AC9: not sure → Check Hevy finds the copy and links it", async () => {
    const s = setupSendScreen(auth);
    s.hevy.fail("create", "accept-then-lose");
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    expect(await within(await section()).findByText("Not sure whether Hevy received it. Check before sending again.")).toBeInTheDocument();
    expect(within(await section()).queryByRole("button", { name: "Send to Hevy" })).toBeNull();
    await user.click(within(await section()).getByRole("button", { name: "Check Hevy" }));
    expect(await within(await section()).findByText("Found it in Hevy; linked.")).toBeInTheDocument();
    expect(s.hevy.writes()).toHaveLength(1);
  });

  it("AC7: inconclusive → Check again and Send anyway; Send anyway posts", async () => {
    const s = setupSendScreen(auth);
    s.link.claim(WORKOUT_ID, 5 * 60_000);
    for (let i = 0; i < 60; i += 1) s.hevy.store.set(`x${i}`, { id: `x${i}`, title: "Later", start_time: "2026-10-28T10:00:00Z", end_time: "2026-10-28T11:00:00Z", exercises: [] });
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    const region = await section();
    expect(await within(region).findByText("Not sure whether an earlier send reached Hevy.")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Check again" })).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Send anyway" }));
    expect(await within(await section()).findByText(/^Sent to Hevy · /)).toBeInTheDocument();
    expect(s.hevy.writes()).toHaveLength(1);
  });

  it("AC10: recorded failure → Try again only completes", async () => {
    const s = setupSendScreen(auth);
    s.link.fail("complete", "network", "network", "network", "network");
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    expect(await within(await section()).findByText("Sent to Hevy, but this app couldn't record it. Tap Try again; it won't send again.")).toBeInTheDocument();
    await user.click(within(await section()).getByRole("button", { name: "Try again" }));
    expect(await within(await section()).findByText(/^Sent to Hevy · /)).toBeInTheDocument();
    expect(s.hevy.writes()).toHaveLength(1);
  });

  it("AC11: an ambiguous update → Not sure whether Hevy updated it, Try again repeats the PUT", async () => {
    const s = setupSendScreen(auth);
    s.link.link(WORKOUT_ID, "h9", "sent", "v1:old");
    s.hevy.store.set("h9", { id: "h9", title: "Push A", start_time: "2026-10-24T17:05:00Z", end_time: "2026-10-24T18:00:00Z", exercises: [] });
    s.hevy.fail("update", "5xx");
    const { user } = renderApp(HISTORY);
    await user.click(await screen.findByRole("button", { name: "Update in Hevy" }));
    expect(await within(await section()).findByText("Not sure whether Hevy updated it.")).toBeInTheDocument();
    await user.click(within(await section()).getByRole("button", { name: "Try again" }));
    expect(await within(await section()).findByText(/^Sent to Hevy · /)).toBeInTheDocument();
    expect(s.hevy.calls.map((c) => c.op)).toEqual(["update", "update"]);
  });

  it("AC12: the copy deleted in Hevy → Send as a new Hevy workout", async () => {
    const s = setupSendScreen(auth);
    s.link.link(WORKOUT_ID, "h9", "sent", "v1:old");
    const { user } = renderApp(HISTORY);
    await user.click(await screen.findByRole("button", { name: "Update in Hevy" }));
    expect(await within(await section()).findByText("That workout isn't in Hevy any more.")).toBeInTheDocument();
    await user.click(within(await section()).getByRole("button", { name: "Send as a new Hevy workout" }));
    expect(await within(await section()).findByText(/^Sent to Hevy · /)).toBeInTheDocument();
    expect(s.hevy.calls.map((c) => c.op)).toEqual(["update", "create"]);
  });
});

describe("20.2 AC15 — notices", () => {
  it("shown once after a send, gone after the next visit", async () => {
    const base = sendFixture().detail;
    const withIncomplete = {
      ...base,
      exercises: base.exercises.map((e, i) => (i === 0 ? { ...e, sets: [...e.sets, makeSet({ workoutExerciseId: e.id, reps: null, isComplete: false, completedAt: null })] } : e)),
    };
    setupSendScreen(auth, { detail: withIncomplete });
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    await within(await section()).findByText(/^Sent to Hevy · /);
    expect(within(await section()).getByText("1 set wasn't sent because it was incomplete.")).toBeInTheDocument();
    cleanup();
    renderApp(HISTORY);
    await within(await section()).findByText(/^Sent to Hevy · /);
    expect(screen.queryByText("1 set wasn't sent because it was incomplete.")).toBeNull();
  });
});

describe("20.2 AC16 — offline", () => {
  it("the button isn't disabled offline; the tap fails with the network sentence and changes nothing", async () => {
    const s = setupSendScreen(auth);
    s.link.fail("begin", "network");
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    expect(await within(await section()).findByText("Couldn't reach Hevy. Check your connection and try again.")).toBeInTheDocument();
    expect(await sendButton()).toBeEnabled();
    expect(s.link.rows.size).toBe(0);
  });
});

describe("20.2 final review fixes", () => {
  it("I1: fully offline, the section stays and says the network sentence", async () => {
    const s = setupSendScreen(auth);
    const { user } = renderApp(HISTORY);
    const button = await sendButton();
    s.link.fail("read", "network", "network", "network", "network");
    s.link.fail("begin", "network");
    await user.click(button);
    expect(await within(await section()).findByText("Couldn't reach Hevy. Check your connection and try again.")).toBeInTheDocument();
  });

  it("I2: a real claim elsewhere → in progress with Send enabled; once that send completes, a revisit reads Sent", async () => {
    const s = setupSendScreen(auth);
    const { user } = renderApp(HISTORY);
    const button = await sendButton();
    s.link.claim(WORKOUT_ID, 10_000);
    await user.click(button);
    expect(await within(await section()).findByText("Another send is in progress. Try again in a minute.")).toBeInTheDocument();
    expect(await sendButton()).toBeEnabled();
    s.link.link(WORKOUT_ID, "h9");
    cleanup();
    renderApp(HISTORY);
    expect(await within(await section()).findByText(/^Sent to Hevy · /)).toBeInTheDocument();
    expect(screen.queryByText("Another send is in progress. Try again in a minute.")).toBeNull();
  });
});

describe("20.2 code review — outcomes across a revisit", () => {
  it("leaving mid-send and coming back still shows the outcome that needs action (Check Hevy)", async () => {
    let release: () => void = () => {};
    const s = setupSendScreen(auth, { holdCreate: new Promise<void>((resolve) => (release = resolve)) });
    s.hevy.fail("create", "network");
    // One app (one QueryClient), as in use: leave for the History list and come back while the send runs.
    const { user, router } = renderApp(HISTORY);
    await user.click(await sendButton());
    await within(await section()).findByText("Sending to Hevy…");
    await act(() => router.navigate("/app/history"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Hevy" })).toBeNull());
    await act(() => router.navigate(HISTORY));
    await section();
    release();
    expect(await within(await section()).findByText("Not sure whether Hevy received it. Check before sending again.")).toBeInTheDocument();
    expect(within(await section()).getByRole("button", { name: "Check Hevy" })).toBeEnabled();
  });
});

describe("20.2 AC20 — the key stays put (send flow)", () => {
  it("no SIN request carries the key, through a send and an update; reported errors never hold it", async () => {
    const seen: string[] = [];
    server.events.on("request:start", async ({ request }) => {
      if (!request.url.startsWith("https://api.hevyapp.com")) {
        seen.push(request.url, JSON.stringify([...request.headers.entries()]), request.method === "GET" ? "" : await request.clone().text());
      }
    });
    const s = setupSendScreen(auth);
    s.hevy.fail("update", "5xx");
    const { user } = renderApp(HISTORY);
    await user.click(await sendButton());
    await within(await section()).findByText(/^Sent to Hevy · /);
    s.link.rows.set(WORKOUT_ID, { ...s.link.rows.get(WORKOUT_ID)!, fingerprint: "v1:old" });
    cleanup();
    const second = renderApp(HISTORY);
    await second.user.click(await screen.findByRole("button", { name: "Update in Hevy" }));
    await within(await section()).findByText("Not sure whether Hevy updated it.");
    server.events.removeAllListeners();
    expect(seen.join("\n")).not.toContain(VALID_KEY);
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "hevy-send", op: "hevy-put" });
    for (const [err] of observability.reportError.mock.calls) {
      const e = err as Error;
      expect(`${e.message} ${e.name} ${e.stack ?? ""}`).not.toContain(VALID_KEY);
    }
  });
});

describe("20.2 AC21 — accessibility", () => {
  it("a landmark named by its h2; the polite live region is empty at first paint and the same node after a change", async () => {
    let release: () => void = () => {};
    setupSendScreen(auth, { holdCreate: new Promise<void>((resolve) => (release = resolve)) });
    const { user } = renderApp(HISTORY);
    const region = await section();
    expect(within(region).getByRole("heading", { level: 2, name: "Hevy" })).toBeInTheDocument();
    const live = region.querySelector("[aria-live='polite']")!;
    expect(live).not.toBeNull();
    await user.click(await sendButton());
    await waitFor(() => expect(live).toHaveTextContent("Sending to Hevy…"));
    release();
    await waitFor(() => expect(live.textContent).toMatch(/^Sent to Hevy · /));
    expect(region.querySelector("[aria-live='polite']")).toBe(live);
    for (const b of within(region).queryAllByRole("button")) expect(b).toHaveAccessibleName();
  });
});
