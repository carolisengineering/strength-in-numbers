/**
 * Spec 21.0 AC18–AC20, AC28 — `pnpm --filter @sin/api run audit:queries` checks `docs/security/query-audit.md`
 * against every SQL statement in `apps/api/src` and exits 1 on any difference; `--write` rewrites the document:
 * fingerprints refreshed, classifications kept, changed and new rows marked `needs review`.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { UNSAFE_ALLOWLIST, checkAudit, extractStatements, parseAudit, writeAudit, type Source } from "./lib/query-extract.js";

export const API_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const AUDIT_PATH = join(API_ROOT, "..", "..", "docs", "security", "query-audit.md");

/** Every `.ts` file under `apps/api/src`, keyed relative to `apps/api`, in a stable order. */
export function readSources(): Source[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) files.push(p);
    }
  };
  walk(join(API_ROOT, "src"));
  return files.map((p) => ({ file: relative(API_ROOT, p).split("\\").join("/"), text: readFileSync(p, "utf8") }));
}

function main(): void {
  const extracted = extractStatements(readSources());
  const existing = existsSync(AUDIT_PATH) ? parseAudit(readFileSync(AUDIT_PATH, "utf8")) : [];
  if (process.argv.includes("--write")) {
    mkdirSync(dirname(AUDIT_PATH), { recursive: true });
    writeFileSync(AUDIT_PATH, writeAudit(existing, extracted));
    process.stdout.write(`wrote ${relative(process.cwd(), AUDIT_PATH)}: ${extracted.length} statements\n`);
    return;
  }
  const failures = checkAudit(extracted, existing, UNSAFE_ALLOWLIST);
  if (failures.length === 0) {
    process.stdout.write(`query audit: ${extracted.length} statements, all classified and current\n`);
    return;
  }
  console.error(`query audit: ${failures.length} problem(s)\n${failures.join("\n")}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
