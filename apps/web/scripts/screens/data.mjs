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
  // Spec 18.1 AC25: one exercise of each new type.
  ["echo_bike", "Echo Bike", "calories", "cardio", [], "machine"],
  ["farmer_carry", "Farmer Carry", "weight_distance", "core", [], "dumbbell"],
  ["sandbag_hold", "Weighted Sandbag Hold", "weight_duration", "core", [], "bodyweight"],
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
// Spec 10.4 AC39: one custom exercise, so the import's Check screen shows an exact card ("Push Press").
exercises.push({
  id: uuid("e0000000", EX.length + 1),
  catalogKey: null,
  ownerUserId: me.id,
  name: "Push Press",
  modality: "weight_reps",
  primaryMuscleId: "shoulders",
  secondaryMuscleIds: ["triceps"],
  equipmentId: "barbell",
  isActive: true,
  forkedFromExerciseId: null,
  createdAt: iso(NOW - 30 * DAY),
  updatedAt: iso(NOW - 30 * DAY),
});
const exByKey = Object.fromEntries(exercises.map((e) => [e.catalogKey, e]));
// Spec 18.2 AC27: the lifter's copy of a logged built-in (the list shows the copy, dated by the built-in's sets).
exercises.push({
  id: uuid("e0000000", EX.length + 2),
  catalogKey: null,
  ownerUserId: me.id,
  name: "Rowing Machine (mine)",
  modality: "distance_duration",
  primaryMuscleId: "cardio",
  secondaryMuscleIds: ["back"],
  equipmentId: "rower",
  isActive: true,
  forkedFromExerciseId: exByKey.row_erg.id,
  createdAt: iso(NOW - 10 * DAY),
  updatedAt: iso(NOW - 10 * DAY),
});

/**
 * Spec 18.2 Phase B: the lifter's own copy of Bench Press, served only by the manage-exercise captures (so every
 * other capture keeps the built-in), with routines that now use the copy.
 */
export const benchCopy = {
  ...exByKey.bench_press,
  id: uuid("e0000000", EX.length + 3),
  catalogKey: null,
  ownerUserId: me.id,
  name: "Bench Press (mine)",
  forkedFromExerciseId: exByKey.bench_press.id,
  createdAt: iso(NOW - 5 * DAY),
  updatedAt: iso(NOW - 5 * DAY),
};

/** An exercise's lineage root: a fork's built-in, else itself (Spec 03.4 `lineageRootId`). */
export const rootOf = (id) => [...exercises, benchCopy].find((e) => e.id === id)?.forkedFromExerciseId ?? id;

/** Spec 18.2 AC27: a schema-valid catalog of `n` own exercises, for the 600-row capture. */
export function manyExercises(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: uuid("e1000000", i + 1),
    catalogKey: null,
    ownerUserId: me.id,
    name: `Exercise ${String(i + 1).padStart(3, "0")}`,
    modality: i % 3 === 0 ? "bodyweight_reps" : "weight_reps",
    primaryMuscleId: null,
    secondaryMuscleIds: [],
    equipmentId: null,
    isActive: true,
    forkedFromExerciseId: null,
    createdAt: iso(NOW - 100 * DAY),
    updatedAt: iso(NOW - 100 * DAY),
  }));
}

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
    oneOffUntil: null,
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
    oneOffUntil: null,
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
    oneOffUntil: null,
  },
];

/**
 * Spec 10.5 AC26: a routine saved from text (a one-off), served only by the one-off captures so every
 * other routines shot stays as it was.
 */
export const CLASS = {
  id: uuid("b0000000", 9),
  name: "Class Fri 16 Oct",
  notes: null,
  sections: [],
  items: [
    item("back_squat", 0, { supersetGroup: 1, sets: rep(3, ps("working", 10, 10, null)) }),
    item("barbell_row", 1, { supersetGroup: 1, sets: rep(3, ps("working", 10, 10, null)) }),
    item("bench_press", 2, { supersetGroup: 2, sets: rep(3, ps("working", 8, 8, null)) }),
    item("lateral_raise", 3, { supersetGroup: 2, sets: rep(3, ps("working", 12, 12, null)) }),
    item("romanian_deadlift", 4, { sets: rep(3, ps("working", 10, 10, null)) }),
    item("plank", 5, { targetSets: 3, sets: rep(3, ps("working", null, null, null)) }),
  ],
  createdAt: iso(NOW - 5 * MIN),
  updatedAt: iso(NOW - 5 * MIN),
  oneOffUntil: iso(NOW - 5 * MIN + 14 * DAY),
};

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
    calories: s.calories ?? null,
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
    plannedDurationSeconds: opts.plannedDurationSeconds ?? null,
    localDate: localDate(startMs),
    tzOffsetMinutes: tzOffsetMinutes(startMs),
    clientGeneratedId: uuid("c0000000", n),
    source: "manual",
    createdAt: iso(startMs),
    updatedAt: iso(startMs + durationMin * MIN),
    routineName: opts.routine?.name ?? null,
    routineNotes: opts.routine?.notes ?? null,
    sections: opts.sections ?? [],
    routineIsOneOff: false,
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

function pushSession(n, daysAgo, bench, ohp, incline, lat, push2 = true, details = {}) {
  const sm = uuid("f3000000", n * 10 + 1), sa = uuid("f3000000", n * 10 + 2);
  return makeWorkout(n, at(daysAgo), 68, [
    { key: "bench_press", sectionId: sm, routineItem: pushItems[0], sets: [WU(8, 40), WU(5, 60), W(5, bench), W(5, bench), W(5, bench, { rpe: 8.5 })] },
    { key: "overhead_press", sectionId: sm, routineItem: pushItems[1], sets: [WU(5, 30), W(8, ohp), W(7, ohp), W(6, ohp)] },
    { key: "incline_db_press", sectionId: sa, routineItem: pushItems[2], sets: [W(10, incline), W(9, incline), W(8, incline)] },
    { key: "lateral_raise", sectionId: sa, routineItem: pushItems[3], sets: [W(15, lat), W(13, lat), W(12, lat)] },
    ...(push2 ? [{ key: "triceps_pushdown", sectionId: sa, superset: null, routineItem: { ...pushItems[4], supersetGroup: null }, sets: [W(12, 32.5), W(11, 32.5), W(10, 32.5)] }] : []),
  ], { ...details, routine: push, sections: [
    { id: sm, position: 0, name: "Main lifts", notes: "Full warm-up before the first working set.", addedInWorkout: false },
    { id: sa, position: 1, name: "Accessories", notes: null, addedInWorkout: false },
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

// Oldest first (chronological; records are decided in this order: a tie stays with the earlier workout).
const byStart = (a, b) => a.startedAt.localeCompare(b.startedAt);
export const finished = [
  // Spec 17.2 AC33: workouts that hold NO records, so History and the summaries show the real range. A light push day
  // (every lift below the earlier best), a bench "volume day" (60 kg x 20 beats the best set volume but not the weight, and
  // 20 reps is past the e1RM formula's range: a volume-only record, which the summary hides and History does not count),
  // and a plank-only session (no record types, no volume).
  pushSession(10, 19, 70, 40, 22, 7),
  makeWorkout(11, at(9), 25, [{ key: "bench_press", sets: [W(20, 60), W(20, 60)] }], { title: "Bench volume day" }),
  makeWorkout(12, at(6), 12, [{ key: "plank", sets: [{ durationS: 45 }, { durationS: 40 }] }], { title: "Plank only" }),
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
  // Spec 18.0 AC49: the newest Push Day carries a title and two-line notes (the summary, the edit screen's Details panel).
  pushSession(8, 4, 82.5, 47.5, 26, 10, true, { title: "Heavy bench day", notes: "Shoulder felt tight on set 3.\nDropped the last lateral set." }),
  // Spec 18.0 AC49: a one-set workout, so deleting its set shows "Delete this whole workout instead?".
  makeWorkout(13, at(3), 9, [{ key: "bench_press", sets: [W(5, 60)] }], { title: "Quick single" }),
  // Spec 18.1 AC25: a finished workout of the three new types, in the middle of the list (so the first, latest and
  // newest-Push captures keep their workouts). Its records' previous values come from the workout 20 days back.
  makeWorkout(14, at(12), 24, [
    { key: "echo_bike", sets: [{ calories: 20 }, { calories: 25 }] },
    { key: "farmer_carry", sets: [{ weight: 24, distance: 40 }, { weight: 32, distance: 30 }] },
    { key: "sandbag_hold", sets: [{ weight: 20, durationS: 90 }, { weight: 20, durationS: 75 }] },
  ], { title: "Conditioning" }),
  // Spec 18.1 AC35: an earlier, lighter session, so each new-type chart has two points and the summary cards show gains.
  makeWorkout(15, at(20), 22, [
    { key: "echo_bike", sets: [{ calories: 15 }, { calories: 18 }] },
    { key: "farmer_carry", sets: [{ weight: 20, distance: 30 }] },
    { key: "sandbag_hold", sets: [{ weight: 16, durationS: 60 }] },
  ], { title: "Conditioning (light)" }),
  lowerSession(9, 2, 117.5, 95, 200),
].sort(byStart);

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
    { id: WS_MAIN, position: 0, name: "Main lifts", notes: "Full warm-up before the first working set.", addedInWorkout: false },
    { id: WS_ACC, position: 1, name: "Accessories", notes: null, addedInWorkout: false },
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
// Spec 18.0 AC49: the same live workout, back-dated two days with a "took" of 1 h (Change Time), so the
// header reads "Took 1 h" and the Finish dialogs say where it ends.
const plannedStart = at(2);
export const activePlanned = {
  ...active,
  startedAt: iso(plannedStart),
  localDate: localDate(plannedStart),
  tzOffsetMinutes: tzOffsetMinutes(plannedStart),
  plannedDurationSeconds: 3600,
};

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
        weightKg: kg, distance: null, distanceUnit: null, distanceM: null, durationS: isDuration ? 45 : null, calories: null,
        rpe: null, isComplete: true, completedAt: iso(t), createdAt: iso(t), updatedAt: iso(t),
      });
    }
  }
  return done;
})();

/** Spec 10.5 AC26: the same all-logged session, started from the one-off (its Finish dialog shows the line). */
export const activeOneOff = { ...activeDone, routineName: CLASS.name, routineIsOneOff: true };

// Spec 18.1 AC25: a live workout with a current card of each new type and one planned carry.
const newTypesStart = NOW - 15 * MIN;
const CARRY_PLAN = [
  { setType: "working", repsLow: null, repsHigh: null, weight: 24, weightUnit: "kg" },
  { setType: "working", repsLow: null, repsHigh: null, weight: 32, weightUnit: "kg" },
];
export const activeNewTypes = makeWorkout(52, newTypesStart, 0, [
  { key: "echo_bike", sets: [{ calories: 20 }] },
  { key: "farmer_carry", routineItem: { targetSets: 2, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: 120, supersetGroup: null, notes: null, sets: CARRY_PLAN }, sets: [] },
  { key: "sandbag_hold", sets: [] },
], { active: true });

// Spec 10.6 AC28: a live workout with a copied section (with its note), a section added during the workout (empty),
// a superset in the copied section, and a loose Rowing Machine card logged before any section existed.
const AS_STRENGTH = uuid("f2000000", 3);
const AS_COOLDOWN = uuid("f2000000", 4);
const sectionsStart = NOW - 25 * MIN;
export const activeSections = makeWorkout(51, sectionsStart, 0, [
  { key: "back_squat", sectionId: AS_STRENGTH, superset: 1, sets: [W(5, 100)] },
  { key: "barbell_row", sectionId: AS_STRENGTH, superset: 1, sets: [] },
  { key: "row_erg", sets: [{ distance: 1000, durationS: 240 }] },
], {
  active: true,
  sections: [
    { id: AS_STRENGTH, position: 0, name: "Strength", notes: "EMOM 10 min: 5 reps on the minute", addedInWorkout: false },
    { id: AS_COOLDOWN, position: 1, name: "Cooldown", notes: "Easy stretching, 5 min", addedInWorkout: true },
  ],
});

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
        } else if (we.modalitySnapshot === "calories" && s.calories >= 1) {
          // Spec 18.1 AC35: the three new types, as Spec 05.3 §6.2 decides them.
          cands.push(["max_calories", s.calories, "cal"]);
        } else if (we.modalitySnapshot === "weight_distance" && s.distanceM > 0) {
          if (s.weightKg > 0) cands.push(["heaviest_weight", s.weightKg, "kg"]);
          cands.push(["max_distance", s.distanceM, "m"]);
        } else if (we.modalitySnapshot === "weight_duration" && s.durationS >= 1) {
          if (s.weightKg > 0) cands.push(["heaviest_weight", s.weightKg, "kg"]);
          cands.push(["max_duration", s.durationS, "s"]);
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
    let top = null, e1 = null, vol = 0, reps = null, cal = null, dist = null, dur = null;
    for (const we of wes) for (const s of we.sets) {
      if (s.setType !== "working") continue;
      if (we.modalitySnapshot === "bodyweight_reps") { reps = Math.max(reps ?? 0, s.reps ?? 0) || null; continue; }
      // Spec 18.1 AC35: the new types' series, from the same per-set rules as the records above.
      if (we.modalitySnapshot === "calories") { if (s.calories >= 1) cal = Math.max(cal ?? 0, s.calories); continue; }
      if (we.modalitySnapshot === "weight_distance") {
        if (s.distanceM > 0) { dist = Math.max(dist ?? 0, s.distanceM); if (s.weightKg > 0) top = Math.max(top ?? 0, s.weightKg); }
        continue;
      }
      if (we.modalitySnapshot === "weight_duration") {
        if (s.durationS >= 1) { dur = Math.max(dur ?? 0, s.durationS); if (s.weightKg > 0) top = Math.max(top ?? 0, s.weightKg); }
        continue;
      }
      if (!(s.weightKg > 0) || !(s.reps > 0)) continue;
      top = Math.max(top ?? 0, s.weightKg);
      const e = epley(s.weightKg, s.reps);
      if (e) e1 = Math.max(e1 ?? 0, round(e));
      vol += s.weightKg * s.reps;
    }
    points.push({
      workoutId: w.id, localDate: w.localDate, startedAt: w.startedAt,
      topSetWeight: top, bestE1rm: e1, totalVolume: vol > 0 ? round(vol) : null, maxReps: reps,
      maxCalories: cal, maxDistance: dist, maxDuration: dur,
    });
  }
  return { exerciseId, points };
}

export function summaryOf(w) {
  const working = w.exercises.flatMap((we) => we.sets.filter((s) => s.setType === "working"));
  const vol = working.reduce((a, s) => a + (s.weightKg && s.reps ? s.weightKg * s.reps : 0), 0);
  // Summaries carry no sections, routine notes or one-off flag; drop them from the detail shape.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { exercises: exs, sections, routineNotes, routineIsOneOff, ...base } = w;
  return {
    ...base,
    exerciseCount: exs.length,
    exerciseNames: exs.slice(0, 3).map((e) => e.exerciseNameSnapshot),
    workingSetCount: working.length,
    totalVolume: vol > 0 ? round(vol) : null,
    // Spec 07.3: the served count excludes set-volume records.
    recordCount: records.filter((r) => r.workoutId === w.id && r.recordType !== "best_set_volume").length,
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
  // The newest Push Day (it holds records with gains: a lead card plus chips).
  latestPush: [...finished].reverse().find((w) => w.routineName === push.name).id,
  // Spec 17.2 AC40 states: the first workout (every record is a first record, many cards), and three without records.
  firstWorkout: finished[0].id,
  noRecords: finished.find((w) => w.title === null && w.routineName === push.name && w.exercises[0].sets.some((s) => s.weight === 70)).id,
  volumeOnly: finished.find((w) => w.title === "Bench volume day").id,
  plankOnly: finished.find((w) => w.title === "Plank only").id,
  oneSet: finished.find((w) => w.title === "Quick single").id,
  conditioning: finished.find((w) => w.title === "Conditioning").id,
  echoBike: exByKey.echo_bike.id,
  // Spec 18.2 AC27: the never-logged own exercise, the copy of a logged built-in, and the one the deleted capture hides.
  pushPress: exercises.find((e) => e.name === "Push Press").id,
  rowingCopy: exercises.find((e) => e.name === "Rowing Machine (mine)").id,
  curl: exByKey.barbell_curl.id,
  farmerCarry: exByKey.farmer_carry.id,
  sandbagHold: exByKey.sandbag_hold.id,
  activeId: active.id,
};

export const allWorkouts = [...finished, active];

/** The routines (the one-off class among them) as they read once the lifter swapped Bench Press for the copy. */
export const routinesWithBenchCopy = [CLASS, ...routines].map((r) => ({
  ...r,
  items: r.items.map((i) => (i.exerciseId === benchCopy.forkedFromExerciseId ? { ...i, exerciseId: benchCopy.id } : i)),
}));

/** `GET /v1/exercises/{id}/routines` (Spec 03.4 §5.3): exact id, ordered by lower(name), then id. */
export function routinesUsing(id, list = [CLASS, ...routines]) {
  return {
    routines: list
      .filter((r) => r.items.some((i) => i.exerciseId === id))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id))
      .map((r) => ({ id: r.id, name: r.name, oneOffUntil: r.oneOffUntil })),
  };
}

/** `GET /v1/exercises/usage` (Spec 03.4 §5.2): the latest local date per lineage root, live workouts included. */
export function usage() {
  const last = new Map();
  for (const w of allWorkouts) {
    for (const we of w.exercises) {
      if (we.sets.length === 0) continue;
      const root = rootOf(we.exerciseId);
      if (!last.has(root) || last.get(root) < w.localDate) last.set(root, w.localDate);
    }
  }
  return {
    exercises: [...last]
      .map(([rootId, lastLoggedOn]) => ({ rootId, lastLoggedOn }))
      .sort((a, b) => b.lastLoggedOn.localeCompare(a.lastLoggedOn) || a.rootId.localeCompare(b.rootId)),
  };
}

/** The payloads to check, as [name, schemaExportName, value]. Validated in the browser against
 * @sin/core's TypeScript source (served by the harness Vite server), so a stale dist can't fool it. */
export function payloadChecks() {
  return [
    ["me", "MeSchema", me],
    ["exercises", "ExercisesResponse", { exercises, syncToken: "1.100" }],
    ["muscle-groups", "MuscleGroupsResponse", { muscleGroups }],
    ["equipment", "EquipmentResponse", { equipment }],
    ["routines", "RoutineListResponseSchema", { routines }],
    ["routines with the one-off", "RoutineListResponseSchema", { routines: [CLASS, ...routines] }],
    ["history", "WorkoutHistoryResponseSchema", history],
    ["records", "PersonalRecordsResponseSchema", { records }],
    ["exercise usage", "ExerciseUsageResponseSchema", usage()],
    ["600 exercises", "ExercisesResponse", { exercises: manyExercises(600), syncToken: "1.100" }],
    ["exercises with the bench copy", "ExercisesResponse", { exercises: [...exercises, benchCopy], syncToken: "1.100" }],
    ["routines using the bench copy", "ExerciseRoutinesResponseSchema", routinesUsing(benchCopy.id, routinesWithBenchCopy)],
    ["routines using none", "ExerciseRoutinesResponseSchema", routinesUsing(ids.pushPress)],
    ["routines with the bench copy", "RoutineListResponseSchema", { routines: routinesWithBenchCopy }],
    ...allWorkouts.map((w) => [`workout ${w.id}`, "WorkoutDetailSchema", w]),
    ["active, all planned logged", "WorkoutDetailSchema", activeDone],
    ["active, from a one-off", "WorkoutDetailSchema", activeOneOff],
    ["active, back-dated with a took", "WorkoutDetailSchema", activePlanned],
    ["active, with workout sections", "WorkoutDetailSchema", activeSections],
    ["active, the three new types", "WorkoutDetailSchema", activeNewTypes],
    ...exercises.map((e) => [`progress ${e.name}`, "ProgressSeriesSchema", progressFor(e.id)]),
    ["hevy status", "HevyStatusSchema", hevyStatus],
    ["hevy user info", "HevyUserInfoSchema", hevyUserInfo],
  ];
}

// Spec 20.0: the harness user is the owner, so the status answers `enabled`.
export const hevyStatus = { enabled: true, pairCount: 0, linkCount: 0, recordsStale: false };
/** The key the fake Hevy accepts; any other key gets a 401. */
export const hevyGoodKey = "5ec7e7a1-0b5e-4c3d-9a8f-1234deadbeef";
export const hevyBadKey = "0b0b0b0b-1111-4222-8333-44445555cafe";
export const hevyUserInfo = {
  data: { id: "9c465af3-de7d-42bc-9c7c-f0170396358b", username: "carol_lifts", name: "Carol", url: "https://hevy.com/user/carol_lifts", is_pro: true },
};
