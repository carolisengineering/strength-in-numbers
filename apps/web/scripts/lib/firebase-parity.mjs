/**
 * Spec 15 AC22 — `apps/web/firebase.json` must send what `render.yaml`'s si-web-staging block sends, with only
 * the API origin changed (pure: file contents in, a list of problems out, empty when they agree). Text-based,
 * like `assert-render-yaml.mjs`: the YAML is authored here, so a line-oriented read is unambiguous.
 */

/** Render path → Firebase glob. */
const GLOB = { "/*": "**", "/assets/*": "/assets/**" };
const REVALIDATE = "public, max-age=0, must-revalidate";
const RELAXATIONS = ["unsafe-inline", "unsafe-eval", "blob:"];

/** The si-web-staging `headers:` entries as `{ path, name, value }`. */
function renderHeaders(renderYaml) {
  const block = renderYaml.slice(renderYaml.indexOf("name: si-web-staging"));
  const end = block.search(/\n\S/); // the next top-level key ends the block
  const text = end === -1 ? block : block.slice(0, end);
  const headers = [];
  const re = /-\s*path:\s*(\S+)\s*\n\s*name:\s*(\S+)\s*\n\s*value:\s*(?:"([^"]*)"|(.+))/g;
  for (const m of text.matchAll(re)) headers.push({ path: m[1], name: m[2], value: (m[3] ?? m[4]).trim() });
  return headers;
}

function directives(csp) {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .map((d) => [d.split(" ")[0], d]),
  );
}

export function checkFirebaseParity({ renderYaml, firebaseJson, prodApiOrigin, stagingApiOrigin, siteId }) {
  const problems = [];
  let hosting;
  try {
    hosting = JSON.parse(firebaseJson).hosting;
  } catch (error) {
    return [`firebase.json does not parse: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!hosting || typeof hosting !== "object") return ["firebase.json has no hosting block"];

  if (hosting.public !== "dist") problems.push(`hosting.public is ${JSON.stringify(hosting.public)}, expected "dist"`);
  if (hosting.site !== siteId) problems.push(`hosting.site is ${JSON.stringify(hosting.site)}, expected the tfvars site id ${JSON.stringify(siteId)}`);
  const rewrites = Array.isArray(hosting.rewrites) ? hosting.rewrites : [];
  if (rewrites.length !== 1 || rewrites[0].source !== "**" || rewrites[0].destination !== "/index.html") {
    problems.push(`the rewrite must be exactly ** → /index.html (got ${JSON.stringify(rewrites)})`);
  }

  const rules = Array.isArray(hosting.headers) ? hosting.headers : [];
  /** Every (glob, header) pair Firebase would send, in rule order. */
  const sent = rules.flatMap((rule, index) => (Array.isArray(rule.headers) ? rule.headers : []).map((h) => ({ index, source: rule.source, key: h.key, value: h.value })));
  const find = (source, key) => sent.filter((h) => h.source === source && h.key === key);

  for (const expected of renderHeaders(renderYaml)) {
    const source = GLOB[expected.path] ?? expected.path;
    const got = find(source, expected.name);
    if (got.length !== 1) {
      problems.push(`${expected.name} on ${source}: expected exactly one, found ${got.length}`);
      continue;
    }
    if (expected.name !== "Content-Security-Policy") {
      if (got[0].value !== expected.value) problems.push(`${expected.name} on ${source} is "${got[0].value}", expected "${expected.value}"`);
      continue;
    }
    const want = directives(expected.value.split(stagingApiOrigin).join(prodApiOrigin));
    const have = directives(got[0].value);
    for (const [name, value] of want) if (have.get(name) !== value) problems.push(`CSP directive ${name} is "${have.get(name) ?? "(missing)"}", expected "${value}"`);
    for (const name of have.keys()) if (!want.has(name)) problems.push(`CSP directive ${name} is not in render.yaml`);
    const auth0 = (directives(expected.value).get("connect-src") ?? "").split(" ").find((t) => t.startsWith("https://") && t !== stagingApiOrigin);
    const connect = (have.get("connect-src") ?? "").split(" ").slice(1).sort().join(" ");
    const wantConnect = ["'self'", prodApiOrigin, auth0].sort().join(" ");
    if (connect !== wantConnect) problems.push(`connect-src names ${connect || "(nothing)"}, expected exactly ${wantConnect}`);
  }

  const allValues = sent.map((h) => String(h.value)).join(" ");
  for (const bad of RELAXATIONS) if (allValues.includes(bad)) problems.push(`${bad} appears in a header`);

  // D10: everything but the hashed assets revalidates, so a phone never keeps an old index.html.
  const revalidate = find("**", "Cache-Control");
  if (revalidate.length !== 1 || revalidate[0].value !== REVALIDATE) {
    problems.push(`** needs exactly one Cache-Control "${REVALIDATE}" (found ${revalidate.map((h) => `"${h.value}"`).join(", ") || "none"})`);
  }
  // Only the two Cache-Control rules exist (Review Focus 4): no other source may set it.
  for (const h of sent) {
    if (h.key === "Cache-Control" && h.source !== "**" && h.source !== "/assets/**") problems.push(`Cache-Control on ${h.source} is not allowed (only ** and /assets/**)`);
  }
  // Review Focus 4: the more specific /assets/** rule comes after **, so it is the one that applies to assets.
  const assets = find("/assets/**", "Cache-Control");
  if (revalidate.length > 0 && assets.length > 0 && assets[0].index < revalidate[0].index) {
    problems.push("the /assets/** Cache-Control rule must come after the ** rule (order)");
  }
  return problems;
}
