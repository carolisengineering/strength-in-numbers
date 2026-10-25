import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");
type Step = { id?: string; name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { needs?: string | string[]; if?: string; environment?: string; env?: Record<string, string>; permissions?: Record<string, string>; steps: Step[]; outputs?: Record<string, string> };
type Workflow = { on: Record<string, unknown>; concurrency?: unknown; jobs: Record<string, Job> };
const ci = () => parse(read(".github/workflows/ci.yml")) as Workflow;
const prod = () => parse(read(".github/workflows/deploy-prod.yml")) as Workflow;
const text = (s: Step) => `${s.name ?? ""}\n${s.run ?? ""}\n${s.uses ?? ""}\n${JSON.stringify(s.with ?? {})}`;
const indexOf = (steps: Step[], pred: (s: Step) => boolean) => steps.findIndex(pred);

describe("15 AC10 — publish on merge", () => {
  it("needs the four checks, runs only on a push to main, with an OIDC token", () => {
    const job = ci().jobs.publish!;
    expect(job.needs).toEqual(["check", "web", "integration", "docker"]);
    expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(job.permissions).toEqual({ contents: "read", "id-token": "write" });
  });
  it("skips with a notice until GCP is configured, then builds with GIT_COMMIT and tags the full SHA", () => {
    const steps = ci().jobs.publish!.steps;
    expect(steps[0]!.run).toMatch(/::notice/);
    const build = steps.find((s) => s.uses?.startsWith("docker/build-push-action@"))!;
    expect(build.with).toMatchObject({ push: true, "build-args": "GIT_COMMIT=${{ github.sha }}", tags: "${{ vars.AR_IMAGE }}:${{ github.sha }}" });
    expect(steps.some((s) => /GITHUB_STEP_SUMMARY/.test(s.run ?? "") && /digest/.test(s.run ?? ""))).toBe(true);
  });
});

describe("15 AC13 / AC16 / AC17 — deploy-prod trigger, approval and concurrency", () => {
  it("runs only on workflow_dispatch with an optional sha", () => {
    const w = prod();
    expect(Object.keys(w.on)).toEqual(["workflow_dispatch"]);
    expect((w.on.workflow_dispatch as { inputs: { sha: { required: boolean } } }).inputs.sha.required).toBe(false);
  });
  it("one deploy at a time, never canceled", () => expect(prod().concurrency).toEqual({ group: "deploy-prod", "cancel-in-progress": false }));
  it("the gate refuses any ref but main; deploy waits in the production Environment", () => {
    const { gate, deploy } = prod().jobs;
    expect(gate!.if).toBe("github.ref == 'refs/heads/main'");
    expect(gate!.permissions).toEqual({ contents: "read", actions: "read", "id-token": "write" });
    expect(deploy!.environment).toBe("production");
    expect(deploy!.needs).toBe("gate");
  });
  it("the gate refuses placeholder production ids and runs the release gate", () => {
    const steps = prod().jobs.gate!.steps;
    expect(steps.some((s) => /check-prod-ids\.ts --strict/.test(s.run ?? ""))).toBe(true);
    expect(steps.some((s) => /release-gate\.ts/.test(s.run ?? ""))).toBe(true);
    expect(prod().jobs.gate!.outputs).toEqual({ sha: "${{ steps.decide.outputs.sha }}", digest: "${{ steps.decide.outputs.digest }}" });
  });
});

describe("15 AC15 / AC18 / AC19 / AC20 — the deploy job's order", () => {
  const steps = () => prod().jobs.deploy!.steps;
  it("checks out the gate's commit", () =>
    expect(steps().find((s) => s.uses?.startsWith("actions/checkout@"))!.with).toMatchObject({ ref: "${{ needs.gate.outputs.sha }}" }));
  it("the migration check is the first step after checkout, install and prisma generate, before any Google auth", () => {
    const s = steps();
    const migrate = indexOf(s, (x) => /check-migrate-status\.ts/.test(x.run ?? ""));
    const auth = indexOf(s, (x) => (x.uses ?? "").startsWith("google-github-actions/auth@"));
    expect(migrate).toBeGreaterThan(0);
    expect(migrate).toBeLessThan(auth);
    const before = s.slice(0, migrate).map(text).join("\n");
    expect(before).not.toMatch(/gcloud|firebase deploy/);
  });
  it("DATABASE_URL_PROD appears only in the migration step's env", () => {
    const raw = read(".github/workflows/deploy-prod.yml");
    expect(raw.match(/DATABASE_URL_PROD/g)).toHaveLength(1);
    expect(steps().find((s) => /check-migrate-status/.test(s.run ?? ""))!.env).toEqual({ DATABASE_URL: "${{ secrets.DATABASE_URL_PROD }}" });
  });
  it("deploys the API by digest, never a tag, and asserts the revision", () => {
    const run = steps().map((s) => s.run ?? "").join("\n");
    expect(prod().jobs.deploy!.env).toEqual({ IMAGE: "${{ vars.AR_IMAGE }}@${{ needs.gate.outputs.digest }}" });
    expect(steps().find((s) => /gcloud run deploy/.test(s.run ?? ""))!.run).toMatch(/--image "\$IMAGE"/);
    expect(run).not.toMatch(/AR_IMAGE \}\}:/);
    expect(run).toMatch(/gcloud run services describe/);
  });
  it("API first, then the web build and Firebase deploy, then both smokes", () => {
    const s = steps();
    const api = indexOf(s, (x) => /gcloud run deploy/.test(x.run ?? ""));
    const build = indexOf(s, (x) => /--filter @sin\/web run build/.test(x.run ?? ""));
    const firebase = indexOf(s, (x) => /firebase deploy --only hosting/.test(x.run ?? ""));
    const apiSmoke = indexOf(s, (x) => /scripts\/smoke\.ts/.test(x.run ?? ""));
    const webSmoke = indexOf(s, (x) => /scripts\/smoke\.mjs/.test(x.run ?? ""));
    expect(api).toBeGreaterThan(0);
    expect([api < build, build < firebase, firebase < apiSmoke, firebase < webSmoke]).toEqual([true, true, true, true]);
    expect(s[firebase]!.run).toMatch(/pnpm --filter @sin\/web exec firebase/);
  });
  it("the web build carries the production VITE_* values and the commit; no Render origin may ship", () => {
    const build = steps().find((s) => /--filter @sin\/web run build/.test(s.run ?? ""))!;
    expect(build.env).toMatchObject({ VITE_APP_ENV: "${{ vars.VITE_APP_ENV }}", SIN_COMMIT: "${{ needs.gate.outputs.sha }}" });
    // The Environment variable must say production, or the build refuses to run.
    expect(build.run).toMatch(/\[ "\$VITE_APP_ENV" = "production" \]/);
    expect(steps().some((s) => /onrender\.com/.test(s.run ?? "") && /grep/.test(s.run ?? ""))).toBe(true);
  });
  it("the smokes check the commit, CORS and the Firebase headers", () => {
    const api = steps().find((s) => /scripts\/smoke\.ts/.test(s.run ?? ""))!;
    const web = steps().find((s) => /scripts\/smoke\.mjs/.test(s.run ?? ""))!;
    expect(api.env).toMatchObject({ EXPECT_COMMIT: "${{ needs.gate.outputs.sha }}", SMOKE_WEB_ORIGIN: "${{ vars.PROD_WEB_BASE_URL }}" });
    expect(web.env).toMatchObject({ WEB_SMOKE_HOST: "firebase", WEB_SMOKE_EXPECT_COMMIT: "${{ needs.gate.outputs.sha }}" });
  });
  it("a summary runs whatever happened", () => expect(steps().at(-1)!.if).toBe("always()"));
});

describe("15 AC21 — an image removed during the approval wait fails with its reason (#164)", () => {
  const steps = () => prod().jobs.deploy!.steps;
  it("re-checks the gate's digest after the deployer's Google auth, before the API deploy", () => {
    const s = steps();
    const gcloud = indexOf(s, (x) => (x.uses ?? "").startsWith("google-github-actions/setup-gcloud@"));
    const check = indexOf(s, (x) => /gcloud artifacts docker images describe "\$IMAGE"/.test(x.run ?? ""));
    const api = indexOf(s, (x) => /gcloud run deploy/.test(x.run ?? ""));
    expect([gcloud >= 0, gcloud < check, check < api]).toEqual([true, true, true]);
    // The job-level IMAGE (see AC18's test) is the one reference both steps use.
    expect(s[check]!.env).toBeUndefined();
  });
  it("names the cleanup policy only for a not-found answer, and fails the job either way", () => {
    const run = steps().find((x) => /gcloud artifacts docker images describe/.test(x.run ?? ""))!.run!;
    expect(run).toMatch(/\*not_found\* \| \*"not found"\*\) echo "::error::.*cleanup policy/);
    expect(run).toMatch(/\*\) echo "::error::could not look up/);
    expect(run).toMatch(/exit 1/);
  });
});

describe("15 D13 — CI never applies Terraform", () => {
  it("no terraform apply in .github/", () => {
    const dir = `${repoRoot}.github/workflows/`;
    const files = existsSync(dir) ? readdirSync(dir) : [];
    expect(files.filter((f) => /terraform\s+(-chdir=\S+\s+)?apply/.test(read(`.github/workflows/${f}`)))).toEqual([]);
  });
});

describe("15 AC3 / AC20 — final review fixes", () => {
  it("one publish is one registry version: no provenance or SBOM attestations", () => {
    const build = ci().jobs.publish!.steps.find((s) => s.uses?.startsWith("docker/build-push-action@"))!;
    expect(build.with).toMatchObject({ provenance: false, sbom: false });
  });
  it("the release record names the approver from the run's approval history", () => {
    const deploy = prod().jobs.deploy!;
    expect(deploy.permissions).toMatchObject({ actions: "read" });
    expect(deploy.steps.at(-1)!.run).toMatch(/actions\/runs\/\$\{?GITHUB_RUN_ID\}?\/approvals/);
  });
});
