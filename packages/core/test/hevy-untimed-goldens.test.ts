// Spec 09.5 AC26 / AC29(a): the snapshots below were written ONCE from the code before Phase C. Never run
// `vitest -u` on this file: a diff here is a regression in an untimed workout's Hevy body or fingerprint.
import { describe, expect, it } from "vitest";
import { buildHevyWorkout, hevyFingerprintSource } from "../src/index.js";
import { identityRoot } from "./fixtures/hevy/workout-detail.js";
import { UNTIMED_FIXTURES } from "./fixtures/hevy/untimed-fixtures.js";

const row = (label: string) => UNTIMED_FIXTURES.find(([l]) => l === label)!;
const bodyOf = (label: string) => {
  const [, d, mapping] = row(label);
  return JSON.stringify(buildHevyWorkout(d(), mapping(), { rootOf: identityRoot }));
};
const sourceOf = (label: string) => hevyFingerprintSource(row(label)[1]());

describe("09.5 AC26 / AC29(a) — untimed output is byte-identical to 19.0's", () => {
  it("covers every fixture row", () => {
    expect(UNTIMED_FIXTURES.map(([l]) => l)).toMatchInlineSnapshot(`
      [
        "no sections",
        "Warm-up with a note",
        "Accessory with a note plus an exercise note",
        "a named section with a note",
        "a named section split into two runs",
        "the markerless mapping with Warm-up and a named section",
        "a user rule notes_on_first",
        "an empty section",
        "a superset across a section boundary",
      ]
    `);
  });

  it("no sections", () => {
    expect(bodyOf("no sections")).toMatchInlineSnapshot(`"{"ok":true,"notices":[],"body":{"workout":{"title":"Push","description":"Felt strong","start_time":"2026-10-01T15:00:00.000Z","end_time":"2026-10-01T16:00:00.000Z","is_private":true,"exercises":[{"exercise_template_id":"T0","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]},{"exercise_template_id":"T1","superset_id":null,"notes":"slow","sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]}]}}}"`);
    expect(sourceOf("no sections")).toMatchInlineSnapshot(`"v1["Push","Felt strong","2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[],[[0,"00000000-0000-4000-8000-000000001000",null,null,-1,[["working",5,60,null,null,null,null]]],[1,"00000000-0000-4000-8000-000000001001","slow",null,-1,[["working",5,60,null,null,null,null]]]]]"`);
  });

  it("Warm-up with a note", () => {
    expect(bodyOf("Warm-up with a note")).toMatchInlineSnapshot(`"{"ok":true,"notices":[],"body":{"workout":{"title":"Push","description":null,"start_time":"2026-10-01T15:00:00.000Z","end_time":"2026-10-01T16:00:00.000Z","is_private":true,"exercises":[{"exercise_template_id":"WARM","superset_id":null,"notes":"Easy","sets":[]},{"exercise_template_id":"T0","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]},{"exercise_template_id":"T1","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]}]}}}"`);
    expect(sourceOf("Warm-up with a note")).toMatchInlineSnapshot(`"v1["Push",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Warm-up","Easy",0]],[[0,"00000000-0000-4000-8000-000000001000",null,null,0,[["working",5,60,null,null,null,null]]],[1,"00000000-0000-4000-8000-000000001001",null,null,-1,[["working",5,60,null,null,null,null]]]]]"`);
  });

  it("Accessory with a note plus an exercise note", () => {
    expect(bodyOf("Accessory with a note plus an exercise note")).toMatchInlineSnapshot(`"{"ok":true,"notices":[],"body":{"workout":{"title":"Push","description":null,"start_time":"2026-10-01T15:00:00.000Z","end_time":"2026-10-01T16:00:00.000Z","is_private":true,"exercises":[{"exercise_template_id":"T0","superset_id":null,"notes":"light\\n\\nex","sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]},{"exercise_template_id":"T1","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]}]}}}"`);
    expect(sourceOf("Accessory with a note plus an exercise note")).toMatchInlineSnapshot(`"v1["Push",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Accessory","light",0]],[[0,"00000000-0000-4000-8000-000000001000","ex",null,0,[["working",5,60,null,null,null,null]]],[1,"00000000-0000-4000-8000-000000001001",null,null,0,[["working",5,60,null,null,null,null]]]]]"`);
  });

  it("a named section with a note", () => {
    expect(bodyOf("a named section with a note")).toMatchInlineSnapshot(`"{"ok":true,"notices":[],"body":{"workout":{"title":"Push","description":null,"start_time":"2026-10-01T15:00:00.000Z","end_time":"2026-10-01T16:00:00.000Z","is_private":true,"exercises":[{"exercise_template_id":"T0","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]},{"exercise_template_id":"WORK","superset_id":null,"notes":"Finisher\\nfast","sets":[]},{"exercise_template_id":"T1","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]}]}}}"`);
    expect(sourceOf("a named section with a note")).toMatchInlineSnapshot(`"v1["Push",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Finisher","fast",0]],[[0,"00000000-0000-4000-8000-000000001000",null,null,-1,[["working",5,60,null,null,null,null]]],[1,"00000000-0000-4000-8000-000000001001",null,null,0,[["working",5,60,null,null,null,null]]]]]"`);
  });

  it("a named section split into two runs", () => {
    expect(bodyOf("a named section split into two runs")).toMatchInlineSnapshot(`"{"ok":true,"notices":[],"body":{"workout":{"title":"Push","description":null,"start_time":"2026-10-01T15:00:00.000Z","end_time":"2026-10-01T16:00:00.000Z","is_private":true,"exercises":[{"exercise_template_id":"WORK","superset_id":null,"notes":"Main\\nRx","sets":[]},{"exercise_template_id":"T0","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]},{"exercise_template_id":"T1","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]},{"exercise_template_id":"WORK","superset_id":null,"notes":"Main\\nRx","sets":[]},{"exercise_template_id":"T2","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]}]}}}"`);
    expect(sourceOf("a named section split into two runs")).toMatchInlineSnapshot(`"v1["Push",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Main","Rx",0]],[[0,"00000000-0000-4000-8000-000000001000",null,null,0,[["working",5,60,null,null,null,null]]],[1,"00000000-0000-4000-8000-000000001001",null,null,-1,[["working",5,60,null,null,null,null]]],[2,"00000000-0000-4000-8000-000000001002",null,null,0,[["working",5,60,null,null,null,null]]]]]"`);
  });

  it("the markerless mapping with Warm-up and a named section", () => {
    expect(bodyOf("the markerless mapping with Warm-up and a named section")).toMatchInlineSnapshot(`"{"ok":true,"notices":[{"code":"section_no_placeholder","count":2,"names":["Warm-up","Main"]}],"body":{"workout":{"title":"Push","description":null,"start_time":"2026-10-01T15:00:00.000Z","end_time":"2026-10-01T16:00:00.000Z","is_private":true,"exercises":[{"exercise_template_id":"T0","superset_id":null,"notes":"Warm-up\\nEasy\\n\\nex","sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]},{"exercise_template_id":"T1","superset_id":null,"notes":"Main\\nRx","sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]},{"exercise_template_id":"T2","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]}]}}}"`);
    expect(sourceOf("the markerless mapping with Warm-up and a named section")).toMatchInlineSnapshot(`"v1["Push",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Warm-up","Easy",0],["Main","Rx",1]],[[0,"00000000-0000-4000-8000-000000001000","ex",null,0,[["working",5,60,null,null,null,null]]],[1,"00000000-0000-4000-8000-000000001001",null,null,1,[["working",5,60,null,null,null,null]]],[2,"00000000-0000-4000-8000-000000001002",null,null,1,[["working",5,60,null,null,null,null]]]]]"`);
  });

  it("a user rule notes_on_first", () => {
    expect(bodyOf("a user rule notes_on_first")).toMatchInlineSnapshot(`"{"ok":true,"notices":[],"body":{"workout":{"title":"Push","description":null,"start_time":"2026-10-01T15:00:00.000Z","end_time":"2026-10-01T16:00:00.000Z","is_private":true,"exercises":[{"exercise_template_id":"T0","superset_id":null,"notes":"fast\\n\\nex","sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]}]}}}"`);
    expect(sourceOf("a user rule notes_on_first")).toMatchInlineSnapshot(`"v1["Push",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Finisher","fast",0]],[[0,"00000000-0000-4000-8000-000000001000","ex",null,0,[["working",5,60,null,null,null,null]]]]]"`);
  });

  it("an empty section", () => {
    expect(bodyOf("an empty section")).toMatchInlineSnapshot(`"{"ok":true,"notices":[],"body":{"workout":{"title":"Push","description":null,"start_time":"2026-10-01T15:00:00.000Z","end_time":"2026-10-01T16:00:00.000Z","is_private":true,"exercises":[{"exercise_template_id":"T0","superset_id":null,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]}]}}}"`);
    expect(sourceOf("an empty section")).toMatchInlineSnapshot(`"v1["Push",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Cooldown","stretch",0]],[[0,"00000000-0000-4000-8000-000000001000",null,null,-1,[["working",5,60,null,null,null,null]]]]]"`);
  });

  it("a superset across a section boundary", () => {
    expect(bodyOf("a superset across a section boundary")).toMatchInlineSnapshot(`"{"ok":true,"notices":[],"body":{"workout":{"title":"Push","description":null,"start_time":"2026-10-01T15:00:00.000Z","end_time":"2026-10-01T16:00:00.000Z","is_private":true,"exercises":[{"exercise_template_id":"WARM","superset_id":null,"notes":null,"sets":[]},{"exercise_template_id":"T0","superset_id":0,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]},{"exercise_template_id":"T1","superset_id":0,"notes":null,"sets":[{"type":"normal","weight_kg":60,"reps":5,"rpe":null}]}]}}}"`);
    expect(sourceOf("a superset across a section boundary")).toMatchInlineSnapshot(`"v1["Push",null,"2026-10-01T10:00:00.000-05:00","2026-10-01T11:00:00.000-05:00",null,[["Warm-up",null,0]],[[0,"00000000-0000-4000-8000-000000001000",null,1,0,[["working",5,60,null,null,null,null]]],[1,"00000000-0000-4000-8000-000000001001",null,1,-1,[["working",5,60,null,null,null,null]]]]]"`);
  });
});
