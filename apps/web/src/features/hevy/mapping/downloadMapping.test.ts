import { describe, expect, it } from "vitest";
import { MAPPING_FILENAME, mappingCsvBlob } from "./downloadMapping";

const ID = "0192a1b2-0000-7000-8000-000000000001";

describe("20.0 AC23 — download", () => {
  it("is a UTF-8 CSV with no byte-order mark, the defaults written out when no rules are stored", async () => {
    const blob = mappingCsvBlob(
      {
        pairs: [{ hevyTemplateId: "T1", hevyTitle: "Bench Press (Barbell)", hevyType: "weight_reps", role: "exercise", exerciseId: ID, exerciseActive: true, measureRule: null, exportAs: true }],
        sectionRules: [],
      },
      (id) => (id === ID ? "Bench Press" : null),
    );
    expect(MAPPING_FILENAME).toBe("hevy-mapping.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    const text = await blob.text();
    expect(text.startsWith("kind,hevy_id,hevy_title,sin_id,sin_name,rule,export_as\r\n")).toBe(true);
    expect(text).toContain(`exercise,T1,Bench Press (Barbell),${ID},Bench Press,,yes`);
    expect(text).toContain("section,,,,Warm-up,warmup_placeholder,");
  });
});
