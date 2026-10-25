import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".terraform") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("15 AC6 — the CI identity accepts this repository by name and numeric id (#165)", () => {
  const tfvars = readFileSync(join(repoRoot, "infra/prod.tfvars"), "utf8");
  it("prod.tfvars carries the repository's numeric id", () => expect(tfvars).toMatch(/^github_repository_id\s*=\s*"\d+"/m));
  it("the provider's attribute condition requires both", () => {
    const identity = readFileSync(join(repoRoot, "infra/identity.tf"), "utf8");
    const condition = /attribute_condition\s*=\s*"([^\n]*)"\n/.exec(identity)?.[1] ?? "";
    expect(condition).toContain("assertion.repository == '${var.github_repository}'");
    expect(condition).toContain("assertion.repository_id == '${var.github_repository_id}'");
    expect(condition).toContain("&&");
  });
});

describe("15 AC9 — hygiene scan", () => {
  it("every workflow uses: is pinned to a 40-hex commit SHA", () => {
    const unpinned = walk(join(repoRoot, ".github/workflows")).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]!).filter((u) => !u.startsWith("./") && !/@[0-9a-f]{40}$/.test(u)).map((u) => `${f}: ${u}`),
    );
    expect(unpinned).toEqual([]);
  });
  it("no npx in .github/, infra/, apps/*/scripts/ or docs/runbooks/", () => {
    const files = [".github", "infra", "apps/api/scripts", "apps/web/scripts", "docs/runbooks"].flatMap((d) => walk(join(repoRoot, d)));
    // A line that runs npx; a line warning "never npx" is the rule being taught, not broken.
    const usesNpx = (text: string) => text.split("\n").some((line) => /\bnpx\s+[a-z@]/i.test(line) && !/\bnever\b/i.test(line));
    expect(files.filter((f) => usesNpx(readFileSync(f, "utf8"))).map((f) => f.slice(repoRoot.length))).toEqual([]);
  });
  it("no tracked state, plan, stray tfvars, pem or service-account key", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(tracked.filter((f) => /\.tfstate|\.tfplan$|\.pem$/.test(f) || (f.endsWith(".tfvars") && f !== "infra/prod.tfvars"))).toEqual([]);
    const keys = tracked.filter((f) => existsSync(join(repoRoot, f)) && /"private_key"\s*:/.test(readFileSync(join(repoRoot, f), "utf8")));
    expect(keys).toEqual([]);
  });
  it("no workflow uses pull_request_target (it carries main's ref, which the image publisher trusts — #166)", () => {
    // A trigger key (`pull_request_target:` / `- pull_request_target`) or an inline `on:` form; a comment naming it is fine.
    const trigger = /^\s*(?:-\s*)?pull_request_target\b|^\s*["']?on["']?:.*\bpull_request_target\b/m;
    const uses = walk(join(repoRoot, ".github/workflows")).filter((f) => trigger.test(readFileSync(f, "utf8")));
    expect(uses.map((f) => f.slice(repoRoot.length))).toEqual([]);
  });
  it("prod.tfvars holds no secret-looking key", () => {
    const names = [...readFileSync(join(repoRoot, "infra/prod.tfvars"), "utf8").matchAll(/^\s*([a-z_0-9]+)\s*=/gim)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((n) => /secret|password|token|key/i.test(n))).toEqual([]);
  });
});
