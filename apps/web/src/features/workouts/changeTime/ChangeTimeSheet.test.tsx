import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETIME_MESSAGES, UpdatedWorkoutSchema, type UpdatedWorkout, type WorkoutDetail } from "@sin/core";
import { ApiError } from "../../../api";
import { pinTimeZone } from "../../../test/timeZone";
import { makeWorkoutDetail } from "../../../test/workoutFixtures";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../../test/workoutHarness";
import { EDIT_COPY } from "../edit/editCopy";
import type { WorkoutClient } from "../workoutClient";
import { ChangeTimeSheet } from "./ChangeTimeSheet";
import { useChangeTime } from "./useChangeTime";

pinTimeZone("Europe/London");
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date("2026-10-18T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

const liveWorkout = () => makeWorkoutDetail({ startedAt: "2026-10-18T09:05:00.000Z", localDate: "2026-10-18", tzOffsetMinutes: 60 });
const finishedHour = () =>
  makeWorkoutDetail({ startedAt: "2026-10-16T17:00:00.000Z", endedAt: "2026-10-16T18:00:00.000Z", localDate: "2026-10-16", tzOffsetMinutes: 60 });
const updatedOf = (w: WorkoutDetail): UpdatedWorkout => UpdatedWorkoutSchema.parse({ ...w, newRecords: [] });

function Host(props: { workout: WorkoutDetail; client: WorkoutClient; onClose: () => void; onSaved: () => void; onVanished: () => void }) {
  const mutation = useChangeTime({ where: props.workout.endedAt === null ? "live" : "edit", client: props.client, cacheKey: ["workouts", "detail", props.workout.id] });
  return <ChangeTimeSheet open workout={props.workout} mutation={mutation} onClose={props.onClose} onSaved={props.onSaved} onVanished={props.onVanished} />;
}

function setup(workout: WorkoutDetail, updateWorkout: WorkoutClient["updateWorkout"] = vi.fn(async () => updatedOf(workout))) {
  const client = fakeClient({ updateWorkout });
  const callbacks = { onClose: vi.fn(), onSaved: vi.fn(), onVanished: vi.fn() };
  render(<Host workout={workout} client={client} {...callbacks} />, { wrapper: wrapperWith(makeQueryClient(), fakeClient()) });
  return { user: userEvent.setup(), updateWorkout: vi.mocked(updateWorkout), ...callbacks };
}

const sheet = () => within(screen.getByRole("dialog", { name: "Change Time" }));
const day = () => sheet().getByLabelText("Day");
const time = () => sheet().getByLabelText("Started at");
const hours = () => sheet().getByLabelText("Hours");
const minutes = () => sheet().getByLabelText("Minutes");
const save = () => sheet().getByRole("button", { name: "Save time" });
const problem = (status: number, errors?: { path: string; message: string }[]) =>
  new ApiError({ status, type: "about:blank", title: "Title", detail: "Test problem", requestId: "req-fake", ...(errors ? { errors } : {}) });

describe("18.0 AC30 — the sheet", () => {
  it("has the labeled controls, prefilled, with the Day bounds; a live workout shows the hint", () => {
    setup(liveWorkout());
    expect(day()).toHaveAttribute("type", "date");
    expect(day()).toHaveAttribute("min", "2000-01-01");
    expect(day()).toHaveAttribute("max", "2026-10-18");
    expect(day()).toHaveValue("2026-10-18");
    expect(time()).toHaveAttribute("type", "time");
    expect(time()).toHaveValue("10:05");
    const took = sheet().getByRole("group", { name: "Took" });
    expect(within(took).getByLabelText("Hours")).toHaveValue(null);
    expect(within(took).getByLabelText("Minutes")).toHaveValue(null);
    expect(sheet().getByText(EDIT_COPY.tookHint)).toBeInTheDocument();
    expect(save()).toHaveAttribute("type", "submit");
  });

  it("a finished workout prefills Took and shows no hint", () => {
    setup(finishedHour());
    expect([day(), time(), hours(), minutes()].map((e) => (e as HTMLInputElement).value)).toEqual(["2026-10-16", "18:00", "1", "0"]);
    expect(sheet().queryByText(EDIT_COPY.tookHint)).not.toBeInTheDocument();
  });
});

describe("18.0 AC31 — only what changed", () => {
  it("no change sends nothing and closes", async () => {
    const { user, updateWorkout, onClose } = setup(finishedHour());
    await user.click(save());
    expect(updateWorkout).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Minutes 0 → 15 sends exactly { durationSeconds: 4500 }, then closes and reports saved", async () => {
    const w = finishedHour();
    const { user, updateWorkout, onClose, onSaved } = setup(w);
    await user.clear(minutes());
    await user.type(minutes(), "15");
    await user.click(save());
    expect(updateWorkout).toHaveBeenCalledWith(w.id, { durationSeconds: 4500 });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("deferred minor 15: a background refresh while open does not move the baseline — only the lifter's change is sent", async () => {
    const w = finishedHour();
    const updateWorkout = vi.fn(async () => updatedOf(w));
    const client = fakeClient({ updateWorkout });
    const callbacks = { onClose: vi.fn(), onSaved: vi.fn(), onVanished: vi.fn() };
    const { rerender } = render(<Host workout={w} client={client} {...callbacks} />, { wrapper: wrapperWith(makeQueryClient(), fakeClient()) });
    // Another device moved the start an hour earlier; the refetched workout reaches the open sheet.
    const moved = { ...w, startedAt: "2026-10-16T16:00:00.000Z" };
    rerender(<Host workout={moved} client={client} {...callbacks} />);
    const user = userEvent.setup();
    await user.clear(minutes());
    await user.type(minutes(), "15");
    await user.click(save());
    expect(updateWorkout).toHaveBeenCalledWith(w.id, { durationSeconds: 4500 });
  });

  it("deferred minor 15 (review): a live sheet stays live if the workout is finished elsewhere while it is open", () => {
    const w = liveWorkout();
    const client = fakeClient({ updateWorkout: vi.fn(async () => updatedOf(w)) });
    const callbacks = { onClose: vi.fn(), onSaved: vi.fn(), onVanished: vi.fn() };
    const { rerender } = render(<Host workout={w} client={client} {...callbacks} />, { wrapper: wrapperWith(makeQueryClient(), fakeClient()) });
    expect(sheet().getByText(EDIT_COPY.tookHint)).toBeInTheDocument();
    rerender(<Host workout={{ ...w, endedAt: "2026-10-18T09:55:00.000Z" }} client={client} {...callbacks} />);
    expect(sheet().getByText(EDIT_COPY.tookHint)).toBeInTheDocument();
  });
});

describe("18.0 AC33 — client errors block the request", () => {
  it("a start beyond now + 5 min is tied to Started at", async () => {
    const { user, updateWorkout } = setup(liveWorkout());
    fireEvent.change(time(), { target: { value: "11:30" } });
    await user.click(save());
    expect(time()).toHaveAccessibleDescription(EDIT_COPY.timeFuture);
    expect(time()).toHaveAttribute("aria-invalid", "true");
    expect(updateWorkout).not.toHaveBeenCalled();
  });

  it("a cleared Day shows Pick a day.", async () => {
    const { user, updateWorkout } = setup(liveWorkout());
    fireEvent.change(day(), { target: { value: "" } });
    await user.click(save());
    expect(day()).toHaveAccessibleDescription(EDIT_COPY.pickDay);
    expect(updateWorkout).not.toHaveBeenCalled();
  });

  it("Hours 1.5 ties the whole-numbers copy to both Took inputs", async () => {
    const { user, updateWorkout } = setup(liveWorkout());
    fireEvent.change(hours(), { target: { value: "1.5" } });
    await user.click(save());
    for (const input of [hours(), minutes()]) {
      expect(input).toHaveAccessibleDescription(expect.stringContaining(EDIT_COPY.tookWhole));
      expect(input).toHaveAttribute("aria-invalid", "true");
    }
    expect(sheet().getByText(EDIT_COPY.tookWhole)).toHaveAttribute("role", "alert");
    expect(updateWorkout).not.toHaveBeenCalled();
  });
});

describe("18.0 AC41 — failures", () => {
  async function failWith(error: unknown) {
    const updateWorkout = vi.fn<WorkoutClient["updateWorkout"]>().mockRejectedValueOnce(error).mockRejectedValueOnce(error);
    const ctx = setup(liveWorkout(), updateWorkout);
    fireEvent.change(day(), { target: { value: "2026-10-16" } });
    await ctx.user.click(save());
    return ctx;
  }

  it("network: the offline copy, values kept; Save time again retries", async () => {
    const { user, updateWorkout } = await failWith(ApiError.network("req-fake", new TypeError("Failed to fetch")));
    expect(sheet().getByText(EDIT_COPY.offline)).toBeInTheDocument();
    expect(day()).toHaveValue("2026-10-16");
    await user.click(save());
    expect(updateWorkout).toHaveBeenCalledTimes(2);
  });

  it("404: the sheet closes and the workout is reported gone", async () => {
    const { onClose, onVanished } = await failWith(problem(404));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onVanished).toHaveBeenCalledTimes(1);
  });

  it("a server 422 on startedAt shows under Started at", async () => {
    const { user, updateWorkout } = await failWith(problem(422, [{ path: "startedAt", message: RETIME_MESSAGES.future }]));
    expect(time()).toHaveAccessibleDescription(EDIT_COPY.timeFuture);
    await user.click(save());
    expect(updateWorkout).toHaveBeenCalledTimes(2);
  });

  it("500: the generic copy with the request id, never the problem's text", async () => {
    const { user, updateWorkout } = await failWith(problem(500));
    expect(sheet().getByText(EDIT_COPY.changeTimeFailed)).toBeInTheDocument();
    expect(sheet().getByText("Request ID: req-fake")).toBeInTheDocument();
    expect(screen.queryByText(/Test problem/)).not.toBeInTheDocument();
    await user.click(save());
    expect(updateWorkout).toHaveBeenCalledTimes(2);
  });
});

describe("18.0 AC42 — one request at a time", () => {
  it("a second tap while in flight sends nothing; the button is busy", async () => {
    const held = deferred<UpdatedWorkout>();
    const w = liveWorkout();
    const { user, updateWorkout } = setup(w, vi.fn(() => held.promise));
    fireEvent.change(day(), { target: { value: "2026-10-16" } });
    await user.click(save());
    fireEvent.submit(save().closest("form")!);
    expect(updateWorkout).toHaveBeenCalledTimes(1);
    expect(save()).toHaveAttribute("aria-busy", "true");
    await act(async () => held.resolve(updatedOf(w)));
  });
});

describe("18.0 AC41 — a save in flight keeps the sheet open", () => {
  it("Close and Escape do nothing until the answer; a failure then shows in the open sheet", async () => {
    const held = deferred<UpdatedWorkout>();
    const w = liveWorkout();
    const { user, onClose } = setup(w, vi.fn(() => held.promise));
    fireEvent.change(day(), { target: { value: "2026-10-16" } });
    await user.click(save());
    await user.click(sheet().getByRole("button", { name: "Close" }));
    fireEvent(screen.getByRole("dialog", { name: "Change Time" }), new Event("cancel", { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => held.reject(new TypeError("Failed to fetch")));
    expect(sheet().getByRole("alert")).toBeInTheDocument();
    await user.click(sheet().getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("18.0 AC33 — a Took the browser cannot read", () => {
  it("shows the whole-numbers copy and sends nothing (it never counts as blank)", async () => {
    const w = makeWorkoutDetail({ startedAt: "2026-10-18T09:05:00.000Z", localDate: "2026-10-18", tzOffsetMinutes: 60, plannedDurationSeconds: 3600 });
    const { user, updateWorkout } = setup(w);
    const input = hours();
    Object.defineProperty(input, "validity", { configurable: true, value: { badInput: true } });
    fireEvent.change(input, { target: { value: "" } });
    await user.clear(minutes());
    await user.click(save());
    expect(updateWorkout).not.toHaveBeenCalled();
    expect(sheet().getByText(EDIT_COPY.tookWhole)).toBeInTheDocument();
  });
});
