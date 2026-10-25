import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs module of the web package, imported by path (spec §10)
import { checkFirebaseParity } from "../../../web/scripts/lib/firebase-parity.mjs";
import { parseTfvars } from "../../../web/scripts/lib/prod-ids.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RENDER_YAML = readFileSync(join(ROOT, "render.yaml"), "utf8");
const STAGING_API = "https://si-api-ft2f.onrender.com";
const PROD_API = "https://si-api-123456789012.us-central1.run.app";
const STAGING_CSP = /name:\s*Content-Security-Policy\s*\n\s*value:\s*"([^"]+)"/.exec(RENDER_YAML.slice(RENDER_YAML.indexOf("name: si-web-staging")))![1]!;
const PROD_CSP = STAGING_CSP.split(STAGING_API).join(PROD_API);

type Rule = { source: string; headers: { key: string; value: string }[] };
function firebase(over: { csp?: string; rules?: (r: Rule[]) => Rule[]; public?: string; site?: string; rewrite?: string } = {}) {
  const base: Rule[] = [
    {
      source: "**",
      headers: [
        { key: "Content-Security-Policy", value: over.csp ?? PROD_CSP },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
      ],
    },
    { source: "/assets/**", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
  ];
  return JSON.stringify({
    hosting: {
      site: over.site ?? "sin-prod",
      public: over.public ?? "dist",
      rewrites: [{ source: "**", destination: over.rewrite ?? "/index.html" }],
      headers: over.rules ? over.rules(base) : base,
    },
  });
}
const check = (firebaseJson: string) => checkFirebaseParity({ renderYaml: RENDER_YAML, firebaseJson, prodApiOrigin: PROD_API, stagingApiOrigin: STAGING_API, siteId: "sin-prod" }) as string[];

describe("15 AC22 — checkFirebaseParity", () => {
  it("a matching pair has no problems", () => expect(check(firebase())).toEqual([]));
  it("a missing nosniff is named", () => {
    const problems = check(firebase({ rules: (r) => [{ ...r[0]!, headers: r[0]!.headers.filter((h) => h.key !== "X-Content-Type-Options") }, r[1]!] }));
    expect(problems.join("\n")).toMatch(/X-Content-Type-Options/);
  });
  it("a changed directive is named", () =>
    expect(check(firebase({ csp: PROD_CSP.replace("img-src 'self' data:", "img-src 'self' data: https:") })).join("\n")).toMatch(/img-src/));
  it("a wrong connect-src origin is named", () =>
    expect(check(firebase({ csp: PROD_CSP.split(PROD_API).join("https://evil.example") })).join("\n")).toMatch(/connect-src/));
  it("unsafe-inline is named", () =>
    expect(check(firebase({ csp: PROD_CSP.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") })).join("\n")).toMatch(/unsafe-inline/));
  it("the asset rule before the ** rule is named (Review Focus 4)", () =>
    expect(check(firebase({ rules: (r) => [r[1]!, r[0]!] })).join("\n")).toMatch(/order|after/));
  it("a wrong public dir is named", () => expect(check(firebase({ public: "build" })).join("\n")).toMatch(/public/));
  it("a wrong site id is named", () => expect(check(firebase({ site: "other" })).join("\n")).toMatch(/site/));
  it("a wrong rewrite is named", () => expect(check(firebase({ rewrite: "/404.html" })).join("\n")).toMatch(/rewrite/));
  it("a second ** Cache-Control rule is named", () =>
    expect(check(firebase({ rules: (r) => [...r, { source: "**", headers: [{ key: "Cache-Control", value: "no-store" }] }] })).join("\n")).toMatch(/Cache-Control/));
  it("unparseable JSON is a problem, not a throw", () => expect(check("{").length).toBeGreaterThan(0));
});

describe("15 AC22 / AC24 — parseTfvars", () => {
  it("reads quoted string values and ignores comments", () =>
    expect(parseTfvars('# a comment\nproject_id     = "sin-prod"\nproject_number = "123" # trailing\n')).toEqual({ project_id: "sin-prod", project_number: "123" }));
});

describe("15 AC22 — only the two Cache-Control rules (final review)", () => {
  it("a third Cache-Control rule on another source is named", () =>
    expect(check(firebase({ rules: (r) => [...r, { source: "**/*.html", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }] }] })).join("\n")).toMatch(/\*\*\/\*\.html/));
});
