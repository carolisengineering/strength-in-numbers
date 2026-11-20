/**
 * Record lists that drop a record type this build doesn't know (Spec 07.5 Phase A, §6.8, D3).
 *
 * A new `recordType` (Phase B's `max_reps_at_weight`) is an enum member an old tab cannot ignore:
 * `@sin/core`'s `z.enum` rejects the whole response, or in production the raw body reaches
 * `recordLabel` and throws. So the web parses `records` (`GET /v1/personal-records`) and
 * `newRecords` (the workout `PATCH` response) through these wrappers, which drop only an item
 * whose `recordType` is a string outside `RECORD_TYPE_VALUES`. Everything else stays strict: a
 * missing or non-string type, or a known type with a bad field, still fails the parse. This is
 * the one exception to DESIGN §6's "no shim". A scan (`tolerantRecords.scan.test.ts`) keeps
 * every web parse of a record list routed through here.
 */
import { z } from "zod";
import { PersonalRecordsResponseSchema, RECORD_TYPE_VALUES, UpdatedWorkoutSchema } from "@sin/core";

const KNOWN_TYPES: ReadonlySet<string> = new Set(RECORD_TYPE_VALUES);

function isUnknownType(item: unknown): boolean {
  const recordType = (item as { recordType?: unknown } | null)?.recordType;
  return typeof recordType === "string" && !KNOWN_TYPES.has(recordType);
}

/** Drops the items of an array whose `recordType` is a string this build doesn't know; a non-array passes through untouched. */
export function dropUnknownRecordTypes(items: unknown): unknown {
  return Array.isArray(items) ? items.filter((item) => !isUnknownType(item)) : items;
}

function filterKey(key: string) {
  return (body: unknown): unknown => {
    if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
    const list = (body as Record<string, unknown>)[key];
    return Array.isArray(list) ? { ...body, [key]: dropUnknownRecordTypes(list) } : body;
  };
}

/** `PersonalRecordsResponseSchema` with unknown record types dropped from `records`. */
export const TolerantPersonalRecordsResponseSchema = z.preprocess(filterKey("records"), PersonalRecordsResponseSchema);

/** `UpdatedWorkoutSchema` with unknown record types dropped from `newRecords`. */
export const TolerantUpdatedWorkoutSchema = z.preprocess(filterKey("newRecords"), UpdatedWorkoutSchema);
