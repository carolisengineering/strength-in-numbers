import { describe, expect, it } from "vitest";

import { markResumeAttempted, resumeAttempted } from "./resumeAttempt";

/** Just enough of `History` for the helper: one entry's `state` + `replaceState`. */
function fakeHistory(state: unknown = null): History {
  const h = {
    state,
    replaceState(next: unknown) {
      h.state = next;
    },
  };
  return h as unknown as History;
}

describe("AC4 (#14) — resumeAttempt marks the history entry a resume left from", () => {
  it("is false for an unmarked entry, true once marked", () => {
    const h = fakeHistory();
    expect(resumeAttempted(h)).toBe(false);
    markResumeAttempted(h);
    expect(resumeAttempted(h)).toBe(true);
  });

  it("keeps React Router's own keys on the entry", () => {
    const h = fakeHistory({ usr: { returnTo: "/app/history/1" }, key: "k1", idx: 0 });
    markResumeAttempted(h);
    expect(h.state).toMatchObject({ usr: { returnTo: "/app/history/1" }, key: "k1", idx: 0 });
  });

  it("only an exact `true` counts", () => {
    expect(resumeAttempted(fakeHistory({ sinResumeAttempted: "true" }))).toBe(false);
    expect(resumeAttempted(fakeHistory("not an object"))).toBe(false);
  });

  it("defaults to window.history", () => {
    window.history.replaceState(null, "");
    expect(resumeAttempted()).toBe(false);
    markResumeAttempted();
    expect(resumeAttempted()).toBe(true);
    window.history.replaceState(null, "");
  });
});
