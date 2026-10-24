import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { placeholderIds, prodOrigins } from "../../scripts/lib/prod-ids.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");
const tfvars = read("infra/prod.tfvars");

describe("15 AC24 — one source of production origins", () => {
  const { apiOrigin, webOrigin } = prodOrigins(tfvars);
  it("derives the deterministic Cloud Run and Hosting origins from prod.tfvars", () => {
    expect(apiOrigin).toMatch(/^https:\/\/si-api-[A-Za-z0-9_]+\.us-central1\.run\.app$/);
    expect(webOrigin).toMatch(/^https:\/\/[A-Za-z0-9_-]+\.web\.app$/);
  });
  it("firebase.json's connect-src names exactly that API origin", () => {
    const csp = (JSON.parse(read("apps/web/firebase.json")) as { hosting: { headers: { headers: { key: string; value: string }[] }[] } }).hosting.headers
      .flatMap((r) => r.headers).find((h) => h.key === "Content-Security-Policy")!.value;
    const origins = (/connect-src([^;]*)/.exec(csp)?.[1] ?? "").trim().split(/\s+/).filter((t) => t.includes(".run.app"));
    expect(origins).toEqual([apiOrigin]);
  });
  it("Terraform's WEB_ORIGIN is the Hosting origin built from the same variables", () => {
    const tf = readdirSync(`${repoRoot}infra`).filter((f) => f.endsWith(".tf")).map((f) => read(`infra/${f}`)).join("\n");
    expect(tf).toMatch(/name\s*=\s*"WEB_ORIGIN"\s*\n\s*value\s*=\s*"https:\/\/\$\{var\.hosting_site_id\}\.web\.app"/);
    expect(tf).not.toMatch(/\.web\.app"(?<!\$\{var\.hosting_site_id\}\.web\.app")/);
  });
});

describe("15 AC24 — strict mode refuses placeholders", () => {
  it("lists every REPLACE_ME value", () =>
    expect(placeholderIds('a = "REPLACE_ME_X"\nb = "ok"\nc = "REPLACE_ME_Y" # c\n')).toEqual(["a", "c"]));
  it("a filled file has none", () => expect(placeholderIds('project_id = "sin-prod"\n')).toEqual([]));
});

describe("15 AC24 — the runbook's Part F variable table derives every origin from Terraform", () => {
  const runbook = read("docs/runbooks/first-deploy.md");
  const partF = runbook.slice(runbook.indexOf("## Part F"), runbook.indexOf("## Done when"));
  const row = (name: string) => partF.split("\n").find((l) => l.startsWith(`| \`${name}\``)) ?? "";
  it("the origin variables point at the right terraform outputs", () => {
    expect(row("PROD_API_BASE_URL")).toContain("output -raw api_origin");
    expect(row("VITE_API_BASE_URL")).toContain("output -raw api_origin");
    expect(row("PROD_WEB_BASE_URL")).toContain("output -raw web_origin");
  });
  it("Part F names no literal production origin (only <placeholder> forms)", () => {
    const literals = [...partF.matchAll(/https:\/\/[^\s`'")|]+\.(?:run\.app|web\.app)/g)].map((m) => m[0]).filter((o) => !o.includes("<"));
    expect(literals).toEqual([]);
  });
});
