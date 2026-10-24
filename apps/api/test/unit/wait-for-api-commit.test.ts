import { describe, expect, it } from "vitest";
import { waitForApiCommit } from "../../scripts/lib/wait-for-api-commit.js";

const WANT = "a".repeat(40);
const NEWER = "b".repeat(40);
const OLDER = "c".repeat(40);

/** A fake clock: sleep advances time; fetchCommit plays a script (an Error entry throws). */
function harness(script: (string | null | Error)[], isAncestor: (o: string, n: string) => boolean | null = () => false) {
  let t = 0;
  const urls: string[] = [];
  let i = 0;
  return {
    urls,
    run: (timeoutMs = 10_000) =>
      waitForApiCommit({
        baseUrl: "https://api.example/",
        want: WANT,
        timeoutMs,
        intervalMs: 1_000,
        fetchCommit: async (url) => {
          urls.push(url);
          const next = script[Math.min(i++, script.length - 1)]!;
          if (next instanceof Error) throw next;
          return next;
        },
        isAncestor,
        now: () => t,
        sleep: async (ms) => void (t += ms),
      }),
  };
}

describe("15 AC12 — waitForApiCommit", () => {
  it("matches on the third poll, polling /healthz", async () => {
    const h = harness([OLDER, OLDER, WANT]);
    expect(await h.run()).toEqual({ result: "match", last: WANT });
    expect(h.urls).toEqual(Array(3).fill("https://api.example/healthz"));
  });
  it("never matches → timeout with the last value", async () => {
    expect(await harness([OLDER]).run(5_000)).toEqual({ result: "timeout", last: OLDER });
  });
  it("a descendant is live → superseded on the first poll", async () => {
    const h = harness([NEWER], (older, newer) => older === WANT && newer === NEWER);
    expect(await h.run()).toEqual({ result: "superseded", last: NEWER });
    expect(h.urls).toHaveLength(1);
  });
  it("no history (isAncestor null) keeps waiting to the bound", async () => {
    expect(await harness([NEWER], () => null).run(5_000)).toEqual({ result: "timeout", last: NEWER });
  });
  it("dev never matches, and is never checked for ancestry", async () => {
    let asked = false;
    const h = harness(["dev"], () => (asked = true));
    expect(await h.run(3_000)).toEqual({ result: "timeout", last: "dev" });
    expect(asked).toBe(false);
  });
  it("a thrown fetch counts as null and polling continues", async () => {
    expect(await harness([new Error("ECONNRESET"), null, WANT]).run()).toEqual({ result: "match", last: WANT });
  });
});
