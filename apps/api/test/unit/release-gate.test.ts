import { describe, expect, it } from "vitest";
import { STAGING_SMOKE_JOB, STAGING_SMOKE_STEP, decideRelease, parseArImages, stagingStepOf, type CiRun } from "../../scripts/lib/release-gate.js";

const sha = (c: string) => c.repeat(40);
const run = (c: string, step: CiRun["stagingStep"], createdAt: string): CiRun => ({ headSha: sha(c), createdAt, stagingStep: step });
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const images = (...cs: string[]) => new Map(cs.map((c) => [sha(c), digest(c)]));
const onMain = () => true;

describe("15 AC14 / AC21 — decideRelease", () => {
  const RUNS = [run("c", "skipped", "2026-10-24T12:00:00Z"), run("b", "success", "2026-10-24T11:00:00Z"), run("a", "success", "2026-10-24T10:00:00Z")];

  it("no input: the newest run whose staging step passed (a superseded newest run is passed over)", () =>
    expect(decideRelease({ requestedSha: null, runs: RUNS, images: images("a", "b", "c"), onMain })).toEqual({ ok: true, sha: sha("b"), digest: digest("b") }));
  it("requested and superseded → staging-skipped, naming why (Review Focus 2)", () => {
    const r = decideRelease({ requestedSha: sha("c"), runs: RUNS, images: images("a", "b", "c"), onMain });
    expect(r).toMatchObject({ ok: false, reason: "staging-skipped" });
    expect(!r.ok && r.message).toMatch(/superseded/);
    expect(!r.ok && r.message).toContain(sha("c"));
  });
  it("requested and the staging step failed → staging-failed", () =>
    expect(decideRelease({ requestedSha: sha("f"), runs: [run("f", "failure", "2026-10-24T09:00:00Z")], images: images("f"), onMain })).toMatchObject({ ok: false, reason: "staging-failed" }));
  it("requested and the step is missing (before this spec) → staging-failed", () =>
    expect(decideRelease({ requestedSha: sha("m"), runs: [run("m", "missing", "2026-10-20T09:00:00Z")], images: images("m"), onMain })).toMatchObject({ ok: false, reason: "staging-failed" }));
  it("requested and passing → its digest", () =>
    expect(decideRelease({ requestedSha: sha("b"), runs: RUNS, images: images("a", "b"), onMain })).toEqual({ ok: true, sha: sha("b"), digest: digest("b") }));
  it("rollback to a retained older commit → ok with its digest", () =>
    expect(decideRelease({ requestedSha: sha("a"), runs: RUNS, images: images("a", "b"), onMain })).toEqual({ ok: true, sha: sha("a"), digest: digest("a") }));
  it("an image the cleanup policy removed → image-missing naming the policy", () => {
    const r = decideRelease({ requestedSha: sha("a"), runs: RUNS, images: images("b"), onMain });
    expect(r).toMatchObject({ ok: false, reason: "image-missing" });
    expect(!r.ok && r.message).toMatch(/never published, or removed by the 5-image cleanup policy/);
  });
  it("not on main → not-on-main", () =>
    expect(decideRelease({ requestedSha: sha("b"), runs: RUNS, images: images("b"), onMain: () => false })).toMatchObject({ ok: false, reason: "not-on-main" }));
  it("a commit with no CI run → no-ci-run", () =>
    expect(decideRelease({ requestedSha: sha("z"), runs: RUNS, images: images("z"), onMain })).toMatchObject({ ok: false, reason: "no-ci-run" }));
  it("30 runs, none passing → no-candidate", () => {
    const runs = Array.from({ length: 30 }, (_, i) => ({ headSha: (i % 16).toString(16).repeat(40), createdAt: `2026-10-${String(1 + i).padStart(2, "0")}T00:00:00Z`, stagingStep: "failure" as const }));
    expect(decideRelease({ requestedSha: null, runs, images: new Map(), onMain })).toMatchObject({ ok: false, reason: "no-candidate" });
  });
  it("a commit with two runs: the newest run decides", () => {
    const runs = [run("d", "failure", "2026-10-24T08:00:00Z"), run("d", "success", "2026-10-24T09:00:00Z")];
    expect(decideRelease({ requestedSha: sha("d"), runs, images: images("d"), onMain })).toMatchObject({ ok: true, sha: sha("d") });
  });
  it("an uppercase requested SHA is matched case-insensitively", () =>
    expect(decideRelease({ requestedSha: sha("b").toUpperCase(), runs: RUNS, images: images("b"), onMain })).toMatchObject({ ok: true, sha: sha("b") }));
});

describe("15 AC14 — stagingStepOf", () => {
  it("the step under the staging smoke job → its conclusion", () =>
    expect(stagingStepOf([{ name: "check", steps: [] }, { name: STAGING_SMOKE_JOB, steps: [{ name: "x", conclusion: "success" }, { name: STAGING_SMOKE_STEP, conclusion: "skipped" }] }])).toBe("skipped"));
  it("the job missing → missing", () => expect(stagingStepOf([{ name: "check" }])).toBe("missing"));
  it("the step missing (an older commit) → missing", () => expect(stagingStepOf([{ name: STAGING_SMOKE_JOB, steps: [{ name: "Run x", conclusion: "success" }] }])).toBe("missing"));
  it("a step still running (null conclusion) → missing", () => expect(stagingStepOf([{ name: STAGING_SMOKE_JOB, steps: [{ name: STAGING_SMOKE_STEP, conclusion: null }] }])).toBe("missing"));
});

describe("15 AC14 — parseArImages", () => {
  it("maps each 40-hex tag to its digest; other tags are ignored", () => {
    const json = [
      { package: "us-central1-docker.pkg.dev/p/r/api", version: digest("a"), tags: [sha("a"), "latest"] },
      { package: "us-central1-docker.pkg.dev/p/r/api", version: digest("b"), tags: [] },
      { package: "us-central1-docker.pkg.dev/p/r/api", version: digest("c"), tags: "notalist" },
    ];
    expect(parseArImages(json)).toEqual(new Map([[sha("a"), digest("a")]]));
  });
  it("garbage is an empty map", () => {
    expect(parseArImages(null)).toEqual(new Map());
    expect(parseArImages({})).toEqual(new Map());
  });
});
