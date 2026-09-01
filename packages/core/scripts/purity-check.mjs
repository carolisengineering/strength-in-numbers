#!/usr/bin/env node
/**
 * packages/core purity check (DESIGN.md §3.4, §7).
 *
 * Fails if any source file imports React, a DOM/browser global, or a Node-only
 * builtin. Keeps `@sin/core` importable unchanged by a future React Native
 * bundle. Deliberately dependency-free so it runs anywhere.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL("../src", import.meta.url)));

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

const violations = [];
for (const file of walk(SRC)) {
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

if (violations.length > 0) {
  console.error("packages/core purity check FAILED:\n" + violations.map((v) => "  " + v).join("\n"));
  process.exit(1);
}
console.log("packages/core purity check passed.");
