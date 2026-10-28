/**
 * Spec 15 AC23 — the web smoke's checks (pure apart from reading the repo's hosting config). Each check returns
 * null when ok, else the failure message.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The CSP the live site must send: `render.yaml`'s si-web-staging block, or `apps/web/firebase.json`. */
export function expectedCspFrom(host, repoRoot) {
  if (host === "firebase") {
    const config = JSON.parse(readFileSync(join(repoRoot, "apps/web/firebase.json"), "utf8"));
    for (const rule of config?.hosting?.headers ?? []) {
      const csp = (rule.headers ?? []).find((h) => h.key === "Content-Security-Policy");
      if (csp) return csp.value;
    }
    throw new Error("no Content-Security-Policy in apps/web/firebase.json");
  }
  const yaml = readFileSync(join(repoRoot, "render.yaml"), "utf8");
  const block = yaml.slice(yaml.indexOf("name: si-web-staging"));
  const m = block.match(/name:\s*Content-Security-Policy\s*\n\s*value:\s*"([^"]+)"/);
  if (!m) throw new Error("could not read the expected CSP from render.yaml");
  return m[1];
}

/** Directive order and spacing don't matter. */
export function normalizeCsp(value) {
  return (value ?? "")
    .split(";")
    .map((d) => d.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort()
    .join("; ");
}

/** `/` revalidates (no positive max-age); `/assets` is immutable for a year. */
export function checkCacheControl(path, value) {
  const v = (value ?? "").toLowerCase();
  if (path === "/assets") {
    return v.includes("immutable") && /max-age=31536000\b/.test(v) ? null : `/assets Cache-Control "${value ?? ""}" is not immutable for a year`;
  }
  const maxAge = v.match(/max-age=(\d+)/);
  const revalidates = v.includes("no-cache") || v.includes("must-revalidate");
  return revalidates && (!maxAge || Number(maxAge[1]) === 0) ? null : `/ Cache-Control "${value ?? ""}" does not revalidate`;
}

/** Spec 20.0 §11: the live CSP's `connect-src` must name Hevy's API, or the browser's Hevy client is blocked. */
export function checkHevyOrigin(csp) {
  const connect = ((csp ?? "").match(/connect-src ([^;]+)/) ?? ["", ""])[1].trim().split(/\s+/);
  return connect.includes("https://api.hevyapp.com") ? null : "the CSP's connect-src does not allow https://api.hevyapp.com";
}

/** `<meta name="sin-commit">` must equal the expected commit when one is given. */
export function checkCommitMeta(html, expect) {
  if (!expect) return null;
  const m = html.match(/<meta name="sin-commit" content="([^"]*)"/);
  if (!m) return `no sin-commit meta (expected ${expect})`;
  return m[1] === expect ? null : `sin-commit is ${m[1]}, expected ${expect}`;
}
