import { describe, expect, it } from "vitest";

import { ApiError } from "../../../api";
import { MAPPING_OFFLINE, MAPPING_REJECTED, MAPPING_SAVE_FAILED, PAIRINGS_PATCH_FAILED } from "../messages";
import { mappingErrorMessage } from "./useMappingMutations";

const problem = (status: number, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status, type: "x", title: "x", requestId: "r", ...extra });

describe("Minor 181 — one mapping-error sentence, and a 429 says how long", () => {
  it.each([
    [problem(429, { retryAfterMs: 12_000 }), "Too many changes in a short time. Try again in 12 seconds."],
    [problem(429, { retryAfterMs: 1_000 }), "Too many changes in a short time. Try again in 1 second."],
    [problem(429), "Too many changes in a short time. Try again in a minute."],
    [problem(422, { errors: [{ path: "pairs.0.hevyTitle", message: "m" }] }), `${MAPPING_REJECTED} (pairs.0.hevyTitle)`],
    [problem(500), MAPPING_SAVE_FAILED],
    [new Error("boom"), MAPPING_SAVE_FAILED],
  ])("%#", (error, sentence) => {
    expect(mappingErrorMessage(error)).toBe(sentence);
  });

  it("offline is the network sentence; the generic one can be the caller's", () => {
    expect(mappingErrorMessage(new ApiError({ status: 0, type: "about:blank", title: "x", requestId: "r", isNetworkError: true } as never))).toBe(MAPPING_OFFLINE);
    expect(mappingErrorMessage(problem(500), PAIRINGS_PATCH_FAILED)).toBe(PAIRINGS_PATCH_FAILED);
  });
});
