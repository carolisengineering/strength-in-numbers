import { describe, expect, it } from "vitest";
import { sectioned } from "../../test/sectionedDraft";
import { serverIssuesFor } from "./routineErrors";

const draft = sectioned("x", ["W", "a"], ["M", "b"]);
const err = (path: string) => ({ path, message: "server text" });

describe("10.3 AC9 — server errors map to the same places", () => {
  it("sections.<j>.name / notes → that section, by the saved draft's section order", () => {
    const out = serverIssuesFor([err("sections.1.name"), err("sections.0.notes")], draft);
    expect(out.unmatched).toBe(false);
    expect(out.issues).toEqual([
      expect.objectContaining({ scope: "section", sectionKey: "M", field: "name" }),
      expect.objectContaining({ scope: "section", sectionKey: "W", field: "notes" }),
    ]);
    expect(JSON.stringify(out.issues)).not.toContain("server text"); // the app's table, never the server's text
  });

  it.each(["items.1.sectionKey", "items.1.supersetGroup", "sections.0.key", "sections", "sections.9.name"])(
    "%s names nothing on screen → unmatched (the form-level message)",
    (path) => {
      expect(serverIssuesFor([err(path)], draft)).toEqual({ issues: [], unmatched: true });
    },
  );
});
