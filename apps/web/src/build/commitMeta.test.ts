import { describe, expect, it } from "vitest";

import { COMMIT_META_NAME, commitMeta } from "./commitMeta";

const HTML =
  '<!doctype html><html><head><meta charset="UTF-8" /><title>t</title></head><body></body></html>';

function transform(commit: string | undefined): string {
  const hook = commitMeta(commit).transformIndexHtml;
  if (typeof hook !== "function") throw new Error("transformIndexHtml must be a plain function");
  return hook.call({} as never, HTML, {} as never) as string;
}

describe("AC8 — the build carries a sin-commit meta tag", () => {
  it("stamps RENDER_GIT_COMMIT into <head>", () => {
    const out = transform("0fcd1219bd1e2f3a4b5c6d7e8f9012345678abcd");
    expect(out).toContain(
      `<meta name="${COMMIT_META_NAME}" content="0fcd1219bd1e2f3a4b5c6d7e8f9012345678abcd" />`,
    );
    expect(out.indexOf("sin-commit")).toBeLessThan(out.indexOf("</head>"));
  });

  it('falls back to "dev" when the variable is unset or empty', () => {
    expect(transform(undefined)).toContain('<meta name="sin-commit" content="dev" />');
    expect(transform("")).toContain('<meta name="sin-commit" content="dev" />');
  });

  it("refuses a value that is not a hex commit, so nothing can be injected into the page", () => {
    expect(() => transform('"><script>')).toThrow(/RENDER_GIT_COMMIT/);
  });

  it("adds no script or style (the CSP stays unchanged)", () => {
    expect(transform("abc1234")).not.toMatch(/<script|<style/i);
  });
});
