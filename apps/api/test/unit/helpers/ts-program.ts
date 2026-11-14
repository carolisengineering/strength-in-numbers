// apps/api/test/unit/helpers/ts-program.ts
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * A type-checked TypeScript program over `apps/api` source, for the static guards (Spec 21.1 AC14, minor 406; the
 * query-audit tripwire, minor 393). `overlay` adds in-memory files at paths relative to `apps/api`, so a fixture
 * resolves `@prisma/client` and the repo's own modules exactly as real code does.
 */

/** The absolute `apps/api/` path, with a trailing slash. */
export const API_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** The path relative to `apps/api`. */
export const rel = (file: string): string => (file.startsWith(API_ROOT) ? file.slice(API_ROOT.length) : file);

/** Every `.ts` file under `src`, recursively, `.d.ts` excluded: absolute paths, sorted. */
export function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = `${dir}/${name}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
    }
  };
  walk(`${API_ROOT}src`);
  return out;
}

const parsedConfig = () =>
  ts.getParsedCommandLineOfConfigFile(`${API_ROOT}tsconfig.json`, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined })!;

export function apiProgram(files: readonly string[], overlay: Readonly<Record<string, string>> = {}): ts.Program {
  const options = parsedConfig().options;
  const extra = new Map(Object.entries(overlay).map(([path, text]) => [`${API_ROOT}${path}`, text]));
  const host = ts.createCompilerHost(options, true);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (f) => extra.has(f) || fileExists.call(host, f);
  host.readFile = (f) => extra.get(f) ?? readFile.call(host, f);
  host.getSourceFile = (f, lang, onError, create) => {
    const text = extra.get(f);
    return text !== undefined ? ts.createSourceFile(f, text, lang, true) : getSourceFile.call(host, f, lang, onError, create);
  };
  return ts.createProgram([...files, ...extra.keys()], options, host);
}

/** The absolute path of an overlay file, as `apiProgram` names it. */
export const overlayPath = (path: string): string => `${API_ROOT}${path}`;
