import { formatMappingCsv, mappingToCsvLines, type HevyMapping } from "@sin/core";

/** Spec 20.0 AC23: the file the mapping downloads as, and loads back from. */
export const MAPPING_FILENAME = "hevy-mapping.csv";

/**
 * The mapping as 19.0's file (AC14): RFC 4180, CRLF, UTF-8 with no byte-order mark, the effective section rules
 * written out (the defaults under the user's own), so loading it back changes nothing.
 */
export function mappingCsvBlob(mapping: HevyMapping, sinNameOf: (exerciseId: string) => string | null): Blob {
  return new Blob([formatMappingCsv(mappingToCsvLines(mapping, sinNameOf))], { type: "text/csv;charset=utf-8" });
}
