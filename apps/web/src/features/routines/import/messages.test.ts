import type { ImportNotice } from "@sin/core";
import { describe, expect, it } from "vitest";

import { importNoticeText } from "./messages";

describe("10.4 AC34 — overflow notices have static copy", () => {
  it.each<[ImportNotice, string]>([
    [{ code: "name-cut" }, "The routine name was cut to 80 characters."],
    [{ code: "routine-note-cut" }, "The routine note was cut to 2000 characters."],
    [{ code: "section-name-cut", count: 1 }, "A section name was cut to 40 characters."],
    [{ code: "section-name-cut", count: 3 }, "3 section names were cut to 40 characters."],
    [{ code: "section-note-cut", count: 1 }, "A section note was cut to 2000 characters."],
    [{ code: "section-note-cut", count: 2 }, "2 section notes were cut to 2000 characters."],
    [{ code: "item-note-cut", count: 1 }, "A note was cut to 500 characters."],
    [{ code: "item-note-cut", count: 4 }, "4 notes were cut to 500 characters."],
    [{ code: "sections-left-out", count: 2, names: ["Block I", "Block J"] }, "Only the first 8 sections were kept. Left out: Block I, Block J."],
    [{ code: "items-left-out", count: 1 }, "Only the first 30 exercises were kept. 1 more was left out."],
    [{ code: "items-left-out", count: 5 }, "Only the first 30 exercises were kept. 5 more were left out."],
    [{ code: "sets-cut", names: ["Strict Press"] }, "Only the first 20 sets were kept for Strict Press."],
    [{ code: "sets-cut", names: ["Strict Press", "Row"] }, "Only the first 20 sets were kept for Strict Press, Row."],
    [{ code: "superset-split", count: 1 }, "A superset of more than 8 exercises was split."],
    [{ code: "superset-split", count: 2 }, "2 supersets of more than 8 exercises were split."],
  ])("%j", (notice, text) => expect(importNoticeText(notice)).toBe(text));
});
