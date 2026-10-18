import { describe, expect, it } from "vitest";

import { filenameFromContentDisposition as parse } from "./contentDisposition";

describe("12 AC2 — Content-Disposition filename parsing", () => {
  const cases: Array<[string, string | null | undefined, string]> = [
    ["quoted", 'attachment; filename="export-2026-10-14.json"', "export-2026-10-14.json"],
    ["unquoted", "attachment; filename=export.json", "export.json"],
    ["filename* wins over filename", `attachment; filename="ascii.json"; filename*=UTF-8''r%C3%A9sum%C3%A9.json`, "résumé.json"],
    ["filename* alone", `attachment; filename*=UTF-8''a%20b.json`, "a b.json"],
    ["undecodable filename* -> fallback", `attachment; filename="x.json"; filename*=UTF-8''%E0%A4%A.json`, "FALLBACK"],
    ["path traversal", 'attachment; filename="../../etc/passwd"', "passwd"],
    ["forward slash", 'attachment; filename="a/b.json"', "b.json"],
    ["backslash", 'attachment; filename="a\\\\b.json"', "b.json"],
    ["control characters stripped", 'attachment; filename="a\u0000b\u001f.json"', "ab.json"],
    ["leading dots and spaces stripped", 'attachment; filename="  ..hidden.json"', "hidden.json"],
    ["only dots -> fallback", 'attachment; filename=".."', "FALLBACK"],
    ["empty quoted -> fallback", 'attachment; filename=""', "FALLBACK"],
    ["no filename -> fallback", "attachment", "FALLBACK"],
    ["null -> fallback", null, "FALLBACK"],
    ["undefined -> fallback", undefined, "FALLBACK"],
    ["empty string -> fallback", "", "FALLBACK"],
  ];
  it.each(cases)("%s", (_name, header, expected) => {
    expect(parse(header, "FALLBACK")).toBe(expected);
  });

  it("defaults the fallback to 'download'", () => {
    expect(parse(null)).toBe("download");
  });

  it("caps at 120 characters and keeps the extension", () => {
    const out = parse(`attachment; filename="${"a".repeat(400)}.json"`, "FALLBACK");
    expect(out).toHaveLength(120);
    expect(out.endsWith(".json")).toBe(true);
  });

  // BL-18: the cap counts code points, so a long UTF-8 name never ends in half a surrogate pair.
  it("never splits a surrogate pair at the length cap", () => {
    for (const pad of [110, 111, 112, 113]) {
      const name = encodeURIComponent(`${"a".repeat(pad)}${"🏋️".repeat(40)}.json`);
      const out = parse(`attachment; filename*=UTF-8''${name}`, "FALLBACK");
      expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/); // no lone surrogate
      expect([...out]).toHaveLength(120);
      expect(out.endsWith(".json")).toBe(true);
    }
  });

  it("drops trailing dots and spaces, which Windows strips (so the extension stays real)", () => {
    expect(parse('attachment; filename="export.json. . "', "FALLBACK")).toBe("export.json");
    expect(parse('attachment; filename="..."', "FALLBACK")).toBe("FALLBACK");
  });

  it.each(["CON", "con.json", "PRN.txt", "AUX", "NUL.tar.gz", "COM1.json", "lpt9", "COM¹.json", "CONIN$"])(
    "falls back for the Windows reserved device name %s",
    (name) => {
      expect(parse(`attachment; filename="${name}"`, "FALLBACK")).toBe("FALLBACK");
    },
  );

  it("keeps names that only start like a reserved one", () => {
    expect(parse('attachment; filename="console.json"', "FALLBACK")).toBe("console.json");
    expect(parse('attachment; filename="COM10.json"', "FALLBACK")).toBe("COM10.json");
  });

  it("never throws on garbage", () => {
    for (const header of ['filename="', "filename*=UTF-8''", ";;;", "filename=\u0000"]) {
      expect(() => parse(header, "FALLBACK")).not.toThrow();
      expect(parse(header, "FALLBACK").length).toBeGreaterThan(0);
    }
  });
});
