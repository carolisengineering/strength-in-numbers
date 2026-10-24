import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const INFRA = `${repoRoot}infra/`;
const tfFiles = () => (existsSync(INFRA) ? readdirSync(INFRA).filter((f) => f.endsWith(".tf")) : []);
/** The Terraform code with `#` comments removed: a comment that names a forbidden type is not a use of it. */
const tf = () => tfFiles().map((f) => readFileSync(INFRA + f, "utf8").replace(/(^|\s)#.*$/gm, "$1")).join("\n");

/** AC8: the free-tier resource types this project may create, and nothing else. */
const ALLOWED = new Set([
  "google_project_service",
  "google_artifact_registry_repository",
  "google_artifact_registry_repository_iam_member",
  "google_cloud_run_v2_service",
  "google_cloud_run_v2_service_iam_member",
  "google_secret_manager_secret",
  "google_secret_manager_secret_iam_member",
  "google_firebase_project",
  "google_firebase_hosting_site",
  "google_iam_workload_identity_pool",
  "google_iam_workload_identity_pool_provider",
  "google_service_account",
  "google_service_account_iam_member",
  "google_project_iam_member",
  "google_billing_budget",
]);

describe("15 AC8 — free tier only", () => {
  it("infra/ has its files", () => expect(tfFiles().sort()).toEqual(
    ["apis.tf", "budget.tf", "hosting.tf", "identity.tf", "outputs.tf", "registry.tf", "run.tf", "secrets.tf", "variables.tf", "versions.tf"]));
  it("every resource type is on the allowlist", () => {
    const types = [...tf().matchAll(/^resource\s+"([a-z0-9_]+)"/gm)].map((m) => m[1]!);
    expect(types.length).toBeGreaterThan(10);
    expect(types.filter((t) => !ALLOWED.has(t))).toEqual([]);
  });
  it("Cloud Run scales 0 to 1, and nothing else sets other bounds", () => {
    const text = tf();
    expect([...text.matchAll(/min_instance_count\s*=\s*(\S+)/g)].map((m) => m[1])).toEqual(["0"]);
    expect([...text.matchAll(/max_instance_count\s*=\s*(\S+)/g)].map((m) => m[1])).toEqual(["1"]);
  });
  it("no telemetry exporter, no key resource, no secret value resource", () => {
    const text = tf();
    expect(text).not.toMatch(/OTEL_/);
    expect(text).not.toMatch(/google_service_account_key|google_secret_manager_secret_version/);
  });
  it("the deploy workflow owns the image: ignore_changes names it", () =>
    expect(tf()).toMatch(/ignore_changes\s*=\s*\[[^\]]*template\[0\]\.containers\[0\]\.image/));
});

describe("15 AC1 — Terraform layout and pins", () => {
  it("required_version and every provider version are exact", () => {
    const versions = readFileSync(INFRA + "versions.tf", "utf8");
    const required = /required_version\s*=\s*"([^"]+)"/.exec(versions)?.[1];
    expect(required).toMatch(/^\d+\.\d+\.\d+$/);
    const providers = [...versions.matchAll(/version\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(providers.length).toBeGreaterThanOrEqual(2);
    for (const v of providers) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("the backend is gcs and the lock file is committed", () => {
    expect(readFileSync(INFRA + "versions.tf", "utf8")).toMatch(/backend\s+"gcs"/);
    expect(existsSync(INFRA + ".terraform.lock.hcl")).toBe(true);
  });
  it.each(["infra/.terraform/x", "infra/terraform.tfstate", "infra/terraform.tfstate.backup", "infra/plan.tfplan", "infra/other.tfvars"])("%s is ignored", (path) => {
    expect(() => execFileSync("git", ["check-ignore", "-q", path], { cwd: repoRoot })).not.toThrow();
  });
  it("infra/prod.tfvars is not ignored", () => {
    expect(() => execFileSync("git", ["check-ignore", "-q", "infra/prod.tfvars"], { cwd: repoRoot })).toThrow();
  });
  it("the CI infra job runs fmt, init without a backend and validate at the exact version", () => {
    const ci = readFileSync(`${repoRoot}.github/workflows/ci.yml`, "utf8");
    const job = ci.slice(ci.indexOf("\n  infra:"));
    const required = /required_version\s*=\s*"([^"]+)"/.exec(readFileSync(INFRA + "versions.tf", "utf8"))![1]!;
    expect(job).toMatch(new RegExp(`terraform_version:\\s*"?${required.replace(/\./g, "\\.")}"?`));
    for (const cmd of ["fmt -check -recursive", "init -backend=false", "validate"]) expect(job).toContain(cmd);
  });
});

describe("15 AC6 / AC7 — the first apply works (final review)", () => {
  it("the environment attribute tolerates jobs without an environment claim", () =>
    expect(tf()).toMatch(/"attribute\.environment"\s*=\s*"has\(assertion\.environment\) \? assertion\.environment : ''"/));
  it("both providers bill API calls to the project (user ADC + the Billing Budgets API)", () => {
    const versions = readFileSync(INFRA + "versions.tf", "utf8");
    expect(versions.match(/user_project_override\s*=\s*true/g)).toHaveLength(2);
    expect(versions.match(/billing_project\s*=\s*var\.project_id/g)).toHaveLength(2);
  });
});
