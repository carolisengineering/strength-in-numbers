// Fake API data for the screenshot harness. Every payload is validated against the real
// @sin/core response schemas in the browser before capture (payloadChecks), so the SPA's strict local-env parse accepts it.
const TZ = "America/Chicago";

const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER_ID = uuid("a0000000", 1);

const NOW = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

function tzOffsetMinutes(ms) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" }).formatToParts(new Date(ms));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}
function localDate(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export const me = {
  id: USER_ID,
  email: "carol@example.com",
  displayName: "Carol",
  unitPreference: "kg",
  timezone: TZ,
  createdAt: iso(NOW - 120 * DAY),
};

export const muscleGroups = [
  ["quads", "Quadriceps"], ["hamstrings", "Hamstrings"], ["glutes", "Glutes"], ["chest", "Chest"],
  ["back", "Back"], ["lats", "Lats"], ["shoulders", "Shoulders"], ["biceps", "Biceps"],
  ["triceps", "Triceps"], ["core", "Core"], ["cardio", "Cardio"],
].map(([id, name], i) => ({ id, name, displayOrder: i + 1 }));

export const equipment = [
  ["barbell", "Barbell"], ["dumbbell", "Dumbbell"], ["machine", "Machine"], ["cable", "Cable"],
  ["bodyweight", "Bodyweight"], ["rower", "Rowing machine"],
].map(([id, name], i) => ({ id, name, displayOrder: i + 1 }));

const EX = [
  ["back_squat", "Back Squat", "weight_reps", "quads", ["glutes", "hamstrings"], "barbell"],
  ["bench_press", "Bench Press", "weight_reps", "chest", ["triceps", "shoulders"], "barbell"],
  ["deadlift", "Deadlift", "weight_reps", "hamstrings", ["glutes", "back"], "barbell"],
  ["overhead_press", "Overhead Press", "weight_reps", "shoulders", ["triceps"], "barbell"],
  ["barbell_row", "Barbell Row", "weight_reps", "back", ["lats", "biceps"], "barbell"],
  ["pull_up", "Pull-up", "bodyweight_reps", "lats", ["biceps"], "bodyweight"],
  ["romanian_deadlift", "Romanian Deadlift", "weight_reps", "hamstrings", ["glutes"], "barbell"],
  ["incline_db_press", "Incline Dumbbell Press", "weight_reps", "chest", ["shoulders"], "dumbbell"],
  ["lat_pulldown", "Lat Pulldown", "weight_reps", "lats", ["biceps"], "cable"],
  ["leg_press", "Leg Press", "weight_reps", "quads", ["glutes"], "machine"],
  ["lateral_raise", "Dumbbell Lateral Raise", "weight_reps", "shoulders", [], "dumbbell"],
  ["barbell_curl", "Barbell Curl", "weight_reps", "biceps", [], "barbell"],
  ["triceps_pushdown", "Triceps Pushdown", "weight_reps", "triceps", [], "cable"],
  ["weighted_dip", "Weighted Dip", "weighted_bodyweight", "triceps", ["chest"], "bodyweight"],
  ["plank", "Plank", "duration", "core", [], "bodyweight"],
  ["row_erg", "Rowing Machine", "distance_duration", "cardio", ["back"], "rower"],
];

export const exercises = EX.map(([key, name, modality, primary, secondary, equip], i) => ({
  id: uuid("e0000000", i + 1),
  catalogKey: key,
  ownerUserId: null,
  name,
  modality,
  primaryMuscleId: primary,
  secondaryMuscleIds: secondary,
  equipmentId: equip,
  isActive: true,
  forkedFromExerciseId: null,
  createdAt: iso(NOW - 200 * DAY),
  updatedAt: iso(NOW - 200 * DAY),
}));
const exByKey = Object.fromEntries(exercises.map((e) => [e.catalogKey, e]));

// ---------------------------------------------------------------- routines
const ps = (setType, repsLow, repsHigh, weight) => ({
  setType, repsLow, repsHigh, weight, weightUnit: weight === null ? null : "kg",
});
let itemN = 0;
function item(key, position, o = {}) {
  const sets = o.sets ?? [];
  const working = sets.filter((s) => s.setType === "working");
  const lows = working.map((s) => s.repsLow).filter((x) => x !== null);
  const highs = working.map((s) => s.repsHigh).filter((x) => x !== null);
  return {
    id: uuid("b1000000", ++itemN),
    position,
    exerciseId: exByKey[key].id,
    targetSets: o.targetSets ?? (sets.length ? working.length || null : null),
    targetRepsLow: o.targetRepsLow ?? (lows.length ? Math.min(...lows) : null),
    targetRepsHigh: o.targetRepsHigh ?? (highs.length ? Math.max(...highs) : null),
    targetRpe: o.targetRpe ?? null,
    restSeconds: o.restSeconds ?? null,
    supersetGroup: o.supersetGroup ?? null,
    notes: o.notes ?? null,
    sets,
    sectionId: o.sectionId ?? null,
  };
}
const rep = (n, row) => Array.from({ length: n }, () => ({ ...row }));

const PUSH_ID = uuid("b0000000", 1);
const LOWER_ID = uuid("b0000000", 2);
const PULL_ID = uuid("b0000000", 3);
const SEC_MAIN = uuid("b2000000", 1);
const SEC_ACC = uuid("b2000000", 2);

export const routines = [
  {
    id: PUSH_ID,
    name: "Push Day",
    notes: "Keep rest short on the accessories. Add 2.5 kg to bench when all working sets hit 5.",
    sections: [
      { id: SEC_MAIN, position: 0, name: "Main lifts", notes: "Full warm-up before the first working set." },
      { id: SEC_ACC, position: 1, name: "Accessories", notes: null },
    ],
    items: [
      item("bench_press", 0, {
        sectionId: SEC_MAIN, restSeconds: 180, targetRpe: 8,
        notes: "Pause the first rep of each working set.",
        sets: [ps("warmup", 8, 8, 40), ps("warmup", 5, 5, 60), ...rep(3, ps("working", 5, 5, 82.5))],
      }),
      item("overhead_press", 1, {
        sectionId: SEC_MAIN, restSeconds: 150,
        sets: [ps("warmup", 5, 5, 30), ...rep(3, ps("working", 6, 8, 47.5))],
      }),
      item("incline_db_press", 2, { sectionId: SEC_ACC, supersetGroup: 1, restSeconds: 90, sets: rep(3, ps("working", 8, 12, 26)) }),
      item("lateral_raise", 3, { sectionId: SEC_ACC, supersetGroup: 1, restSeconds: 90, sets: rep(3, ps("working", 12, 15, 10)) }),
      item("triceps_pushdown", 4, { sectionId: SEC_ACC, supersetGroup: 2, sets: rep(3, ps("working", 10, 12, 32.5)) }),
      item("weighted_dip", 5, { sectionId: SEC_ACC, supersetGroup: 2, sets: rep(3, ps("working", 6, 10, 10)) }),
    ],
    createdAt: iso(NOW - 60 * DAY),
    updatedAt: iso(NOW - 3 * DAY),
  },
  {
    id: LOWER_ID,
    name: "Lower A",
    notes: null,
    sections: [],
    items: [
      item("back_squat", 0, { restSeconds: 180, sets: rep(5, ps("working", 5, 5, null)) }),
      item("romanian_deadlift", 1, { restSeconds: 120, sets: rep(3, ps("working", 8, 10, null)) }),
      item("leg_press", 2, { sets: rep(3, ps("working", 10, 12, null)) }),
      item("plank", 3, { targetSets: 3, sets: rep(3, ps("working", null, null, null)), notes: "45–60 s holds" }),
    ],
    createdAt: iso(NOW - 58 * DAY),
    updatedAt: iso(NOW - 58 * DAY),
  },
  {
    id: PULL_ID,
    name: "Pull Day",
    notes: "Straps allowed on the last deadlift set only.",
    sections: [],
    items: [
      item("deadlift", 0, { restSeconds: 240, targetRpe: 8.5, sets: [ps("warmup", 5, 5, 100), ...rep(3, ps("working", 3, 5, 150))] }),
      item("pull_up", 1, { sets: rep(4, ps("working", 6, 10, null)) }),
      item("barbell_row", 2, { supersetGroup: 1, sets: rep(3, ps("working", 8, 10, 70)) }),
      item("lat_pulldown", 3, { supersetGroup: 1, sets: rep(3, ps("working", 10, 12, 60)) }),
      item("barbell_curl", 4, { targetSets: 3, targetRepsLow: 10, targetRepsHigh: 12, sets: rep(3, ps("working", 10, 12, null)) }),
    ],
    createdAt: iso(NOW - 55 * DAY),
    updatedAt: iso(NOW - 10 * DAY),
  },
];

// ---------------------------------------------------------------- workouts
let weN = 0;
let setN = 0;
let cgN = 0;

function makeSet(weId, setNumber, ex, s, completedMs) {
  const w = s.weight ?? null;
  return {
    id: uuid("d0000000", ++setN),
    workoutExerciseId: weId,
    clientGeneratedId: uuid("c1000000", ++cgN),
    setNumber,
    setType: s.type ?? "working",
    reps: s.reps ?? null,
    weight: w,
    weightUnit: w === null ? null : "kg",
    weightKg: w,
    distance: s.distance ?? null,
    distanceUnit: s.distance != null ? "m" : null,
    distanceM: s.distance ?? null,
    durationS: s.durationS ?? null,
    rpe: s.rpe ?? null,
    isComplete: true,
    completedAt: iso(completedMs),
    createdAt: iso(completedMs),
    updatedAt: iso(completedMs),
  };
}

/** exs: [{ key, sets: [{reps, weight, type?, rpe?}], superset?, sectionId?, routineItem? , notes? }] */
function makeWorkout(n, startMs, durationMin, exs, opts = {}) {
  const id = uuid("f0000000", n);
  let t = startMs + 4 * MIN;
  const exercisesOut = exs.map((e, position) => {
    const ex = exByKey[e.key];
    const weId = uuid("f1000000", ++weN);
    const ri = e.routineItem ?? null;
    const sets = e.sets.map((s, i) => {
      t += 2.5 * MIN;
      return makeSet(weId, i + 1, ex, s, t);
    });
    return {
      id: weId,
      workoutId: id,
      position,
      exerciseId: ex.id,
      exerciseNameSnapshot: ex.name,
      modalitySnapshot: ex.modality,
      notes: e.notes ?? ri?.notes ?? null,
      createdAt: iso(startMs + position * MIN),
      updatedAt: iso(startMs + position * MIN),
      targetSets: ri?.targetSets ?? null,
      targetRepsLow: ri?.targetRepsLow ?? null,
      targetRepsHigh: ri?.targetRepsHigh ?? null,
      targetRpe: ri?.targetRpe ?? null,
      restSeconds: ri?.restSeconds ?? null,
      supersetGroup: e.superset ?? ri?.supersetGroup ?? null,
      plannedSets: ri?.sets ?? [],
      sectionId: e.sectionId ?? null,
      sets,
    };
  });
  return {
    id,
    title: opts.title ?? null,
    notes: opts.notes ?? null,
    startedAt: iso(startMs),
    endedAt: opts.active ? null : iso(startMs + durationMin * MIN),
    localDate: localDate(startMs),
    tzOffsetMinutes: tzOffsetMinutes(startMs),
    clientGeneratedId: uuid("c0000000", n),
    source: "manual",
    createdAt: iso(startMs),
    updatedAt: iso(startMs + durationMin * MIN),
    routineName: opts.routine?.name ?? null,
    routineNotes: opts.routine?.notes ?? null,
    sections: opts.sections ?? [],
    exercises: exercisesOut,
  };
}

const W = (reps, weight, extra = {}) => ({ reps, weight, ...extra });
const WU = (reps, weight) => ({ reps, weight, type: "warmup" });
const BW = (reps) => ({ reps, weight: null });

// Day offsets back from today at ~6pm local; progressive loading.
const at = (daysAgo, hour = 18) => {
  const d = new Date(NOW - daysAgo * DAY);
  d.setUTCHours(hour + 5, 10, 0, 0); // ~local evening in Chicago (CDT = UTC-5)
  return d.getTime();
};

const [push, lower, pull] = routines;
const pushItems = push.items;
const pullItems = pull.items;
const lowerItems = lower.items;

function pushSession(n, daysAgo, bench, ohp, incline, lat, push2 = true) {
  const sm = uuid("f3000000", n * 10 + 1), sa = uuid("f3000000", n * 10 + 2);
  return makeWorkout(n, at(daysAgo), 68, [
    { key: "bench_press", sectionId: sm, routineItem: pushItems[0], sets: [WU(8, 40), WU(5, 60), W(5, bench), W(5, bench), W(5, bench, { rpe: 8.5 })] },
    { key: "overhead_press", sectionId: sm, routineItem: pushItems[1], sets: [WU(5, 30), W(8, ohp), W(7, ohp), W(6, ohp)] },
    { key: "incline_db_press", sectionId: sa, routineItem: pushItems[2], sets: [W(10, incline), W(9, incline), W(8, incline)] },
    { key: "lateral_raise", sectionId: sa, routineItem: pushItems[3], sets: [W(15, lat), W(13, lat), W(12, lat)] },
    ...(push2 ? [{ key: "triceps_pushdown", sectionId: sa, superset: null, routineItem: { ...pushItems[4], supersetGroup: null }, sets: [W(12, 32.5), W(11, 32.5), W(10, 32.5)] }] : []),
  ], { routine: push, sections: [
    { id: sm, position: 0, name: "Main lifts", notes: "Full warm-up before the first working set." },
    { id: sa, position: 1, name: "Accessories", notes: null },
  ] });
}
function lowerSession(n, daysAgo, squat, rdl, legPress) {
  return makeWorkout(n, at(daysAgo), 74, [
    { key: "back_squat", routineItem: lowerItems[0], sets: [WU(5, 60), WU(3, 90), W(5, squat), W(5, squat), W(5, squat), W(5, squat), W(4, squat, { rpe: 9 })] },
    { key: "romanian_deadlift", routineItem: lowerItems[1], sets: [W(10, rdl), W(9, rdl), W(8, rdl)] },
    { key: "leg_press", routineItem: lowerItems[2], sets: [W(12, legPress), W(11, legPress), W(10, legPress)] },
    { key: "plank", routineItem: lowerItems[3], sets: [{ durationS: 60 }, { durationS: 50 }, { durationS: 45 }] },
  ], { routine: lower });
}
function pullSession(n, daysAgo, dl, pullups, row, pulldown) {
  return makeWorkout(n, at(daysAgo), 71, [
    { key: "deadlift", routineItem: pullItems[0], sets: [WU(5, 100), W(5, dl), W(4, dl), W(3, dl, { rpe: 9 })] },
    { key: "pull_up", routineItem: pullItems[1], sets: pullups.map(BW) },
    { key: "barbell_row", routineItem: pullItems[2], sets: [W(10, row), W(9, row), W(8, row)] },
    { key: "lat_pulldown", routineItem: pullItems[3], sets: [W(12, pulldown), W(11, pulldown), W(10, pulldown)] },
    { key: "barbell_curl", routineItem: pullItems[4], sets: [W(12, 30), W(10, 30), W(9, 30)] },
  ], { routine: pull });
}

// Oldest first (n ascending = chronological).
export const finished = [
  pushSession(1, 25, 77.5, 45, 24, 8),
  lowerSession(2, 23, 110, 90, 180),
  pullSession(3, 21, 145, [9, 8, 7, 6], 65, 55),
  pushSession(4, 18, 80, 45, 24, 10),
  lowerSession(5, 16, 115, 95, 190),
  pullSession(6, 14, 150, [10, 8, 8, 7], 67.5, 57.5),
  makeWorkout(7, at(11, 7), 32, [
    { key: "row_erg", sets: [{ distance: 2000, durationS: 478 }] },
    { key: "weighted_dip", sets: [W(8, 10), W(8, 10), W(6, 15)] },
    { key: "plank", sets: [{ durationS: 75 }, { durationS: 60 }] },
  ], { title: "Hotel gym", notes: "Only dumbbells to 25 kg. Short session." }),
  pushSession(8, 4, 82.5, 47.5, 26, 10),
  lowerSession(9, 2, 117.5, 95, 200),
];

// The ACTIVE session: Push Day, started 38 minutes ago, part-way through.
const ACTIVE_N = 50;
const activeStart = NOW - 38 * MIN;
const WS_MAIN = uuid("f2000000", 1);
const WS_ACC = uuid("f2000000", 2);
export const active = makeWorkout(ACTIVE_N, activeStart, 0, [
  { key: "bench_press", routineItem: pushItems[0], sectionId: WS_MAIN, sets: [WU(8, 40), WU(5, 60), W(5, 85), W(5, 85, { rpe: 8.5 })] },
  { key: "overhead_press", routineItem: pushItems[1], sectionId: WS_MAIN, sets: [WU(5, 30)] },
  { key: "incline_db_press", routineItem: pushItems[2], sectionId: WS_ACC, sets: [] },
  { key: "lateral_raise", routineItem: pushItems[3], sectionId: WS_ACC, sets: [] },
  { key: "plank", routineItem: lowerItems[3], sectionId: WS_ACC, sets: [] },
], {
  active: true,
  routine: push,
  sections: [
    { id: WS_MAIN, position: 0, name: "Main lifts", notes: "Full warm-up before the first working set." },
    { id: WS_ACC, position: 1, name: "Accessories", notes: null },
  ],
});
// Active sets were logged at real times within the 38 minutes.
{
  let t = activeStart + 3 * MIN;
  for (const ex of active.exercises) for (const s of ex.sets) {
    t += 4 * MIN;
    s.completedAt = s.createdAt = s.updatedAt = iso(t);
  }
}

// Spec 17.1 AC57: every planned set logged, for the Finish-mode capture (the bar reads "Finish workout").
export const activeDone = (() => {
  const done = structuredClone(active);
  let t = Date.parse(done.startedAt) + 30 * MIN;
  let n = 0;
  for (const ex of done.exercises) {
    for (let i = ex.sets.length; i < ex.plannedSets.length; i += 1) {
      const row = ex.plannedSets[i];
      const isDuration = ex.modalitySnapshot === "duration";
      const kg = row.weight === null ? null : row.weightUnit === "lb" ? row.weight * 0.45359237 : row.weight;
      t += MIN;
      n += 1;
      ex.sets.push({
        id: uuid("d9000000", n), workoutExerciseId: ex.id, clientGeneratedId: uuid("c9000000", n), setNumber: i + 1,
        setType: row.setType, reps: isDuration ? null : (row.repsLow ?? 10), weight: row.weight, weightUnit: row.weight === null ? null : row.weightUnit,
        weightKg: kg, distance: null, distanceUnit: null, distanceM: null, durationS: isDuration ? 45 : null,
        rpe: null, isComplete: true, completedAt: iso(t), createdAt: iso(t), updatedAt: iso(t),
      });
    }
  }
  return done;
})();

// ---------------------------------------------------------------- records + progress
const epley = (w, r) => (r === 1 ? w : r >= 1 && r <= 12 ? w * (1 + r / 30) : null);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function computeRecords() {
  const best = new Map(); // `${exId}|${type}` -> {value, prev, set, workout, we}
  for (const w of finished) {
    for (const we of w.exercises) {
      for (const s of we.sets) {
        if (s.setType !== "working") continue;
        const cands = [];
        if (we.modalitySnapshot === "weight_reps" || we.modalitySnapshot === "weighted_bodyweight") {
          if (s.weightKg > 0) {
            cands.push(["heaviest_weight", s.weightKg, "kg"]);
            const e = epley(s.weightKg, s.reps);
            if (e) cands.push(["best_est_1rm", round(e), "kg"]);
            if (s.reps > 0) cands.push(["best_set_volume", round(s.weightKg * s.reps), "kg_reps"]);
          }
        } else if (we.modalitySnapshot === "bodyweight_reps" && s.reps > 0) {
          cands.push(["max_reps", s.reps, "reps"]);
        }
        for (const [type, value, unit] of cands) {
          const k = `${we.exerciseId}|${type}`;
          const cur = best.get(k);
          if (!cur || value > cur.value) {
            best.set(k, { type, value, unit, prev: cur ? cur.value : null, s, w, we });
          }
        }
      }
    }
  }
  return [...best.values()].map((b) => ({
    exerciseId: b.we.exerciseId,
    sourceExerciseId: b.we.exerciseId,
    exerciseName: b.we.exerciseNameSnapshot,
    recordType: b.type,
    value: b.value,
    unit: b.unit,
    previousValue: b.prev,
    sourceSetId: b.s.id,
    workoutId: b.w.id,
    achievedAt: b.s.completedAt,
    localDate: b.w.localDate,
  }));
}
export const records = computeRecords();

export function progressFor(exerciseId) {
  const points = [];
  for (const w of finished) {
    const wes = w.exercises.filter((we) => we.exerciseId === exerciseId);
    if (wes.length === 0) continue;
    let top = null, e1 = null, vol = 0, reps = null;
    for (const we of wes) for (const s of we.sets) {
      if (s.setType !== "working") continue;
      if (we.modalitySnapshot === "bodyweight_reps") { reps = Math.max(reps ?? 0, s.reps ?? 0) || null; continue; }
      if (!(s.weightKg > 0) || !(s.reps > 0)) continue;
      top = Math.max(top ?? 0, s.weightKg);
      const e = epley(s.weightKg, s.reps);
      if (e) e1 = Math.max(e1 ?? 0, round(e));
      vol += s.weightKg * s.reps;
    }
    points.push({
      workoutId: w.id, localDate: w.localDate, startedAt: w.startedAt,
      topSetWeight: top, bestE1rm: e1, totalVolume: vol > 0 ? round(vol) : null, maxReps: reps,
    });
  }
  return { exerciseId, points };
}

export function summaryOf(w) {
  const working = w.exercises.flatMap((we) => we.sets.filter((s) => s.setType === "working"));
  const vol = working.reduce((a, s) => a + (s.weightKg && s.reps ? s.weightKg * s.reps : 0), 0);
  // Summaries carry no sections or routine notes; drop them from the detail shape.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { exercises: exs, sections, routineNotes, ...base } = w;
  return {
    ...base,
    exerciseCount: exs.length,
    exerciseNames: exs.slice(0, 3).map((e) => e.exerciseNameSnapshot),
    workingSetCount: working.length,
    totalVolume: vol > 0 ? round(vol) : null,
    recordCount: records.filter((r) => r.workoutId === w.id).length,
  };
}

export const history = {
  items: [...finished].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map(summaryOf),
  next: null,
};

export const ids = {
  PUSH_ID, LOWER_ID, PULL_ID,
  bench: exByKey.bench_press.id,
  squat: exByKey.back_squat.id,
  pullUp: exByKey.pull_up.id,
  latestFinished: finished[finished.length - 1].id,
  latestPush: finished[7].id,
  activeId: active.id,
};

export const allWorkouts = [...finished, active];

/** The payloads to check, as [name, schemaExportName, value]. Validated in the browser against
 * @sin/core's TypeScript source (served by the harness Vite server), so a stale dist can't fool it. */
export function payloadChecks() {
  return [
    ["me", "MeSchema", me],
    ["exercises", "ExercisesResponse", { exercises, syncToken: "1.100" }],
    ["muscle-groups", "MuscleGroupsResponse", { muscleGroups }],
    ["equipment", "EquipmentResponse", { equipment }],
    ["routines", "RoutineListResponseSchema", { routines }],
    ["history", "WorkoutHistoryResponseSchema", history],
    ["records", "PersonalRecordsResponseSchema", { records }],
    ...allWorkouts.map((w) => [`workout ${w.id}`, "WorkoutDetailSchema", w]),
    ["active, all planned logged", "WorkoutDetailSchema", activeDone],
    ...exercises.map((e) => [`progress ${e.name}`, "ProgressSeriesSchema", progressFor(e.id)]),
  ];
}
