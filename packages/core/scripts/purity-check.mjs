#!/usr/bin/env node
/**
 * packages/core purity check (DESIGN.md §3.4, §7).
 *
 * Fails if any source file imports React, a DOM/browser global, or a Node-only
 * builtin. Keeps `@sin/core` importable unchanged by a future React Native
 * bundle. Deliberately dependency-free so it runs anywhere.
 *
 * Usage:
 *   node scripts/purity-check.mjs            # scans ./src, exits non-zero on a violation
 *   node scripts/purity-check.mjs <dir>      # scans <dir> instead (used by the test suite)
 *
 * `findViolations(dir)` is exported so the test suite can point it at a fixture
 * tree without spawning a subprocess (Spec 02 §2 AC2).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_SRC = join(fileURLToPath(new URL("../src", import.meta.url)));

const FORBIDDEN_MODULES = [
  /^react(\/|$)/,
  /^react-dom(\/|$)/,
  /^react-native(\/|$)/,
  // Node-only builtins (with or without the node: prefix)
  /^(node:)?(fs|path|os|http|https|net|crypto|child_process|worker_threads|stream|zlib|dns|tls|cluster|process|module|vm|perf_hooks|async_hooks|readline|repl|v8)(\/|$)/,
];

const FORBIDDEN_GLOBALS = [
  /\bwindow\b/,
  /\bdocument\b/,
  /\blocalStorage\b/,
  /\bnavigator\b/,
  /\bprocess\.(env|argv|cwd)\b/,
];

const IMPORT_RE =
  /(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(full))) out.push(full);
  }
  return out;
}

/** @returns {string[]} human-readable violation lines; empty means pure. */
export function findViolations(srcDir = DEFAULT_SRC) {
  const violations = [];
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, "utf8");

    for (let m; (m = IMPORT_RE.exec(text)); ) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      if (FORBIDDEN_MODULES.some((re) => re.test(spec))) {
        violations.push(`${file}: forbidden import "${spec}"`);
      }
    }

    text.split("\n").forEach((line, i) => {
      if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
      for (const re of FORBIDDEN_GLOBALS) {
        if (re.test(line)) violations.push(`${file}:${i + 1}: forbidden global ${re}`);
      }
    });
  }
  return violations;
}

// CLI entrypoint — only when run directly, not when imported by a test.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const target = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_SRC;
  const violations = findViolations(target);
  if (violations.length > 0) {
    console.error(
      "packages/core purity check FAILED:\n" + violations.map((v) => "  " + v).join("\n"),
    );
    process.exit(1);
  }
  console.log("packages/core purity check passed.");
}
