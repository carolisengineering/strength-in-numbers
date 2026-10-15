import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveBlob } from "./saveBlob";

describe("12 AC8 — saveBlob is DOM plumbing only", () => {
  let create: ReturnType<typeof vi.fn>;
  let revoke: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    create = vi.fn().mockReturnValue("blob:fake-1");
    revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a URL, clicks a hidden anchor with href + download, removes it, and revokes later", () => {
    const clicked: Array<{ href: string; download: string; hidden: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute("href")!, download: this.download, hidden: this.hidden });
      expect(document.body.contains(this)).toBe(true);
    });
    const blob = new Blob(["{}"]);

    saveBlob(blob, "x.json");

    expect(create).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: "blob:fake-1", download: "x.json", hidden: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:fake-1");
  });

  it("propagates a click failure, still removes the anchor and revokes", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveBlob(new Blob(["{}"]), "x.json")).toThrow("blocked");
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:fake-1");
  });
});
