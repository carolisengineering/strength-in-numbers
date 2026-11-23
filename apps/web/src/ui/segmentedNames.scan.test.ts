import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("minors 444, 493 — a Segmented's radio name is never a fixed string", () => {
  it("every <Segmented …> passes a name built from useId (or a prefix that is), so two mounted strips never share a group", () => {
    const fixed: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, "utf8");
      for (let at = text.indexOf("<Segmented"); at >= 0; at = text.indexOf("<Segmented", at + 1)) {
        const tag = text.slice(at, text.indexOf("/>", at));
        if (/\bname="/.test(tag)) fixed.push(`${relative(SRC, file)}: ${/\bname="[^"]*"/.exec(tag)![0]}`);
      }
    }
    expect(fixed).toEqual([]);
  });
});
