// Screenshot capture for the SPA against the harness Vite server (Spec 17.0 §6.10, AC18).
// Usage: node capture.mjs <baseUrl>   (run.mjs starts the server and calls this; see README.md)
// Output: apps/web/.screens/<theme>/<device>/<NN-name>[-full].png + .layout.json, and _report.json.
// The page.evaluate callbacks below run in the browser, so they use DOM globals.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { insertIndexForSection, resultIssues, roundTimeIssues, sectionForNewExercise, timerChangeKeepsRecorded, timersEqual } from "@sin/core";

import * as D from "./data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(webRoot, "../..");
const require = createRequire(path.join(webRoot, "package.json"));
const { chromium } = require("@playwright/test");

const OUT = path.join(webRoot, ".screens");
const BASE = process.argv[2] ?? "http://localhost:5287";
// Spec 20.0: Hevy's paths also start with /v1/, so the fake SIN API answers only on the app's own origin.
const SIN_ORIGIN = new URL(BASE).origin;
const isSinApi = (u) => u.origin === SIN_ORIGIN && u.pathname.startsWith("/v1/");
// SCREENS_THEMES=light (or dark) and SCREENS_DEVICES=mobile (or desktop) narrow a run; default is all four.
const THEMES = (process.env.SCREENS_THEMES ?? "light,dark").split(",").map((s) => s.trim()).filter(Boolean);
const DEVICE_FILTER = (process.env.SCREENS_DEVICES ?? "mobile,desktop").split(",").map((s) => s.trim());
const CORE_SRC = "/@fs" + path.join(repoRoot, "packages/core/src/index.ts").split(path.sep).join("/");
fs.mkdirSync(OUT, { recursive: true });


const unmatched = new Set();
const consoleErrors = [];

function problem(status, slug, title) {
  return { status, contentType: "application/problem+json", body: JSON.stringify({ type: `https://api.strengthinnumbers.app/problems/${slug}`, title, status, detail: title }) };
}
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
/** A lineage root, including a copy made during the run (it lives only in the context's catalog). */
const rootIn = (state, id) => (state.catalog ?? []).find((e) => e.id === id)?.forkedFromExerciseId ?? D.rootOf(id);

/** Spec 20.1: the import's reads; `holdWorkoutsPage` keeps that workouts page from answering (the reading shot). */
let holdWorkoutsPage = null;
const HEVY_LISTS = {
  "/v1/routine_folders": () => [D.hevyFolders, "routine_folders"],
  "/v1/routines": () => [D.hevyRoutines, "routines"],
  "/v1/workouts": () => [D.hevyWorkouts, "workouts"],
};

/** Spec 20.2: how Hevy answers a workout create — "ok", "hold" (never answers: the sending shot) or "fail" (a 503). */
let hevyWrite = "ok";

/** Spec 20.0: the fake Hevy API — `user/info` accepts only `D.hevyGoodKey`; anything else is unmatched. */
async function hevyHandler(route) {
  const req = route.request();
  const url = new URL(req.url());
  // Spec 20.2: a send's create and update, and Create in Hevy.
  if (req.method() === "POST" && url.pathname === "/v1/workouts") {
    if (hevyWrite === "hold") return; // never fulfilled
    if (hevyWrite === "fail") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
      return;
    }
    await route.fulfill(json({ workout: [D.hevyCreatedWorkout] }));
    return;
  }
  if (req.method() === "PUT" && /^\/v1\/workouts\/[^/]+$/.test(url.pathname)) {
    await route.fulfill(json(D.hevyCreatedWorkout));
    return;
  }
  if (req.method() === "POST" && url.pathname === "/v1/exercise_templates") {
    await route.fulfill(json({ id: "H-NEW-1" }));
    return;
  }
  if (req.method() === "GET" && url.pathname === "/v1/workouts/count") {
    await route.fulfill(json({ workout_count: D.hevyWorkouts.length }));
    return;
  }
  if (req.method() === "GET" && HEVY_LISTS[url.pathname]) {
    const page = Number(url.searchParams.get("page") ?? "1");
    if (url.pathname === "/v1/workouts" && page === holdWorkoutsPage) return; // never fulfilled
    const [list, field] = HEVY_LISTS[url.pathname]();
    await route.fulfill(json(D.hevyPage(list, field, page)));
    return;
  }
  if (req.method() === "GET" && url.pathname === "/v1/exercise_templates") {
    // Two pages, so the reading line shows a real "page n of 2".
    const page = Number(url.searchParams.get("page") ?? "1");
    const half = Math.ceil(D.hevyTemplates.length / 2);
    await route.fulfill(json({ page, page_count: 2, exercise_templates: D.hevyTemplates.slice((page - 1) * half, page * half) }));
    return;
  }
  if (req.method() === "GET" && url.pathname === "/v1/user/info") {
    const ok = req.headers()["api-key"] === D.hevyGoodKey;
    await route.fulfill(ok ? json(D.hevyUserInfo) : { status: 401, contentType: "application/json", body: JSON.stringify({ error: "Unauthorized" }) });
    return;
  }
  unmatched.add(`HEVY ${req.method()} ${url.pathname}${url.search}`);
  console.warn(`  UNMATCHED HEVY ${req.method()} ${url.pathname}${url.search}`);
  await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
}

function makeHandler(state) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();
    let seg;
    let res;
    if (state.hangWrites && m !== "GET") {
      console.log(`  (holding ${m} ${p} unanswered so the outbox keeps it pending)`);
      return; // never fulfilled: the write stays in flight
    }
    if (m === "GET" && p === "/v1/me") res = json(D.me);
    else if (m === "GET" && p === "/v1/hevy/status") res = json(D.hevyStatus);
    else if (m === "GET" && p === "/v1/hevy/mapping") res = json(state.hevyMapping ?? D.hevyMapping);
    // Spec 20.2: a workout's Hevy link as `state.hevyLink` says (none when unset), and begin / complete / release.
    else if ((seg = /^\/v1\/workouts\/([^/]+)\/hevy-link$/.exec(p))) {
      if (m === "GET") res = json(state.hevyLink ?? D.hevyLinkOf("none"));
      else if (m === "POST") res = json(D.hevyBegin);
      else if (m === "PUT") {
        state.hevyLink = D.hevyLinkOf("sent");
        res = json(state.hevyLink);
      } else if (m === "DELETE") res = { status: 204, contentType: "application/json", body: "" };
    }
    // Spec 20.1: the dry run, and (Phase B) the real run as `state.importMode` says: "hold" keeps it unanswered,
    // "fail" answers 500 (the run retries, then pauses), "refuse" answers a 422 with a path (the run stops), "gate"
    // holds the batch until `state.releaseImport()` and then answers it.
    else if (m === "POST" && p === "/v1/hevy/import/workouts") {
      const body = JSON.parse(req.postData() ?? "{}");
      if (body.dryRun !== false) res = json(D.hevyDryRun(body));
      else if (state.importMode === "hold") return; // never fulfilled
      else if (state.importMode === "gate") {
        await new Promise((release) => { state.releaseImport = release; });
        res = json(D.hevyRealRun(body));
      }
      else if (state.importMode === "fail") res = problem(500, "internal", "Internal error");
      else if (state.importMode === "refuse") res = { ...problem(422, "validation-error", "Invalid"), body: JSON.stringify({ type: "https://api.strengthinnumbers.app/problems/validation-error", title: "Invalid", status: 422, errors: [{ path: "workouts.3.startTime", message: "Invalid input" }] }) };
      else res = json(D.hevyRealRun(body));
    }
    else if (m === "POST" && p === "/v1/hevy/import/finish") res = json({ recomputed: true, rootCount: 4 });
    // Spec 20.1 AC23: the import's routine creates hit the cap (the done screen's routines failure).
    else if (m === "POST" && p === "/v1/routines") res = problem(409, "routine-limit", "Routine limit reached");
    else if ((m === "PUT" || m === "PATCH") && p === "/v1/hevy/mapping") {
      // The fake answers with the mapping it already holds: the captures only need a 200 the schema accepts.
      res = json(state.hevyMapping ?? D.hevyMapping);
    }
    else if (m === "PATCH" && p === "/v1/me") res = json({ ...D.me, ...JSON.parse(req.postData() ?? "{}") });
    // Spec 18.2 AC27: `catalog` swaps the whole list (the 600-row capture); `hideExercise` serves it as deleted.
    else if (m === "GET" && p === "/v1/exercises") res = json({ exercises: state.catalog ?? D.exercises.filter((e) => e.id !== state.hideExercise), syncToken: "1.100" });
    else if (m === "GET" && p === "/v1/exercises/usage") res = state.failUsage ? problem(500, "internal", "Internal error") : json(D.usage());
    // Spec 18.2 AC55: the routines read and the three writes, on the context's catalog.
    else if (m === "GET" && (seg = /^\/v1\/exercises\/([^/]+)\/routines$/.exec(p))) {
      res = state.failRoutines ? problem(500, "internal", "Internal error") : json(D.routinesUsing(decodeURIComponent(seg[1]), state.routines));
    } else if (m === "POST" && (seg = /^\/v1\/exercises\/([^/]+)\/fork$/.exec(p))) {
      const catalog = state.catalog ?? D.exercises;
      const origin = catalog.find((e) => e.id === decodeURIComponent(seg[1]));
      const at = new Date().toISOString();
      const copy = { ...origin, id: crypto.randomUUID(), catalogKey: null, ownerUserId: D.me.id, forkedFromExerciseId: origin.id, createdAt: at, updatedAt: at };
      state.catalog = [...catalog, copy];
      res = json(copy, 201);
    } else if (m === "PATCH" && (seg = /^\/v1\/exercises\/([^/]+)$/.exec(p))) {
      const catalog = state.catalog ?? D.exercises;
      const row = catalog.find((e) => e.id === decodeURIComponent(seg[1]));
      res = state.typeLocked
        ? problem(409, "exercise-type-locked", "Exercise type locked")
        : json({ ...row, ...JSON.parse(req.postData() ?? "{}"), updatedAt: new Date().toISOString() });
    } else if (m === "DELETE" && (seg = /^\/v1\/exercises\/([^/]+)$/.exec(p))) {
      state.catalog = (state.catalog ?? D.exercises).filter((e) => e.id !== decodeURIComponent(seg[1]));
      res = { status: 204, body: "" };
    }
    else if (m === "GET" && p === "/v1/muscle-groups") res = json({ muscleGroups: D.muscleGroups });
    else if (m === "GET" && p === "/v1/equipment") res = json({ equipment: D.equipment });
    // Spec 10.5 AC26: the one-off is listed only while `showClass` is on, until the one-off finish removes it.
    // Spec 10.7 AC63: the timed routine is served only while `showTimed` is on.
    else if (m === "GET" && p === "/v1/routines") res = json({ routines: state.routines ?? (state.showClass && !state.classGone ? [D.CLASS, ...D.routines] : state.showTimed ? [D.TIMED, ...D.routines] : D.routines) });
    else if (m === "GET" && (seg = /^\/v1\/routines\/([^/]+)$/.exec(p))) {
      const listed = state.showClass && !state.classGone ? [D.CLASS, ...D.routines] : state.showTimed ? [D.TIMED, ...D.routines] : D.routines;
      const r = listed.find((x) => x.id === decodeURIComponent(seg[1]));
      res = r ? json(r) : problem(404, "not-found", "Not found");
    } else if (m === "POST" && /^\/v1\/routines\/[^/]+\/keep$/.test(p)) {
      res = { status: 204, body: "" };
    } else if (m === "GET" && p === "/v1/workouts/active" && state.newTypes) {
      res = json(state.newTypes);
    } else if (m === "GET" && p === "/v1/workouts/active" && state.sectioned) {
      res = json(state.sectioned);
    } else if (state.sectioned && (res = sectionRoute(state.sectioned, m, p, req.postData()))) {
      // Spec 10.6 AC28: the four section writes on the sectioned live workout (placement as Spec 09.4 §6.2).
    } else if (m === "GET" && state.editSectioned && p === `/v1/workouts/${state.editSectioned.id}`) {
      res = json(state.editSectioned);
    } else if (state.editSectioned && (res = sectionRoute(state.editSectioned, m, p, req.postData()))) {
      // Spec 10.6 AC28 (Phase B): the same writes on a finished copy of it, for the edit screen.
    } else if (m === "GET" && p === "/v1/workouts/active") {
      const base = state.almostDone ?? (state.oneOffActive ? D.activeOneOff : state.planned ? D.activePlanned : state.done ? D.activeDone : D.active);
      // Spec 17.4 AC17: the logging-loop step needs logged sets to stay, as they do on the real API.
      const live = state.trackLogged ? { ...base, exercises: base.exercises.map((e) => ({ ...e, sets: [...e.sets, ...(state.trackLogged[e.id] ?? [])] })) } : base;
      res = state.active ? json(live) : problem(404, "not-found", "No active workout");
    } else if (m === "PATCH" && state.oneOffActive && (seg = /^\/v1\/workouts\/([^/]+)$/.exec(p))) {
      // The one-off finish: the server removes the routine (Spec 09.3); the detail no longer reads as one-off.
      state.finishedOneOff = { ...D.activeOneOff, endedAt: new Date().toISOString(), plannedDurationSeconds: null, routineIsOneOff: false };
      state.classGone = true;
      res = json({ ...state.finishedOneOff, newRecords: [] });
    } else if (m === "GET" && p === "/v1/workouts") res = json(state.historyTimed ? D.historyTimed : D.history);
    else if (m === "GET" && (seg = /^\/v1\/workouts\/([^/]+)$/.exec(p))) {
      const id = decodeURIComponent(seg[1]);
      const w = state.finishedOneOff?.id === id ? state.finishedOneOff : [...D.allWorkouts, D.finishedTimed, D.finishedManyLifts, D.finishedMixed].find((x) => x.id === id);
      res = w ? json(w) : problem(404, "not-found", "Not found");
    } else if (m === "GET" && p === "/v1/personal-records") {
      const ex = url.searchParams.get("exerciseId");
      const wo = url.searchParams.get("workoutId");
      // Records and series resolve a fork's id to its lineage root, as the API does (07.0, 07.2 AC4).
      // Spec 17.6 AC20: the ledger fixtures' records join only a workout's own read.
      const all = wo ? [...D.records, ...D.ledgerRecords] : D.records;
      res = json({ records: all.filter((r) => (!ex || r.exerciseId === rootIn(state, ex)) && (!wo || r.workoutId === wo)) });
    } else if (m === "GET" && (seg = /^\/v1\/progress\/exercises\/([^/]+)$/.exec(p))) {
      const series = D.progressFor(rootIn(state, decodeURIComponent(seg[1])));
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (state.seriesDates) {
        // Spec 17.13 review focus 5: a series whose span crosses a year, served whatever the range asks.
        series.points = series.points.slice(0, state.seriesDates.length).map((pt, i) => ({ ...pt, localDate: state.seriesDates[i] }));
      } else {
        series.points = series.points.filter((pt) => (!from || pt.localDate >= from) && (!to || pt.localDate <= to));
      }
      res = json(series);
    } else if (m === "PATCH" && (seg = /^\/v1\/sets\/([^/]+)$/.exec(p))) {
      // Spec 18.0: an edit-screen save answers the stored set merged with the change.
      const id = decodeURIComponent(seg[1]);
      const set = D.allWorkouts.flatMap((w) => w.exercises.flatMap((e) => e.sets)).find((s) => s.id === id);
      res = set ? json({ ...set, ...JSON.parse(req.postData() ?? "{}"), updatedAt: new Date().toISOString() }) : problem(404, "not-found", "Not found");
    } else if (m === "DELETE" && (seg = /^\/v1\/sets\/([^/]+)$/.exec(p))) {
      // Spec 18.0 AC18: the one-set workout's only set cannot go; the API refuses with workout-would-be-empty.
      const id = decodeURIComponent(seg[1]);
      const owner = D.allWorkouts.find((w) => w.exercises.some((e) => e.sets.some((s) => s.id === id)));
      res = owner?.id === D.ids.oneSet ? problem(409, "workout-would-be-empty", "Workout would be empty") : { status: 204, body: "" };
    } else if (m === "POST" && (seg = /^\/v1\/workout-exercises\/([^/]+)\/sets$/.exec(p))) {
      const b = JSON.parse(req.postData() ?? "{}");
      const we = (state.almostDone ?? D.active).exercises.find((e) => e.id === decodeURIComponent(seg[1]));
      const t = new Date().toISOString();
      const weId = decodeURIComponent(seg[1]);
      const created = {
        id: crypto.randomUUID(), workoutExerciseId: weId, clientGeneratedId: b.clientGeneratedId ?? null,
        setNumber: (we?.sets.length ?? 0) + (state.trackLogged?.[weId]?.length ?? 0) + 1, setType: b.setType ?? "working", reps: b.reps ?? null,
        weight: b.weight ?? null, weightUnit: b.weightUnit ?? null, weightKg: b.weightUnit === "lb" ? b.weight * 0.45359237 : b.weight ?? null,
        distance: b.distance ?? null, distanceUnit: b.distanceUnit ?? null, distanceM: null, durationS: b.durationS ?? null,
        calories: b.calories ?? null, rpe: b.rpe ?? null, isComplete: b.isComplete ?? true, completedAt: t, createdAt: t, updatedAt: t,
      };
      if (state.trackLogged) (state.trackLogged[weId] ??= []).push(created);
      res = json(created, 201);
    } else {
      unmatched.add(`${m} ${p}${url.search}`);
      console.warn(`  UNMATCHED ${m} ${url.pathname}${url.search}`);
      res = problem(404, "not-found", "Not served by the harness");
    }
    await route.fulfill(res);
  };
}

/**
 * Spec 10.6 AC28: the harness's section writes, mutating `w` (the sectioned live workout) in place. Placement and
 * C4 come from @sin/core's own helpers, as the API's do (Spec 09.4 §6.2, §6.5). Returns null for any other request.
 */
/** Spec 09.5: a timer as the server stores it — absent is untimed, a Time Cap sent with no cap reads `capSeconds: null`. */
const storedTimer = (t) => (t === undefined || t === null ? null : t.format === "time_cap" ? { format: "time_cap", capSeconds: t.capSeconds ?? null } : t);

function sectionRoute(w, m, p, raw) {
  const body = JSON.parse(raw ?? "{}");
  const rank = (e) => (e.sectionId === null ? -1 : (w.sections.find((s) => s.id === e.sectionId)?.position ?? -1));
  const place = (row, sectionPosition) => {
    const others = w.exercises.filter((e) => e.id !== row.id).sort((a, b) => a.position - b.position);
    others.splice(insertIndexForSection(others.map(rank), sectionPosition), 0, row);
    w.exercises = others.map((e, i) => ({ ...e, position: i }));
  };
  let seg;
  if (m === "POST" && p === `/v1/workouts/${w.id}/sections`) {
    if (w.sections.length >= 8) return problem(409, "workout-section-limit", "Section limit");
    const section = { id: crypto.randomUUID(), position: w.sections.length, name: String(body.name).trim(), notes: body.notes ?? null, addedInWorkout: true, timer: storedTimer(body.timer), result: null, roundTimes: [] };
    w.sections = [...w.sections, section];
    return json(section, 201);
  }
  // Spec 10.7 Phase C: round times and the result, keyed sets and clears through @sin/core's own rules (as the API's).
  if ((seg = /^\/v1\/workout-sections\/([^/]+)\/round-times\/(\d+)$/.exec(p))) {
    const section = w.sections.find((s) => s.id === decodeURIComponent(seg[1]));
    if (!section) return problem(404, "not-found", "Not found");
    const round = Number(seg[2]);
    if (m === "DELETE") {
      section.roundTimes = section.roundTimes.filter((t) => t.round !== round);
      return { status: 204, body: "" };
    }
    if (section.timer === null) return problem(409, "section-timer-mismatch", "Section timer mismatch");
    const issues = roundTimeIssues(section.timer, section.roundTimes, round, body.seconds);
    if (issues.length > 0) return problem(422, "validation-error", "Validation error");
    section.roundTimes = [...section.roundTimes.filter((t) => t.round !== round), { round, seconds: body.seconds }].sort((a, b) => a.round - b.round);
    return json(section);
  }
  if ((seg = /^\/v1\/workout-sections\/([^/]+)\/result$/.exec(p))) {
    const section = w.sections.find((s) => s.id === decodeURIComponent(seg[1]));
    if (!section) return problem(404, "not-found", "Not found");
    if (m === "DELETE") {
      section.result = null;
      return { status: 204, body: "" };
    }
    if (section.timer === null || section.timer.format === "set_timer") return problem(409, "section-timer-mismatch", "Section timer mismatch");
    if (resultIssues(section.timer, body).length > 0) return problem(422, "validation-error", "Validation error");
    section.result = { rounds: body.rounds ?? null, reps: body.reps ?? null, finishSeconds: body.finishSeconds ?? null, capped: body.capped ?? false };
    return json(section);
  }
  if ((seg = /^\/v1\/workout-sections\/([^/]+)$/.exec(p))) {
    const id = decodeURIComponent(seg[1]);
    const section = w.sections.find((s) => s.id === id);
    if (!section) return problem(404, "not-found", "Not found");
    if (m === "PATCH") {
      // Spec 09.5 AC13, through @sin/core's own rule: a change that drops recorded data needs discardResult.
      let timerPatch = {};
      if ("timer" in body) {
        const next = storedTimer(body.timer);
        if (!timersEqual(section.timer, next)) {
          const keeps = timerChangeKeepsRecorded(section.timer, next, section.roundTimes, section.result);
          if (!keeps && body.discardResult !== true) return problem(409, "section-result-exists", "Section result exists");
          timerPatch = keeps ? { timer: next } : { timer: next, roundTimes: [], result: null };
        }
      }
      Object.assign(section, "name" in body ? { name: String(body.name).trim() } : {}, "notes" in body ? { notes: body.notes } : {}, timerPatch);
      return json(section);
    }
    if (m === "DELETE") {
      w.sections = w.sections.filter((s) => s.id !== id).map((s) => (s.position > section.position ? { ...s, position: s.position - 1 } : s));
      w.exercises = w.exercises.map((e) => (e.sectionId === id ? { ...e, sectionId: null } : e));
      return { status: 204, body: "" };
    }
  }
  if (m === "PATCH" && (seg = /^\/v1\/workout-exercises\/([^/]+)$/.exec(p)) && "sectionId" in body) {
    const exercise = w.exercises.find((e) => e.id === decodeURIComponent(seg[1]));
    if (!exercise) return problem(404, "not-found", "Not found");
    const target = body.sectionId === null ? null : w.sections.find((s) => s.id === body.sectionId);
    if (target === undefined) return problem(404, "not-found", "Not found");
    if (exercise.sectionId !== body.sectionId) place({ ...exercise, sectionId: body.sectionId, supersetGroup: null }, target === null ? -1 : target.position);
    const out = { ...w.exercises.find((e) => e.id === exercise.id) };
    delete out.sets;
    return json(out);
  }
  if (m === "POST" && p === `/v1/workouts/${w.id}/exercises`) {
    const ex = D.exercises.find((e) => e.id === body.exerciseId);
    if (!ex) return problem(404, "not-found", "Not found");
    const target = sectionForNewExercise(w.sections);
    const t = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(), workoutId: w.id, position: w.exercises.length, exerciseId: ex.id, exerciseNameSnapshot: ex.name,
      modalitySnapshot: ex.modality, notes: null, createdAt: t, updatedAt: t, targetSets: null, targetRepsLow: null, targetRepsHigh: null,
      targetRpe: null, restSeconds: null, supersetGroup: null, plannedSets: [], sectionId: target?.id ?? null, sets: [],
    };
    if (target) place(row, target.position);
    else w.exercises = [...w.exercises, row];
    const out = { ...row };
    delete out.sets;
    return json({ ...out, position: w.exercises.find((e) => e.id === row.id).position }, 201);
  }
  return null;
}

// --------------------------------------------------------------- layout evidence
// The app shell is a fixed, full-screen grid whose <main> scrolls (it is the frame, not a pinned layer: the
// pinned checks below stop at it), so window scrolling / Playwright fullPage
// see nothing below the fold. Find the element that actually scrolls and tag it.
async function markScroller(page) {
  return page.evaluate(() => {
    document.querySelectorAll("[data-harness-scroller]").forEach((e) => e.removeAttribute("data-harness-scroller"));
    const modal = [...document.querySelectorAll("dialog")].find((d) => d.open && d.matches(":modal"));
    const scope = modal ?? document;
    let best = document.scrollingElement, extra = best.scrollHeight - best.clientHeight;
    for (const el of scope.querySelectorAll("*")) {
      const oy = getComputedStyle(el).overflowY;
      if (oy !== "auto" && oy !== "scroll") continue;
      const e = el.scrollHeight - el.clientHeight;
      if (e > extra) { best = el; extra = e; }
    }
    best.setAttribute("data-harness-scroller", "");
    return { extra: Math.max(0, extra), tag: best.tagName.toLowerCase() + (best.className ? "." + String(best.className).split(" ")[0] : "") };
  });
}
async function layoutDump(page) {
  return page.evaluate(() => {
    const SEL = "button, [role=button], a, input, select, textarea, summary";
    const modal = [...document.querySelectorAll("dialog")].find((d) => d.open && d.matches(":modal")) ?? null;
    const vw = window.innerWidth, vh = window.innerHeight;
    const scrollH = document.documentElement.scrollHeight;
    const pinnedOf = (el) => {
      for (let n = el; n && n !== document.documentElement && !n.matches("[data-testid=app-shell]"); n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === "fixed" || pos === "sticky") return pos;
      }
      return null;
    };
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      if (el.closest("dialog:not([open])")) return false;
      // Minor 266: a closed <details> draws only its own <summary>; the controls under it are not on screen, though
      // Chromium still reports stale boxes for them (they read as overlaps on the import cards' "More details").
      for (let d = el.closest("details:not([open])"); d; d = d.parentElement?.closest("details:not([open])") ?? null) {
        const summary = d.querySelector(":scope > summary");
        if (!summary || !summary.contains(el)) return false;
      }
      if (modal && !modal.contains(el)) return false;
      return true;
    };
    const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const els = [...document.querySelectorAll(SEL)].filter(isVisible);
    const scEl = document.querySelector("[data-harness-scroller]");
    const sy = scEl && scEl !== document.scrollingElement ? scEl.scrollTop : window.scrollY;

    const inner = scEl && scEl !== document.scrollingElement ? scEl : null;
    const clip = inner ? inner.getBoundingClientRect() : { left: 0, top: 0, right: vw, bottom: vh };
    const items = els.map((el, i) => {
      const r = el.getBoundingClientRect();
      const inScroller = inner ? inner.contains(el) : true;
      // The part actually on screen (inside the scroller's box, if the control lives in it).
      const vl = Math.max(r.left, inScroller ? clip.left : 0), vt = Math.max(r.top, inScroller ? clip.top : 0);
      const vr = Math.min(r.right, inScroller ? clip.right : vw), vb = Math.min(r.bottom, inScroller ? clip.bottom : vh);
      return {
        i,
        tag: el.tagName.toLowerCase() + (el.type && el.tagName === "INPUT" ? `[${el.type}]` : ""),
        text: label(el),
        // x/y: position in the scrolled content (y includes the scroller's scrollTop) — for controls outside
        // the scroller (header, bottom nav) it is the viewport position.
        x: Math.round(r.left), y: Math.round(r.top + (inScroller ? sy : 0)), w: Math.round(r.width), h: Math.round(r.height),
        inScroller,
        visibleNow: vr - vl > 0 && vb - vt > 0,
        _v: { x: vl, y: vt, w: Math.max(0, vr - vl), h: Math.max(0, vb - vt) },
        pinned: pinnedOf(el),
        disabled: el.disabled || el.getAttribute("aria-disabled") === "true" || undefined,
        smallTarget: r.width < 44 || r.height < 44 || undefined,
        // A text input too narrow for its own value (Spec 17.1 AC24: the steppers' numbers must be readable).
        clipped: (el.tagName === "INPUT" && el.scrollWidth > el.clientWidth + 1) || undefined,
        offscreenX: r.left < 0 || r.right > vw + 0.5 || undefined,
      };
    });
    const inter = (a, b) => {
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      return ix > 2 && iy > 2 ? { ix: Math.round(ix), iy: Math.round(iy) } : null;
    };
    // Overlaps between non-pinned controls (ancestor/descendant pairs skipped). Two controls in the same
    // scroll layer compare in content space (whole page); a scroller control vs header/nav compares only the
    // on-screen parts at scroll top. Sticky/fixed controls are covered by pinnedCoverage instead.
    const overlaps = [];
    for (let a = 0; a < els.length; a++) for (let b = a + 1; b < els.length; b++) {
      if (els[a].contains(els[b]) || els[b].contains(els[a])) continue;
      if (items[a].pinned || items[b].pinned) continue;
      const same = items[a].inScroller === items[b].inScroller;
      const o = same ? inter(items[a], items[b]) : inter(items[a]._v, items[b]._v);
      if (o) overlaps.push({ a: `${items[a].tag} "${items[a].text}"`, b: `${items[b].tag} "${items[b].text}"`, overlapPx: [o.ix, o.iy] });
    }
    for (const it of items) delete it._v;
    return { url: location.pathname, viewport: [vw, vh], scrollHeight: scEl ? scEl.scrollHeight : scrollH, scrollerClientHeight: scEl ? scEl.clientHeight : vh, modalOpen: !!modal, count: items.length, items, overlaps };
  });
}

// Fixed/sticky controls vs everything else at each scroll step (what "floats over content").
async function pinnedCoverage(page) {
  const out = [];
  const { total, vh } = await page.evaluate(() => {
    const el = document.querySelector("[data-harness-scroller]") ?? document.scrollingElement;
    return { total: el.scrollHeight, vh: el.clientHeight };
  });
  for (let y = 0; y < Math.max(total - vh, 0) + Math.round(vh * 0.6); y += Math.round(vh * 0.6)) {
    await page.evaluate((yy) => (document.querySelector("[data-harness-scroller]") ?? document.scrollingElement).scrollTo(0, yy), Math.min(y, Math.max(total - vh, 0)));
    await page.waitForTimeout(80);
    const hits = await page.evaluate(() => {
      const modal = [...document.querySelectorAll("dialog")].find((d) => d.open && d.matches(":modal"));
      if (modal) return [];
      const pinnedOf = (el) => {
        for (let n = el; n && n !== document.documentElement && !n.matches("[data-testid=app-shell]"); n = n.parentElement) {
          const pos = getComputedStyle(n).position;
          if (pos === "fixed" || pos === "sticky") return n;
        }
        return null;
      };
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !el.closest("dialog:not([open])"); };
      const txt = (el) => (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const pinnedRoots = new Set();
      for (const el of document.querySelectorAll("body *")) {
        const pos = getComputedStyle(el).position;
        if ((pos === "fixed" || pos === "sticky") && vis(el) && !el.matches("[data-testid=app-shell]")) pinnedRoots.add(el);
      }
      const content = [...document.querySelectorAll("button, [role=button], a, input, select, textarea, h1, h2, h3, p, li, label")]
        .filter((el) => vis(el) && !pinnedOf(el));
      const res = [];
      for (const pin of pinnedRoots) {
        const pr = pin.getBoundingClientRect();
        for (const c of content) {
          if (c.contains(pin)) continue;
          const r = c.getBoundingClientRect();
          const ix = Math.min(pr.right, r.right) - Math.max(pr.left, r.left);
          const iy = Math.min(pr.bottom, r.bottom) - Math.max(pr.top, r.top);
          if (ix > 2 && iy > 2) res.push({ pinned: `${pin.tagName.toLowerCase()}.${String(pin.className).split(" ")[0]} "${txt(pin).slice(0, 40)}"`, covers: `${c.tagName.toLowerCase()} "${txt(c)}"`, overlapPx: [Math.round(ix), Math.round(iy)] });
        }
      }
      return res;
    });
    // Only the leaf-most content matters; drop entries whose covered text is a superset duplicate.
    if (hits.length) out.push({ scrollY: y, hits });
  }
  await page.evaluate(() => (document.querySelector("[data-harness-scroller]") ?? document.scrollingElement).scrollTo(0, 0));
  return out;
}

// --------------------------------------------------------------- screens
const DEVICES = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

async function settle(page) {
  try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch { /* settle anyway */ }
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !/Starting…|Loading/.test(document.body.innerText.slice(0, 200)), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
}

const report = [];
let THEME = "light";

// Spec 17.3 AC19 / AC21 / AC22 / AC24: the front door's composition, measured in the page. Violations go to
// `_report.json` under `frontDoor`.
const frontDoor = [];
// #101: in every shot with an open sheet, the Close icon is centered in its button (to the pixel) — the reset makes an
// svg a block, which a bare <button> puts at its left edge. Each off-center X is reported and fails the run.
const offCenter = [];
// Spec 17.10 AC19: in every shot with an open sheet that has the action row, the row rests on the dialog's bottom edge
// (the viewport's, with the keyboard down), the body ends above it, its buttons are 44 px and unclipped, and no on-screen
// body control is under it. The "sheet row" step adds the keyboard, 320 px, Enter and focus checks. Fails the run.
const sheetRows = [];
const measureSheetRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("dialog[open]")]
      .filter((d) => d.querySelector('button[aria-label="Close"]') && d.querySelector("[data-sheet-actions]"))
      .map((d) => {
        const row = d.querySelector("[data-sheet-actions]");
        const body = d.querySelector("[data-sheet-body]");
        const dr = d.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        const br = body.getBoundingClientRect();
        const keyboard = document.documentElement.getAttribute("data-keyboard") === "open";
        const v = [];
        if (Math.abs(rr.bottom - dr.bottom) > 1) v.push(`row bottom ${rr.bottom.toFixed(1)} is not the dialog's ${dr.bottom.toFixed(1)}`);
        if (!keyboard && Math.abs(dr.bottom - window.innerHeight) > 1) v.push(`dialog bottom ${dr.bottom.toFixed(1)} is not the viewport's ${window.innerHeight}`);
        if (br.bottom > rr.top + 0.5) v.push(`body bottom ${br.bottom.toFixed(1)} is below the row's top ${rr.top.toFixed(1)}`);
        const buttons = [...row.querySelectorAll("button")];
        for (const b of buttons) {
          const r = b.getBoundingClientRect();
          if (r.height < 43.5) v.push(`row button "${b.textContent}" is ${r.height.toFixed(1)} px tall`);
          if (b.scrollWidth > b.clientWidth) v.push(`row button "${b.textContent}" is clipped`);
        }
        for (const el of body.querySelectorAll("button, input, select, textarea, a[href], summary")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          // Scrolled out of the body: not on screen. A center within 1 px of the body's edge is half scrolled out, and a
          // hit test exactly on the edge the row shares can land on either (minor 492's crowded frame put a strip there).
          if (cy < br.top + 1 || cy > br.bottom - 1) continue;
          const hit = document.elementFromPoint(cx, cy);
          if (hit && row.contains(hit)) v.push(`body control "${el.getAttribute("aria-label") ?? (el.textContent?.trim().slice(0, 30) || `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""}`)}" (center y ${cy.toFixed(1)}) is under the row (body ${br.top.toFixed(1)}–${br.bottom.toFixed(1)}, row top ${rr.top.toFixed(1)})`);
        }
        return { title: d.querySelector("h2")?.textContent ?? "", rowTop: rr.top, rowBottom: rr.bottom, dialogBottom: dr.bottom, bodyHeight: br.height, buttons: buttons.map((b) => b.textContent), violations: v };
      })
      // Phase B: every sheet has the row, so an open sheet (it has the header's Close) without one is a violation.
      .concat(
        [...document.querySelectorAll("dialog[open]")]
          .filter((d) => d.querySelector('button[aria-label="Close"]') && !d.querySelector("[data-sheet-actions]"))
          .map((d) => ({ title: d.querySelector("h2")?.textContent ?? "", violations: ["the sheet has no action row"] })),
      ),
  );
async function checkFrontDoor(page, label) {
  const m = await page.evaluate(() => {
    const px = (v) => parseFloat(v) || 0;
    const rootPx = px(getComputedStyle(document.documentElement).fontSize);
    const main = document.querySelector("main");
    const column = main.firstElementChild;
    // By position, not tag: on AuthError (BL-20) the name is a decorative <p> and the h1 sits in the line.
    const [top, foot] = column.children;
    const h1 = top.firstElementChild;
    const line = foot.firstElementChild;
    const control = foot.lastElementChild;
    const vh = window.innerHeight;
    const lines = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    };
    const c = control.getBoundingClientRect(), n = h1.getBoundingClientRect(), l = line.getBoundingClientRect();
    const col = column.getBoundingClientRect();
    const name = getComputedStyle(h1);
    return {
      narrow: window.innerWidth < 48 * rootPx,
      controlTopPct: c.top / vh,
      bottomGap: vh - c.bottom,
      mainPadBottom: px(getComputedStyle(main).paddingBottom),
      lineToControl: c.top - l.bottom,
      // The name's center against the midpoint of the space between the column's top and the hairline.
      nameOffset: (n.top + n.bottom) / 2 - (col.top + l.top) / 2,
      spanLines: [...h1.querySelectorAll("span"), ...line.querySelectorAll(":scope > span")].map(lines),
      hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      nameTop: n.top,
      nameStyle: { stretch: name.fontStretch, weight: name.fontWeight, align: getComputedStyle(column).textAlign },
      space4: rootPx,
      space6: 1.5 * rootPx,
    };
  });
  const violations = [];
  if (m.narrow && m.controlTopPct < 0.85) violations.push(`control top at ${(m.controlTopPct * 100).toFixed(1)}% of the viewport (want >= 85%)`);
  if (m.narrow && Math.abs(m.bottomGap - m.mainPadBottom) > 1) violations.push(`control ${m.bottomGap}px above the bottom, padding is ${m.mainPadBottom}px`);
  if (Math.abs(m.lineToControl - m.space6) > 1) violations.push(`line to control ${m.lineToControl}px (want space-6)`);
  if (Math.abs(m.nameOffset) > m.space4) violations.push(`name ${m.nameOffset.toFixed(1)}px off center`);
  if (m.spanLines.some((n) => n !== 1)) violations.push(`a line span wraps: ${m.spanLines.join(",")}`);
  if (m.hscroll) violations.push("horizontal scroll");
  if (m.nameStyle.stretch !== "75%" || m.nameStyle.weight !== "700" || m.nameStyle.align !== "center") violations.push(`name style ${JSON.stringify(m.nameStyle)}`);
  frontDoor.push({ shot: label, ...m, violations });
  for (const v of violations) console.error(`  FRONT DOOR ${label}: ${v}`);
}
// Spec 17.11 AC2, AC3, AC10: the exercise page at 390 × 844, scrolled to the top: the chart ends above the nav, the
// page doesn't scroll sideways, and a closed "Exercise details" summary is a full tap target. The 320 × 568 step adds
// the narrow checks (overflow and small targets). Violations go to `_report.json` under `exercisePage` and fail the run.
const exercisePage = [];
async function checkExercisePage(page, label, { chart = true } = {}) {
  const m = await page.evaluate(() => {
    document.querySelectorAll("[data-harness-scroller]").forEach((el) => el.scrollTo(0, 0));
    window.scrollTo(0, 0);
    const main = document.querySelector("main");
    const svg = document.querySelector('svg[role="img"]');
    const nav = document.querySelector("nav");
    const summary = document.querySelector("details:not([open]) > summary");
    return {
      viewport: [window.innerWidth, window.innerHeight],
      chartBottom: svg ? svg.getBoundingClientRect().bottom : null,
      navTop: nav ? nav.getBoundingClientRect().top : window.innerHeight,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      summaryHeight: summary ? summary.getBoundingClientRect().height : null,
    };
  });
  const violations = [];
  if (chart && m.chartBottom === null) violations.push("no chart");
  if (chart && m.chartBottom !== null && m.chartBottom > m.navTop + 0.5) violations.push(`chart bottom ${m.chartBottom.toFixed(1)} is below the nav's top ${m.navTop.toFixed(1)}`);
  if (m.mainOverflow > 0 || m.pageOverflow > 0) violations.push(`horizontal overflow (main ${m.mainOverflow}px, page ${m.pageOverflow}px)`);
  if (m.summaryHeight !== null && m.summaryHeight < 43.5) violations.push(`the closed summary is ${m.summaryHeight.toFixed(1)} px tall`);
  exercisePage.push({ shot: label, ...m, violations });
  for (const v of violations) console.error(`  EXERCISE PAGE ${label}: ${v}`);
}
// Spec 17.11 AC11, AC17, AC24 and Review Focus 1, 3: the item sheet's plan rows. Every summary button is a full tap
// target, the sheet doesn't scroll sideways (390 × 844, 1280, and 320 × 568 with a long typed value), Move keeps focus
// on the pressed button in a real browser, and Enter in an open row's Reps submits once. Violations go to
// `_report.json` under `planRows` and fail the run.
const planRows = [];
async function checkPlanRows(page, label, found = {}) {
  const m = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    const summaries = [...(dialog?.querySelectorAll('ol[aria-label="Planned sets"] > li > button') ?? [])];
    const body = dialog?.querySelector("[data-sheet-body]");
    const panels = [...(dialog?.querySelectorAll('ol[aria-label="Planned sets"] [role="group"]') ?? [])];
    return {
      viewport: [window.innerWidth, window.innerHeight],
      summaries: summaries.length,
      openPanels: panels.length,
      shortPanelButtons: panels.flatMap((g) => [...g.querySelectorAll("button")]).map((b) => b.getBoundingClientRect().height).filter((h) => h < 43.5).map((h) => Number(h.toFixed(1))),
      shortSummaries: summaries.map((b) => b.getBoundingClientRect().height).filter((h) => h < 43.5).map((h) => Number(h.toFixed(1))),
      bodyOverflow: body ? body.scrollWidth - body.clientWidth : 0,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  const violations = [];
  if (m.summaries === 0) violations.push("no plan rows in the open sheet");
  if (found.open && m.openPanels !== 1) violations.push(`expected one open row, found ${m.openPanels}`);
  if (m.shortPanelButtons.length) violations.push(`open-row buttons under 44 px: ${m.shortPanelButtons.join(", ")}`);
  if (m.shortSummaries.length) violations.push(`summary buttons under 44 px: ${m.shortSummaries.join(", ")}`);
  if (m.bodyOverflow > 0 || m.pageOverflow > 0) violations.push(`horizontal overflow (sheet body ${m.bodyOverflow}px, page ${m.pageOverflow}px)`);
  if (found.moveFocus !== undefined && !found.moveFocus.startsWith("Move down")) violations.push(`after Move down, focus is on "${found.moveFocus}", not Move down`);
  if (found.enterSubmits !== undefined && found.enterSubmits !== 1) violations.push(`Enter in an open row's Reps submitted ${found.enterSubmits} times (want 1)`);
  if (found.enterOpen !== undefined && found.enterOpen !== 0) violations.push("the item sheet stayed open after Enter in a row's Reps");
  planRows.push({ shot: label, ...m, ...found, violations });
  for (const v of violations) console.error(`  PLAN ROWS ${label}: ${v}`);
}
// Minor 523: in the open row, each edge note ("First set", "Last set") sits beside its own Move button: its center
// within the button's height, and to its right. Minors 520 and 521 (09b): the flagged row's Reps and Weight tops
// match, and the open row's line never says "Check this set". Violations go under `planRows`.
async function checkPlanRowExtras(page, label, { notes = false, invalid = false } = {}) {
  const m = await page.evaluate(() => {
    const group = document.querySelector('dialog[open] ol[aria-label="Planned sets"] [role="group"]');
    const out = { edges: [], tops: null, openSummary: null };
    if (!group) return out;
    for (const button of group.querySelectorAll("button[aria-describedby]")) {
      const note = document.getElementById(button.getAttribute("aria-describedby"));
      if (!note || !/set$/.test(note.textContent ?? "")) continue;
      const b = button.getBoundingClientRect();
      const n = note.getBoundingClientRect();
      out.edges.push({ note: note.textContent, centerInside: n.top + n.height / 2 >= b.top && n.top + n.height / 2 <= b.bottom, rightOf: n.left >= b.right });
    }
    const reps = group.querySelector('input[id$="reps"]')?.getBoundingClientRect();
    const weight = group.querySelector('input[id$="weight"]')?.getBoundingClientRect();
    if (reps && weight) out.tops = [reps.top, weight.top];
    out.openSummary = group.closest("li")?.querySelector(":scope > button")?.textContent ?? null;
    return out;
  });
  const violations = [];
  if (notes) {
    if (m.edges.length === 0) violations.push("minor 523: no edge note in the open row");
    for (const e of m.edges) if (!e.centerInside || !e.rightOf) violations.push(`minor 523: "${e.note}" is not beside its button`);
  }
  if (invalid) {
    if (!m.tops) violations.push("minor 520: the open row has no Reps and Weight");
    else if (Math.abs(m.tops[0] - m.tops[1]) > 0.5) violations.push(`minor 520: Reps top ${m.tops[0].toFixed(1)} vs Weight top ${m.tops[1].toFixed(1)}`);
    if (/Check this set/.test(m.openSummary ?? "")) violations.push("minor 521: the open row's line says Check this set");
  }
  planRows.push({ shot: label, ...m, violations });
  for (const v of violations) console.error(`  PLAN ROWS ${label}: ${v}`);
}
async function shoot(page, device, name, note) {
  await settle(page);
  const dir = path.join(OUT, THEME, device);
  fs.mkdirSync(dir, { recursive: true });
  const base = name;
  const label = `${THEME}/${device}/${name}`;
  await page.screenshot({ path: path.join(dir, `${base}.png`), fullPage: false });
  const sc = await markScroller(page);
  const vs = page.viewportSize();
  if (sc.extra > 0) {
    await page.setViewportSize({ width: vs.width, height: Math.min(vs.height + sc.extra, 12000) });
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: path.join(dir, `${base}-full.png`), fullPage: true });
  if (sc.extra > 0) {
    await page.setViewportSize(vs);
    await page.waitForTimeout(250);
  }
  await markScroller(page);
  const dump = await layoutDump(page);
  dump.scroller = sc.tag;
  const closeOffsets = await page.evaluate(() =>
    [...document.querySelectorAll('dialog[open] button[aria-label="Close"]')].map((button) => {
      const b = button.getBoundingClientRect();
      const i = button.querySelector("svg")?.getBoundingClientRect();
      return i ? { dx: i.left + i.width / 2 - (b.left + b.width / 2), dy: i.top + i.height / 2 - (b.top + b.height / 2) } : null;
    }),
  );
  for (const o of closeOffsets) {
    if (o && (Math.abs(o.dx) > 1 || Math.abs(o.dy) > 1)) {
      offCenter.push({ shot: label, ...o });
      console.error(`  CLOSE OFF CENTER ${label}: dx ${o.dx.toFixed(1)}px, dy ${o.dy.toFixed(1)}px`);
    }
  }
  for (const r of await measureSheetRows(page)) {
    sheetRows.push({ shot: label, ...r });
    for (const v of r.violations) console.error(`  SHEET ROW ${label}: ${v}`);
  }
  // Spec 17.13 AC10: no visible h1 repeats the app header's word (a hidden h1 is a 1 px box).
  const doubled = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="app-shell"] header p')?.textContent?.trim();
    if (!header) return null;
    const h1 = [...document.querySelectorAll("main h1")].find((h) => h.getBoundingClientRect().width > 1 && h.textContent?.trim() === header);
    return h1 ? header : null;
  });
  if (doubled) {
    doubledTitles.push({ shot: label, title: doubled });
    console.error(`  DOUBLED TITLE ${label}: "${doubled}"`);
  }
  dump.pinnedCoverage = await pinnedCoverage(page);
  fs.writeFileSync(path.join(dir, `${base}.layout.json`), JSON.stringify(dump, null, 1));
  // Every enabled control on the page counts, scrolled into view or not (a below-the-fold panel is still the panel).
  const small = dump.items.filter((it) => (it.smallTarget || it.clipped) && !it.disabled).map((it) => `${it.tag} "${it.text}" ${it.w}×${it.h}${it.clipped ? " clipped" : ""}`);
  report.push({ file: `${label}.png`, note, controls: dump.count, overlaps: dump.overlaps.length, pinnedHits: dump.pinnedCoverage.reduce((a, s) => a + s.hits.length, 0), smallTargets: small });
  console.log(`  ${label}: ${dump.count} controls, ${dump.overlaps.length} overlaps, pinned hits ${report.at(-1).pinnedHits}`);
}

async function tryStep(label, fn) {
  try { await fn(); } catch (e) { console.warn(`  SKIPPED ${label}: ${e.message.split("\n")[0]}`); report.push({ file: null, note: `SKIPPED ${label}: ${e.message.split("\n")[0]}` }); }
}

// Spec 17.7 AC2: a Segmented wraps rather than clips or scrolls. Four options sit four across or 2 × 2, never 3 + 1.
const segments = [];
const measureSegments = (page, scope, legend) =>
  page.evaluate(({ scope, legend }) => {
    const root = document.querySelector(scope);
    if (!root) return { missing: `no ${scope}` };
    const group = [...root.querySelectorAll("fieldset")].find((f) => f.querySelector(":scope > legend")?.textContent === legend);
    if (!group) return { missing: `no "${legend}" in ${scope}` };
    const labels = [...group.querySelectorAll("label")];
    // An option's text on more than one line ("Warm- / up") reads as broken even when nothing is clipped.
    const lineCount = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    };
    const wrapped = labels.filter((l) => lineCount(l.querySelector("span") ?? l) > 1).map((l) => l.textContent.trim());
    const tops = labels.map((l) => Math.round(l.getBoundingClientRect().top));
    const rows = [...new Set(tops)];
    const doc = document.documentElement;
    const sheet = document.querySelector("dialog[open]");
    const scrollers = sheet ? [sheet, ...sheet.querySelectorAll("*")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY)) : [];
    const visible = (el) => el.getClientRects().length > 0;
    return {
      perRow: rows.map((t) => tops.filter((top) => top === t).length),
      wrapped,
      hscroll: doc.scrollWidth > doc.clientWidth,
      sheetHscroll: scrollers.some((el) => el.scrollWidth > el.clientWidth),
      clipped: [...document.querySelectorAll("label")].filter((l) => visible(l) && l.scrollWidth > l.clientWidth).map((l) => l.textContent.trim().slice(0, 40)),
    };
  }, { scope, legend });

// Spec 17.4 AC10, AC13, AC17: the workout screen's bar, read in a real browser (jsdom has no layout).
const loggingLoop = [];
const measureLoggingLoop = (page) =>
  page.evaluate(() => {
    const bar = document.querySelector('[data-testid="session-bar"]');
    const status = document.querySelector('[data-testid="session-status"]');
    const scroller = bar.closest("main");
    // ":scope >": Spec 17.5's Undo is the bar's first button in the DOM, one level down.
    const button = bar.querySelector(":scope > button");
    const undo = status.parentElement.querySelector("button");
    const barTop = bar.getBoundingClientRect().top;
    const panel = document.querySelector('form[aria-label^="Log a set of"]');
    const covered = panel
      ? [...panel.querySelectorAll("button, input, select")]
          .filter((c) => c.getClientRects().length > 0)
          .filter((c) => c.getBoundingClientRect().bottom > barTop + 0.5)
          .map((c) => c.getAttribute("aria-label") ?? c.textContent.trim() ?? c.tagName)
      : [];
    return {
      button: button.textContent.trim(),
      buttonTop: Math.round(button.getBoundingClientRect().top),
      buttonHeight: Math.round(button.getBoundingClientRect().height),
      undo: undo ? { width: Math.round(undo.getBoundingClientRect().width), height: Math.round(undo.getBoundingClientRect().height), bottom: Math.round(undo.getBoundingClientRect().bottom) } : null,
      gapToLog: undo ? Math.round(button.getBoundingClientRect().top - undo.getBoundingClientRect().bottom) : null,
      statusHeight: Math.round(status.getBoundingClientRect().height),
      barHeight: Math.round(bar.getBoundingClientRect().height),
      scrollPadding: parseFloat(getComputedStyle(scroller).scrollPaddingBottom),
      covered,
      panelBottom: panel ? Math.round(panel.getBoundingClientRect().bottom) : null,
      barTop: Math.round(barTop),
      scrollTop: Math.round(scroller.scrollTop),
    };
  });

// Spec 17.8 Phase A (AC1, AC2, AC10, AC20): the current-set panel, read in a real browser.
const entryPanel = [];
const measureEntryPanel = (page, scope = 'form[aria-label^="Log a set of"]') =>
  page.evaluate((scope) => {
    const form = document.querySelector(scope);
    if (!form) return { missing: `no ${scope}` };
    const box = (el) => el.getBoundingClientRect();
    const round = (n) => Math.round(n * 10) / 10;
    const rows = [...form.querySelectorAll("[data-stepper-row]")].map((row) => {
      const input = row.querySelector("input");
      const i = box(input);
      const middle = i.top + i.height / 2;
      return {
        label: input.labels?.[0]?.textContent ?? input.getAttribute("aria-label") ?? input.id,
        buttons: [...row.querySelectorAll(":scope > button")].map((b) => {
          const r = box(b);
          return { text: b.textContent, w: round(r.width), h: round(r.height), offset: round(r.top + r.height / 2 - middle) };
        }),
      };
    });
    const small = [...form.querySelectorAll("button, input")]
      .filter((c) => c.getClientRects().length > 0 && !c.disabled)
      .filter((c) => box(c).width < 43.5 || box(c).height < 43.5)
      .map((c) => `${c.tagName.toLowerCase()} "${c.getAttribute("aria-label") ?? c.textContent.trim()}" ${round(box(c).width)}×${round(box(c).height)}`);
    const labelRow = form.firstElementChild;
    const firstRow = form.querySelector("[data-stepper-row]") ?? form.querySelector("input");
    const slot = form.querySelector("[data-rest-slot]");
    const timer = form.querySelector('[role="timer"]');
    return {
      panel: form.getAttribute("aria-label"),
      rows,
      small,
      hscroll: form.scrollWidth > form.clientWidth,
      labelRowHeight: round(box(labelRow).height),
      firstRowOffset: round(box(firstRow).top - box(form).top),
      slotWidth: slot ? round(box(slot).width) : null,
      restState: timer ? timer.getAttribute("data-state") : null,
      // Spec 17.8 Phase B, minors 462–463: a duration's Minutes and Seconds inputs in one stepper row (side by side at
      // every width) and its unit line ("min", "s") with nothing clipped.
      duration: (() => {
        const inputs = [...form.querySelectorAll("[data-stepper-row] input")].filter((i) => /^(Minutes|Seconds)$/.test(i.getAttribute("aria-label") ?? ""));
        const units = [...form.querySelectorAll("[data-duration] [aria-hidden='true'] span")];
        return inputs.length === 2 ? { tops: inputs.map((i) => round(box(i).top)), clipped: units.filter((u) => u.scrollWidth > u.clientWidth + 1).map((u) => u.textContent.trim()) } : null;
      })(),
      dialogHscroll: (() => {
        const dialog = form.closest("dialog");
        return dialog ? dialog.scrollWidth > dialog.clientWidth : false;
      })(),
    };
  }, scope);

// Spec 17.6 AC4, AC20: the summary's record ledger, read in a real browser.
const recordLedger = [];
/** Spec 17.6 AC21: on a 390 × 844 phone, capture 13's records start above the bottom nav (mobile only). */
const summaryFirstScreen = [];
const measureLedger = (page) =>
  page.evaluate(() => {
    const nameOf = (el) => document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent ?? el.getAttribute("aria-label") ?? "";
    const regions = [...document.querySelectorAll("section[aria-labelledby], section[aria-label]")].filter((s) => /record/i.test(nameOf(s)));
    const panel = regions.find((s) => s.querySelector("h2")) ?? null;
    const lifts = panel ? [...panel.querySelectorAll(":scope > ul > li")] : [];
    const lines = panel ? [...panel.querySelectorAll("li [aria-hidden='true']")] : [];
    const main = document.querySelector("main");
    return {
      recordRegions: regions.map(nameOf),
      heading: panel ? panel.querySelector("h2").textContent : null,
      lifts: lifts.length,
      liftsWithoutEstimate: lifts.filter((li) => ![...li.querySelectorAll("[aria-hidden='true']")].some((l) => l.textContent.startsWith("Est. 1-rep max"))).length,
      labels: lines.map((l) => l.firstElementChild?.textContent ?? ""),
      toggle: panel?.querySelector(":scope > button")?.textContent ?? null,
      firsts: [...document.querySelectorAll('ul[aria-label="First time logged"] > li')].map((li) => li.textContent),
      overflowingRows: lines.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent),
      hscroll: main ? main.scrollWidth > main.clientWidth : false,
    };
  });

// Spec 17.7 Phase B (AC16, AC22, Review Focus 4): the decluttered card and its More block, read in a real browser.
const cardDeclutter = [];
// Spec 17.13 AC4b: the other-locale shots, in `_report.json` under `localeChecks`; a violation or an empty list fails the run.
const localeChecks = [];
// Spec 17.13 AC10: shots whose visible h1 repeats the app header's word; any entry fails the run.
const doubledTitles = [];
// Spec 17.13 AC12: the first History row's offset from <main>'s top at 390 × 844. Before Phase B it was 67 px (the
// header's word said again by a visible h1); the page gives back at least 40 px.
const HISTORY_ROW_MAX_OFFSET = 27;
const historyOffsets = [];
// AC22: `form.top − article.top` of the current card in 01-workout-active at 390 × 844, measured on main at 970b06b3
// (Phase A merged, none of Phase B) on 2026-11-09. Phase B must take at least 60 px off it.
const CARD_HEADER_BASE_390 = 204;
const measureCardHeader = (page) =>
  page.evaluate(() => {
    const form = document.querySelector('form[aria-label^="Log a set of"]');
    return Math.round(form.getBoundingClientRect().top - form.closest("article").getBoundingClientRect().top);
  });
/** The current panel's More and the block it reveals (the element after its row), against the bar's top. */
const measureMore = (page) =>
  page.evaluate(() => {
    const more = document.querySelector('form[aria-label^="Log a set of"] button[aria-label^="More set options for"]');
    if (!more) return { missing: "no More button" };
    const open = more.getAttribute("aria-expanded") === "true";
    const block = open ? more.parentElement.nextElementSibling : null;
    return {
      open,
      moreBottom: Math.round(more.getBoundingClientRect().bottom),
      blockBottom: block ? Math.round(block.getBoundingClientRect().bottom) : null,
      barTop: Math.round(document.querySelector('[data-testid="session-bar"]').getBoundingClientRect().top),
    };
  });

const browser = await chromium.launch();
try {
  {
    // Validate every fake payload against the real @sin/core schemas before capturing anything.
    const vp = await browser.newPage();
    await vp.goto(BASE + "/__harness_blank__");
    const failures = await vp.evaluate(async ({ checks, coreSrc }) => {
      const core = await import(coreSrc);
      const bad = [];
      for (const [name, schema, value] of checks) {
        const r = core[schema].safeParse(value);
        if (!r.success) bad.push(`${name}: ${JSON.stringify(r.error.issues.slice(0, 4))}`);
      }
      return bad;
    }, { checks: D.payloadChecks(), coreSrc: CORE_SRC });
    await vp.close();
    if (failures.length) throw new Error(`fake data fails the @sin/core schemas:\n${failures.join("\n")}`);
    console.log(`fake data: ${D.payloadChecks().length} payloads pass the @sin/core schemas`);
  }
  for (const theme of THEMES) for (const [device, opts] of Object.entries(DEVICES)) {
    if (!DEVICE_FILTER.includes(device)) continue;
    THEME = theme;
    console.log(`== ${theme} / ${device}`);
    const state = { active: true };
    const ctx = await browser.newContext({ ...opts, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
    await ctx.route(isSinApi, makeHandler(state));
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(`${device} ${page.url()}: ${msg.text().slice(0, 300)}`); });
    page.on("pageerror", (err) => consoleErrors.push(`${device} ${page.url()}: PAGEERROR ${err.message.slice(0, 300)}`));
    const go = async (p) => { await page.goto(BASE + p); await settle(page); };

    // Active workout and its overlays.
    await go("/app/workouts");
    await shoot(page, device, "01-workout-active", "Workouts tab with the active Push Day session (sections, superset, planned sets)");
    await tryStep("exercise picker", async () => {
      await page.getByRole("button", { name: "Add exercise", exact: true }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "02-exercise-picker", "Add-exercise picker opened from the active session");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    });
    // #206: the keypad up. Chromium has no on-screen keyboard, so this sets what ui/visualViewport.ts would while
    // one covers the bottom 336 px of a 390 × 844 phone; the bar should sit right on it, with no nav. Read the
    // viewport shot: the -full shot keeps the 508 px frame at the top of a taller viewport, which is not a phone.
    if (device === "mobile") {
      await tryStep("keyboard up", async () => {
        await go("/app/workouts");
        await page.getByTestId("session-bar").scrollIntoViewIfNeeded();
        await page.evaluate(() => {
          const root = document.documentElement;
          root.style.setProperty("--app-top", "0px");
          root.style.setProperty("--app-height", "508px");
          root.setAttribute("data-keyboard", "open");
        });
        await shoot(page, device, "01k-workout-keyboard-up", "#206: the session with a keypad up — the frame is the 508 px above it, the nav steps aside, the Log bar sits on the keypad");
        // The next step's go() reloads the page, which clears all three.
      });
    }
    await tryStep("exercise options", async () => {
      await go("/app/workouts");
      await page.locator('button[aria-expanded="false"]').filter({ hasText: /option|more|…/i }).first().click({ timeout: 3000 });
      await shoot(page, device, "04-workout-exercise-options", "Active session with the first exercise's options row expanded");
    });
    await tryStep("end-early dialog", async () => {
      await go("/app/workouts");
      await page.getByRole("button", { name: "Workout menu" }).click();
      await shoot(page, device, "22-workout-menu", "Workout menu open: End workout early and Discard");
      await page.getByRole("button", { name: "End workout early" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "03-end-early-dialog", "End workout early dialog listing the unlogged planned sets");
      await page.keyboard.press("Escape");
    });
    await tryStep("superset mid-alternation", async () => {
      await go("/app/workouts");
      await page.getByRole("article", { name: /^Incline/ }).getByRole("heading", { level: 2 }).getByRole("button").click();
      await page.getByTestId("session-bar").getByRole("button", { name: /^Log / }).click();
      await page.waitForTimeout(400);
      await shoot(page, device, "23-superset-alternation", "After logging Incline DB Press set 1: Lateral Raise is current");
    });
    await tryStep("duration exercise", async () => {
      await go("/app/workouts");
      await page.getByRole("article", { name: "Plank" }).getByRole("heading", { level: 2 }).getByRole("button").click();
      await shoot(page, device, "24-duration-exercise", "Plank current: −5 s / +5 s around the Minutes and Seconds fields (Spec 17.8 AC11)");
    });
    await tryStep("rest running", async () => {
      await go("/app/workouts");
      // Bench Press: two planned warm-ups (no rest), then a working set with a stored 180 s rest.
      const benchHeading = page.getByRole("article", { name: /^Bench/ }).getByRole("heading", { level: 2 }).getByRole("button");
      if (await benchHeading.count()) await benchHeading.click();
      for (let i = 0; i < 3; i += 1) {
        await page.getByTestId("session-bar").getByRole("button", { name: /^Log / }).click();
        await page.waitForTimeout(700); // past the bar's 600 ms double-tap window
      }
      await page.waitForTimeout(1500);
      await page.getByRole("timer").scrollIntoViewIfNeeded();
      await shoot(page, device, "26-rest-running", "A working set logged: Rest m:ss in the panel and the teal line at the top");
      await page.evaluate(() => { try { window.localStorage.removeItem("sin:workout:rest"); } catch { /* storage blocked */ } });
    });
    await tryStep("finish mode", async () => {
      state.done = true;
      await go("/app/workouts");
      await shoot(page, device, "25-finish-mode", "Every planned set logged: the bar reads Finish workout, the panel offers Log extra set");
      await page.getByTestId("session-bar").getByRole("button", { name: "Finish workout" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "03b-finish-dialog", "Finish-workout confirmation dialog");
      await page.keyboard.press("Escape");
      state.done = false;
    });
    // Spec 17.5 AC25: the last planned set just logged, so the bar reads Finish workout with Undo beside the line (AC12).
    await tryStep("undo in finish mode", async () => {
      const last = D.activeDone.exercises.findLastIndex((e) => (e.plannedSets?.length ?? 0) > 0 && e.sets.length > 0);
      state.almostDone = { ...D.activeDone, exercises: D.activeDone.exercises.map((e, k) => (k === last ? { ...e, sets: e.sets.slice(0, -1) } : e)) };
      state.trackLogged = {};
      try {
        await go("/app/workouts");
        await page.getByTestId("session-bar").getByRole("button", { name: /^Log / }).click();
        await page.getByTestId("session-bar").getByRole("button", { name: "Finish workout" }).waitFor({ timeout: 4000 });
        await page.getByTestId("session-bar").getByRole("button", { name: /^Undo set / }).waitFor({ timeout: 4000 });
        await shoot(page, device, "26h-undo-finish-mode", "Spec 17.5 AC12: the last planned set logged: Finish workout, with Undo on the status line");
      } finally {
        state.almostDone = null;
        state.trackLogged = null;
        await page.evaluate(() => { try { window.localStorage.removeItem("sin:workout:rest"); } catch { /* storage blocked */ } });
      }
    });
    // Spec 17.5 AC18: the live sheet's inline confirm.
    await tryStep("delete confirm (live)", async () => {
      state.done = true;
      try {
        await go("/app/workouts");
        await page.locator("article:has(form)").getByRole("listitem").first().getByRole("button").first().click();
        await page.waitForSelector("dialog[open]", { timeout: 4000 });
        await page.getByRole("button", { name: "Delete set" }).click();
        await page.getByRole("button", { name: "Keep set" }).waitFor({ timeout: 4000 });
        await shoot(page, device, "26i-delete-confirm-live", "Spec 17.5 AC18: Delete set asks in place; Keep set has focus");
        await page.keyboard.press("Escape");
      } finally {
        state.done = false;
      }
    });

    // Spec 17.4 AC17: log four sets as a lifter would, with sets that stay. After every log the panel's controls must
    // clear the bar, and the button must not have moved. AC10: a message must not move it either.
    await tryStep("logging loop", async () => {
      state.trackLogged = {};
      const violations = [];
      const steps = [];
      try {
      await go("/app/workouts");
      // Chromium's scroll anchoring holds content still when a row appears above it, which would hide the drift this
      // step exists to catch. Turned off here because the check must not lean on a browser feature the phone may not have.
      await page.evaluate(() => { document.querySelector('[data-testid="session-bar"]').closest("main").style.overflowAnchor = "none"; });
      const before = await measureLoggingLoop(page);
      steps.push({ step: "open", ...before });
      if (before.buttonHeight !== 56) violations.push(`button is ${before.buttonHeight}px tall (want 56)`);
      if (before.statusHeight !== 44) violations.push(`status line is ${before.statusHeight}px tall (want 44)`);
      if (before.scrollPadding < before.barHeight) violations.push(`scroll padding ${before.scrollPadding}px is under the ${before.barHeight}px bar`);
      for (let i = 1; i <= 4; i += 1) {
        const log = page.getByTestId("session-bar").getByRole("button", { name: /^Log / });
        if ((await log.count()) === 0) {
          violations.push(`log ${i}: the bar has no Log button, so the step logged fewer than four sets`);
          break;
        }
        // A click at the button's coordinates, as a thumb does it. Playwright's locator.click() scrolls first, and on a
        // sticky bar that moves the list to the bottom, which would hide what this step measures.
        const box = await log.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(700); // past the bar's 600 ms double-tap window
        const after = await measureLoggingLoop(page);
        steps.push({ step: `log ${i}`, ...after });
        if (after.buttonTop !== before.buttonTop) violations.push(`log ${i}: button top ${after.buttonTop}, was ${before.buttonTop}`);
        if (after.covered.length) violations.push(`log ${i}: under the bar: ${after.covered.join(", ")}`);
        // Spec 17.5 AC3, AC4, AC15.
        if (after.barHeight !== before.barHeight) violations.push(`log ${i}: bar is ${after.barHeight}px tall, was ${before.barHeight}`);
        if (after.undo === null) violations.push(`log ${i}: no Undo was offered`);
        else {
          if (after.undo.width < 44 || after.undo.height < 44) violations.push(`log ${i}: Undo is ${after.undo.width} × ${after.undo.height}px (want at least 44 × 44)`);
          if (after.gapToLog < 8) violations.push(`log ${i}: Undo is ${after.gapToLog}px from Log (want at least 8)`);
        }
      }
      await shoot(page, device, "26b-logging-after-four-logs", "Spec 17.4: after four logs the panel still clears the bar and the button has not moved");
      await shoot(page, device, "26e-undo-offer", "Spec 17.5 AC1: the status line says what was logged, with Undo on its right");
      for (const text of ["1 set not saved yet", "2 sets and 1 note not saved yet"]) {
        await page.evaluate((t) => { document.querySelector('[data-testid="session-status"]').textContent = t; }, text);
        const withMessage = await measureLoggingLoop(page);
        steps.push({ step: text, ...withMessage });
        if (withMessage.buttonTop !== before.buttonTop) violations.push(`"${text}": button top ${withMessage.buttonTop}, was ${before.buttonTop}`);
        if (withMessage.undo === null) violations.push(`"${text}": Undo left the line`);
        if (text === "1 set not saved yet") await shoot(page, device, "26f-undo-sync-message", "Spec 17.5 AC2: a sync message replaces the confirmation; Undo stays");
      }
      await shoot(page, device, "26c-logging-status-message", "Spec 17.4: two unsaved kinds in the reserved status line (minor 427 wording); the button has not moved");
      // AC12: with the keyboard up an empty line gives up its space, and the scroll padding follows; a message keeps its place.
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-keyboard", "open");
        document.querySelector('[data-testid="session-status"]').textContent = "";
      });
      const keyboardEmpty = await measureLoggingLoop(page);
      steps.push({ step: "keyboard up, empty", ...keyboardEmpty });
      if (keyboardEmpty.statusHeight !== 0) violations.push(`keyboard up: an empty status line is ${keyboardEmpty.statusHeight}px tall`);
      if (keyboardEmpty.scrollPadding >= before.scrollPadding) violations.push(`keyboard up: scroll padding stayed ${keyboardEmpty.scrollPadding}px`);
      if (keyboardEmpty.scrollPadding < keyboardEmpty.barHeight) violations.push(`keyboard up: scroll padding ${keyboardEmpty.scrollPadding}px is under the ${keyboardEmpty.barHeight}px bar`);
      await page.evaluate(() => { document.querySelector('[data-testid="session-status"]').textContent = "1 set not saved yet"; });
      const keyboardMessage = await measureLoggingLoop(page);
      steps.push({ step: "keyboard up, message", ...keyboardMessage });
      if (keyboardMessage.statusHeight !== 44) violations.push(`keyboard up: a message's line is ${keyboardMessage.statusHeight}px tall`);
      await page.evaluate(() => { document.documentElement.removeAttribute("data-keyboard"); });
      if (device === "mobile") {
        await page.setViewportSize({ width: 320, height: 568 });
        await page.waitForTimeout(200);
        await shoot(page, device, "26d-logging-320", "Spec 17.4: the workout bar at 320 × 568");
        // Spec 17.5 AC4: the longest line beside Undo must not grow the row and move Log. Minor 427: the true longest,
        // every unsaved kind at once in 17.4 AC11's amended wording (one "not saved yet"), with two-digit counts.
        const narrow = await measureLoggingLoop(page);
        await page.evaluate(() => { document.querySelector('[data-testid="session-status"]').textContent = "12 sets, 2 notes and 2 timer entries not saved yet"; });
        const narrowLong = await measureLoggingLoop(page);
        steps.push({ step: "320 px, long message", ...narrowLong });
        if (narrowLong.undo === null) violations.push("320 px: no Undo beside the longest line, so it measured the wrong case");
        if (narrowLong.buttonTop !== narrow.buttonTop) violations.push(`320 px: a long message moved the button from ${narrow.buttonTop} to ${narrowLong.buttonTop}`);
        if (narrowLong.statusHeight > 44) violations.push(`320 px: a long message grew the line to ${narrowLong.statusHeight}px`);
        await shoot(page, device, "26g-undo-320", "Spec 17.5 AC4: the longest message beside Undo at 320 × 568");
      }
      } catch (e) {
        violations.push(`the step stopped early: ${e.message.split("\n")[0]}`);
      } finally {
        await page.evaluate(() => { document.documentElement.removeAttribute("data-keyboard"); });
        await page.setViewportSize(opts.viewport);
        await page.evaluate(() => { try { window.localStorage.removeItem("sin:workout:rest"); } catch { /* storage blocked */ } });
        state.trackLogged = null;
      }
      loggingLoop.push({ theme, device, steps, violations });
      for (const v of violations) console.error(`  LOGGING LOOP ${theme}/${device}: ${v}`);
    });

    // Spec 17.8 Phase A (AC1, AC2, AC10, AC20): the live panel's steppers, label row and rest, measured in a real browser.
    await tryStep("entry panel", async () => {
      const violations = [];
      const steps = [];
      const sizes = device === "mobile" ? [{ width: 390, height: 844 }, { width: 320, height: 568 }] : [opts.viewport];
      const clearStored = () => page.evaluate(() => { try { window.localStorage.removeItem("sin:workout:rest"); window.localStorage.removeItem("sin:workout:drafts"); } catch { /* storage blocked */ } });
      const checkPanel = (where, m) => {
        steps.push({ step: where, ...m });
        if (m.missing) { violations.push(`${where}: ${m.missing}`); return; }
        if (m.rows.length === 0) violations.push(`${where}: no stepper row`);
        for (const row of m.rows) {
          for (const b of row.buttons) {
            // AC1: each button's vertical center within 1 px of the input's. Minor 462: a duration too, now that its
            // labels sit outside the row.
            if (Math.abs(b.offset) > 1) violations.push(`${where}: ${row.label} "${b.text}" is ${b.offset.toFixed(1)}px off the input's center`);
            // AC2: 56 × 56.
            if (Math.abs(b.w - 56) > 0.5 || Math.abs(b.h - 56) > 0.5) violations.push(`${where}: ${row.label} "${b.text}" is ${b.w} × ${b.h} (want 56 × 56)`);
          }
        }
        // AC20: no target under 44 px, no horizontal overflow.
        for (const s of m.small) violations.push(`${where}: ${s} is under 44 px`);
        if (m.hscroll) violations.push(`${where}: the panel scrolls sideways`);
        if (m.dialogHscroll) violations.push(`${where}: the sheet scrolls sideways`);
      };
      const clippedValue = async (where, scope, label, value) => {
        const input = page.locator(scope).getByLabel(label, { exact: true });
        await input.fill(value);
        const clipped = await input.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        steps.push({ step: `${where} ${value}`, clipped });
        if (clipped) violations.push(`${where}: "${value}" is clipped in ${label}`);
      };
      const openCard = async (name) => {
        const header = page.getByRole("article", { name }).getByRole("heading", { level: 2 }).getByRole("button");
        if (await header.count()) await header.click();
      };
      try {
        for (const size of sizes) {
          await page.setViewportSize(size);
          const at = `${size.width} × ${size.height}`;
          // Weight × reps: the active workout's current panel.
          await clearStored();
          await go("/app/workouts");
          checkPanel(`${at} weight × reps`, await measureEntryPanel(page));
          if (size.width === 320) {
            await page.locator('form[aria-label^="Log a set of"]').scrollIntoViewIfNeeded();
            await shoot(page, device, "01p-panel-320", "Spec 17.8: the live panel at 320 × 568: centered 56 px steppers with their step, the name and set lines");
            // AC2: "102.5" shows in full at 320 px.
            const weight = page.locator('form[aria-label^="Log a set of"]').getByLabel("Weight", { exact: true });
            await weight.fill("102.5");
            const clipped = await weight.evaluate((input) => input.scrollWidth > input.clientWidth + 1);
            steps.push({ step: `${at} 102.5`, clipped });
            if (clipped) violations.push(`${at}: "102.5" is clipped in the weight field`);
          }
          // Spec 17.8 Phase B (AC11, AC20, Review Focus 5), minors 462–463: the Plank's duration steppers. Minutes and
          // Seconds sit side by side at every width (they stacked at 320 px before), "59" shows in full, no unit clips.
          await clearStored();
          await go("/app/workouts");
          await openCard("Plank");
          const plank = await measureEntryPanel(page);
          if (!plank.missing && plank.panel !== "Log a set of Plank") violations.push(`${at} duration: measured "${plank.panel}", not Plank`);
          checkPanel(`${at} duration`, plank);
          if (plank.duration === null || plank.duration === undefined) violations.push(`${at} duration: no Minutes and Seconds in a stepper row`);
          else {
            const [minutesTop, secondsTop] = plank.duration.tops;
            if (Math.abs(minutesTop - secondsTop) > 1) violations.push(`${at} duration: Minutes and Seconds don't share a line at ${size.width} px`);
            for (const unit of plank.duration.clipped) violations.push(`${at} duration: the "${unit}" unit is clipped`);
          }
          await clippedValue(`${at} duration`, 'form[aria-label="Log a set of Plank"]', "Seconds", "59");
          await clippedValue(`${at} duration`, 'form[aria-label="Log a set of Plank"]', "Minutes", "12");
          if (size.width === 320) {
            // Minor 463: on an SE-sized phone the whole Plank panel (Warm-up and More included) fits above the bar once
            // it is scrolled to the top of the list, as a weight × reps panel does.
            await page.locator('form[aria-label="Log a set of Plank"]').evaluate((form) => form.scrollIntoView({ block: "start" }));
            await page.waitForTimeout(150);
            const fit = await measureLoggingLoop(page);
            steps.push({ step: `${at} duration fits above the bar`, covered: fit.covered, panelBottom: fit.panelBottom, barTop: fit.barTop });
            if (fit.covered.length > 0) violations.push(`${at} duration: ${fit.covered.join(", ")} under the bar (panel ends at ${fit.panelBottom}, bar at ${fit.barTop})`);
            await shoot(page, device, "24b-duration-320", "Spec 17.8 AC11, minors 462–463: a Plank at 320 × 568: Time, −5 s / +5 s centered on Minutes and Seconds side by side, the panel above the bar");
          }
          // Calories and the carry: the new-types workout's Echo Bike and Farmer Carry panels.
          state.newTypes = structuredClone(D.activeNewTypes);
          try {
            await clearStored();
            await go("/app/workouts");
            await openCard("Echo Bike");
            const calories = await measureEntryPanel(page);
            if (!calories.missing && calories.panel !== "Log a set of Echo Bike") violations.push(`${at} calories: measured "${calories.panel}", not Echo Bike`);
            checkPanel(`${at} calories`, calories);
            if (size.width === 320) {
              await page.locator('form[aria-label^="Log a set of"]').scrollIntoViewIfNeeded();
              await shoot(page, device, "59b-calories-320", "Spec 17.8: a Calories panel at 320 × 568");
            }
            await openCard("Farmer Carry");
            const carry = await measureEntryPanel(page);
            if (!carry.missing && carry.panel !== "Log a set of Farmer Carry") violations.push(`${at} carry: measured "${carry.panel}", not Farmer Carry`);
            checkPanel(`${at} carry`, carry);
            await clippedValue(`${at} carry`, 'form[aria-label^="Log a set of"]', "Distance (m)", "1000");
            if (size.width === 320) {
              await page.locator('form[aria-label^="Log a set of"]').scrollIntoViewIfNeeded();
              await shoot(page, device, "60b-carry-320", "Spec 17.8 AC12: a carry at 320 × 568: weight and distance steppers, Distance (m)");
            }
          } finally {
            state.newTypes = null;
          }
          // AC16, AC20: the edit sheet's steppers (the edit screen's Add set, copied forward from Bench Press).
          await clearStored();
          await go(`/app/history/${D.ids.latestPush}/edit`);
          await page.getByRole("button", { name: /^Add set to Bench/ }).first().click();
          await page.waitForSelector("dialog[open]", { timeout: 4000 });
          const sheet = await measureEntryPanel(page, "dialog[open] form");
          checkPanel(`${at} edit sheet`, sheet);
          await clippedValue(`${at} edit sheet`, "dialog[open]", "Weight", "102.5");
          await shoot(page, device, size.width === 320 ? "33e-edit-sheet-320" : "33d-edit-sheet-steppers", size.width === 320 ? "Spec 17.8 AC16: the edit sheet at 320 × 568: the same steppers, the unit strip under the weight" : "Spec 17.8 AC16: the edit sheet's steppers, with Set type and the unit strips");
          await page.keyboard.press("Escape");
        }
        // AC10, at 390 px on one panel state: the label row's height and the first stepper row's offset are the same with a
        // rest running, at Ready and with no rest. Each state is read after a reload, so the same panel is current.
        if (device === "mobile") {
          await page.setViewportSize({ width: 390, height: 844 });
          await clearStored();
          await go("/app/workouts");
          const benchHeading = page.getByRole("article", { name: /^Bench/ }).getByRole("heading", { level: 2 }).getByRole("button");
          if (await benchHeading.count()) await benchHeading.click();
          for (let i = 0; i < 3 && (await page.getByRole("timer").count()) === 0; i += 1) {
            await page.getByTestId("session-bar").getByRole("button", { name: /^Log / }).click();
            await page.waitForTimeout(700); // past the bar's 600 ms double-tap window
          }
          const leaveSeconds = (s) => page.evaluate((left) => {
            const raw = window.localStorage.getItem("sin:workout:rest");
            if (raw === null) return false;
            const file = JSON.parse(raw);
            window.localStorage.setItem("sin:workout:rest", JSON.stringify({ ...file, startedAt: Date.now() - (file.durationS - left) * 1000 }));
            return true;
          }, s);
          if (!(await leaveSeconds(90))) throw new Error("no rest started after three logs");
          await go("/app/workouts");
          const running = await measureEntryPanel(page);
          steps.push({ step: "390 rest running", ...running });
          // The widest readout: a 15-minute rest (the 900 s bound) reads "Rest 15:00", which must fit the reserved slot.
          const saved90 = await page.evaluate(() => window.localStorage.getItem("sin:workout:rest"));
          await page.evaluate(() => {
            const file = JSON.parse(window.localStorage.getItem("sin:workout:rest"));
            window.localStorage.setItem("sin:workout:rest", JSON.stringify({ ...file, durationS: 900, startedAt: Date.now() }));
          });
          await go("/app/workouts");
          const longRest = await measureEntryPanel(page);
          steps.push({ step: "390 long rest", ...longRest });
          await page.evaluate((raw) => window.localStorage.setItem("sin:workout:rest", raw), saved90);
          await leaveSeconds(2);
          await go("/app/workouts");
          await page.waitForTimeout(3000);
          const ready = await measureEntryPanel(page);
          steps.push({ step: "390 Ready", ...ready });
          if (ready.restState !== "ready") violations.push(`AC10: after the rest ended the readout is "${ready.restState}" (want ready)`);
          await page.locator('form[aria-label^="Log a set of"]').scrollIntoViewIfNeeded();
          await shoot(page, device, "26j-rest-ready", "Spec 17.8 AC8: the rest ended: a filled Ready at figure size in the panel's label row");
          const savedRest = await page.evaluate(() => window.localStorage.getItem("sin:workout:rest"));
          await clearStored();
          await go("/app/workouts");
          const none = await measureEntryPanel(page);
          steps.push({ step: "390 no rest", ...none });
          if (running.restState !== "running") violations.push(`AC10: the running state read "${running.restState}"`);
          if (none.restState !== null) violations.push(`AC10: the no-rest state read "${none.restState}"`);
          if (longRest.restState !== "running") violations.push(`AC10: the 15-minute rest read "${longRest.restState}"`);
          for (const [name, m] of [["running", running], ["a 15-minute rest", longRest], ["Ready", ready]]) {
            if (m.panel !== none.panel) violations.push(`AC10: ${name} measured "${m.panel}", no rest "${none.panel}"`);
            // A readout wider than the slot's min-width would grow it, narrow the name and could rewrap it.
            if (Math.abs(m.slotWidth - none.slotWidth) > 0.5) violations.push(`AC10: the rest slot is ${m.slotWidth}px with ${name}, ${none.slotWidth}px with no rest`);
            if (Math.abs(m.labelRowHeight - none.labelRowHeight) > 0.5) violations.push(`AC10: label row is ${m.labelRowHeight}px with ${name}, ${none.labelRowHeight}px with no rest`);
            if (Math.abs(m.firstRowOffset - none.firstRowOffset) > 0.5) violations.push(`AC10: steppers start ${m.firstRowOffset}px down with ${name}, ${none.firstRowOffset}px with no rest`);
          }
          // The 320 px capture of a running rest (AC23), on the same panel: the saved rest, restarted 30 s ago.
          await page.setViewportSize({ width: 320, height: 568 });
          await page.evaluate((raw) => {
            if (raw === null) return;
            window.localStorage.setItem("sin:workout:rest", JSON.stringify({ ...JSON.parse(raw), startedAt: Date.now() - 30_000 }));
          }, savedRest);
          await go("/app/workouts");
          await page.getByRole("timer").scrollIntoViewIfNeeded();
          await shoot(page, device, "26k-rest-running-320", "Spec 17.8 AC7: a rest running at 320 × 568: the figure beside the exercise's name");
        }
      } catch (e) {
        violations.push(`the step stopped early: ${e.message.split("\n")[0]}`);
      } finally {
        state.newTypes = null;
        await page.setViewportSize(opts.viewport);
        await clearStored();
      }
      entryPanel.push({ theme, device, steps, violations });
      for (const v of violations) console.error(`  ENTRY PANEL ${theme}/${device}: ${v}`);
    });

    // Spec 18.0 AC49 (Phase B): the live header with and without a took, the Change Time sheet and the "Ends …" line.
    await tryStep("change time (live)", async () => {
      await go("/app/workouts");
      await shoot(page, device, "36-live-header", "Live header: the clock and Workout menu; Started and Change Time on row 2 (Spec 18.0 AC34)");
      await page.getByRole("button", { name: "Change time" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "37-change-time-live", "Change Time sheet on a live workout: Day, Started at, Took, the hint (Spec 18.0 AC30)");
      // An hour ahead, but never past today's 23:59: a time alone is read as today, so 00:30 after 23:30 would be
      // in the past and show no error (minor 13). At 23:59 itself the shot still shows none (accepted, dev tool).
      const ahead = await page.evaluate(() => {
        const now = new Date();
        const d = new Date(now.getTime() + 60 * 60_000);
        if (d.getDate() !== now.getDate()) return "23:59";
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      });
      await page.getByLabel("Started at").fill(ahead);
      await page.getByRole("button", { name: "Save time" }).click();
      await page.waitForTimeout(200);
      await shoot(page, device, "38-change-time-error", "Change Time with a start an hour ahead: The start can't be in the future. (Spec 18.0 AC33)");
      await page.keyboard.press("Escape");
    });
    await tryStep("took and ends", async () => {
      state.planned = true;
      await go("/app/workouts");
      await shoot(page, device, "39-live-header-took", "A back-dated live workout with a took: Took 1 h in place of the clock (Spec 18.0 AC34–AC35)");
      await page.getByRole("button", { name: "Workout menu" }).click();
      await page.getByRole("button", { name: "End workout early" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "40-finish-ends", "End workout early with a took: Ends …, as set in Change Time (Spec 18.0 AC38)");
      await page.keyboard.press("Escape");
      state.planned = false;
    });

    // Spec 10.6 AC28 (Phase A): sections on the live workout — headings with Edit, an empty added section, the line,
    // Add section beside Add exercise, the sheets, the Section select and the remove confirm.
    await tryStep("workout sections (live)", async () => {
      state.sectioned = structuredClone(D.activeSections);
      await go("/app/workouts");
      await shoot(page, device, "52-session-sections", "Live workout with sections: a heading with its note and Edit, an empty added section, the New exercises go into line, Add section beside Add exercise (Spec 10.6 AC1–AC4)");
      await page.getByRole("button", { name: "Add section", exact: true }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "53-section-new-sheet", "New section sheet: Name, Note with its hint, Cancel and Add section (Spec 10.6 AC5)");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const rowing = page.getByRole("article", { name: "Rowing Machine" }).getByRole("heading", { level: 2 }).getByRole("button");
      if (await rowing.count()) await rowing.click(); // collapsed: make it current first
      // exact: Playwright's default name match is a substring, and "More set options for Rowing Machine" holds it (Spec 17.7).
      await page.getByRole("button", { name: "Options for Rowing Machine", exact: true }).click();
      await page.getByRole("article", { name: "Rowing Machine" }).getByLabel("Section").scrollIntoViewIfNeeded();
      await shoot(page, device, "54-section-options-picker", "Options on a card logged before any section existed: the Section select (Spec 10.6 AC9)");
      await page.getByRole("button", { name: "Edit section Strength" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "55-section-edit-sheet", "Edit section sheet: Name and Note prefilled; Remove section, Cancel and Save in the row, no remove line in the body (Spec 10.6 AC7–AC8, minor 498)");
      await page.getByRole("button", { name: "Remove section" }).click();
      await page.getByRole("dialog", { name: "Remove Strength?" }).waitFor({ timeout: 4000 });
      await shoot(page, device, "56-section-remove-confirm", "Remove Strength? confirm, Cancel focused (Spec 10.6 AC8)");
      await page.keyboard.press("Escape");
    });
    state.sectioned = null;
    // Spec 10.6 AC28 (Phase B): the edit screen of a finished workout gets the same controls.
    await tryStep("workout sections (edit)", async () => {
      const w = structuredClone(D.activeSections);
      state.editSectioned = { ...w, endedAt: new Date(Date.parse(w.startedAt) + 20 * 60_000).toISOString() };
      await go(`/app/history/${w.id}/edit`);
      await page.getByRole("region", { name: "Strength" }).scrollIntoViewIfNeeded();
      await shoot(page, device, "57-edit-sections", "Edit screen of a finished workout with sections: headings with Edit, the empty added section, the line, Add exercise and Add section (Spec 10.6 AC17)");
    });
    state.editSectioned = null;
    // Spec 18.1 AC25: the three new types — each live card current, the create form with Calories chosen, a carry's edit sheet.
    await tryStep("new exercise types (live)", async () => {
      state.newTypes = structuredClone(D.activeNewTypes);
      await page.evaluate(() => { try { window.localStorage.clear(); } catch { /* storage blocked */ } });
      const cards = [
        ["Echo Bike", "59-new-type-calories", "Live card for a Calories exercise: the calories stepper (steps of 5), the bar reads Log … cal (Spec 18.1 AC5, AC15)"],
        ["Farmer Carry", "60-new-type-carry", "Live card for a Weight + distance exercise: weight stepper, Distance (m), planned weight prefilled (Spec 18.1 AC7, AC9, AC12)"],
        ["Weighted Sandbag Hold", "61-new-type-hold", "Live card for a Weight + duration exercise: weight stepper, Minutes and Seconds (Spec 18.1 AC8)"],
      ];
      for (const [name, file, note] of cards) {
        await go("/app/workouts");
        const header = page.getByRole("article", { name }).getByRole("heading", { level: 2 }).getByRole("button");
        if (await header.count()) await header.click();
        await page.getByRole("article", { name }).scrollIntoViewIfNeeded();
        await shoot(page, device, file, note);
      }
      await page.getByRole("button", { name: "Add exercise", exact: true }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await page.getByRole("button", { name: "Create a custom exercise" }).click();
      await page.getByRole("radio", { name: "Calories" }).check();
      await page.getByText("Calories only, like an Echo Bike.").scrollIntoViewIfNeeded();
      await shoot(page, device, "62-create-exercise-calories", "Create exercise: all eight types, Calories chosen, its hint under the choices (Spec 18.1 AC1–AC3)");
      await page.keyboard.press("Escape");
    });
    state.newTypes = null;
    await tryStep("new exercise types (edit)", async () => {
      await go(`/app/history/${D.ids.conditioning}/edit`);
      await page.getByRole("article", { name: "Farmer Carry" }).getByRole("button", { name: /24 kg · 40 m/ }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "63-edit-carry-sheet", "Edit screen: a Weight + distance set's sheet, Weight + unit and Distance + unit (Spec 18.1 AC20)");
      await page.keyboard.press("Escape");
    });
    // Spec 17.10 AC6, AC10, AC11, AC19: the sheet row where jsdom can't see it. The set sheet with the keypad up (as 01k
    // fakes it) and at 320 × 568, with a 232 px frame there (Review Focus 5); showModal's first focus; a field reached
    // by Tab is not under the row; Enter submits through the row's Save, and not while it is disabled.
    await tryStep("sheet row", async () => {
      const violations = [];
      const at = `${THEME}/${device}`;
      const openCarry = async () => {
        await go(`/app/history/${D.ids.conditioning}/edit`);
        await page.getByRole("article", { name: "Farmer Carry" }).getByRole("button", { name: /24 kg · 40 m/ }).click();
        await page.waitForSelector("dialog[open] [data-sheet-actions]", { timeout: 4000 });
      };
      const setFrame = (height) =>
        page.evaluate((h) => {
          const root = document.documentElement;
          root.style.setProperty("--app-top", "0px");
          root.style.setProperty("--app-height", `${h}px`);
          root.setAttribute("data-keyboard", "open");
        }, height);
      try {
        await openCarry();
        const first = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
        if (first !== "Close") violations.push(`AC10: first focus is on ${first}, not Close`);
        const names = await page.locator("dialog[open] [data-sheet-actions] button").allTextContents();
        if (names.join("|") !== "Delete set|Cancel|Save") violations.push(`AC14: the row reads ${names.join(", ")}`);
        // AC11: Tab to the body's last control (the one nearest the row); the browser reveals it above the row.
        const last = await page.evaluate(() => {
          const body = document.querySelector("dialog[open] [data-sheet-body]");
          const all = [...body.querySelectorAll("button, input, select, textarea, a[href]")].filter((el) => !el.disabled && el.getBoundingClientRect().width > 0 && (el.type !== "radio" || el.checked));
          return all.length;
        });
        for (let i = 0; i < last + 2; i += 1) {
          await page.keyboard.press("Tab");
          const inRow = await page.evaluate(() => document.querySelector("dialog[open] [data-sheet-actions]").contains(document.activeElement));
          if (inRow) break;
        }
        await page.keyboard.press("Shift+Tab");
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          const row = document.querySelector("dialog[open] [data-sheet-actions]").getBoundingClientRect();
          const r = el.getBoundingClientRect();
          return { name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30), bottom: r.bottom, rowTop: row.top, inBody: !!el.closest("[data-sheet-body]") };
        });
        if (!focused.inBody) violations.push(`AC11: Shift+Tab from the row did not land in the body (${focused.name})`);
        else if (focused.bottom > focused.rowTop + 0.5) violations.push(`AC11: "${focused.name}" ends at ${focused.bottom.toFixed(1)}, under the row's top ${focused.rowTop.toFixed(1)}`);
        if (device === "mobile") {
          const viewport = page.viewportSize();
          try {
            await setFrame(508);
            await shoot(page, device, "33k-sheet-keyboard-up", "Spec 17.10 AC8: the set sheet with a keypad up: the row rests on the 508 px frame's bottom edge");
            await page.setViewportSize({ width: 320, height: 568 });
            await openCarry();
            await shoot(page, device, "63c-sheet-320", "Spec 17.10 AC19: the set sheet at 320 × 568: Delete set, Cancel, Save");
            await setFrame(232);
            const short = await measureSheetRows(page);
            const bodyHeight = short[0]?.bodyHeight ?? 0;
            if (bodyHeight < 88) violations.push(`Review Focus 5: with a 232 px frame at 320 px the body is ${bodyHeight.toFixed(1)} px (want >= 88)`);
            await shoot(page, device, "63d-sheet-320-keyboard", "Spec 17.10 Review Focus 5: the set sheet at 320 px with a 232 px frame: the header and row leave room for a field");
            // Minor 492: a two-line failure and the Delete question on the same frame. The messages stop at what the frame
            // leaves them and scroll with their first line showing; the buttons and part of the body stay. Minor 491: the
            // question is the real confirm's (body size now). The failure is written in by hand first (a failed save can't be
            // staged here), as it would already show when the lifter taps Delete set; then the confirm brings its question
            // into view (final review #1), and its first line must show inside the messages box.
            await page.evaluate(() => {
              const d = document.querySelector("dialog[open]");
              const alert = document.createElement("p");
              alert.setAttribute("role", "alert");
              alert.textContent = "Couldn't save the set — check your connection and try again.";
              d.querySelector("[data-sheet-messages] > :first-child").append(alert);
            });
            await page.locator("dialog[open] [data-sheet-actions]").getByRole("button", { name: "Delete set" }).click();
            await page.waitForTimeout(150);
            const question = await page.evaluate(() => {
              const box = document.querySelector("dialog[open] [data-sheet-messages]").getBoundingClientRect();
              const span = document.querySelector("dialog[open] [data-sheet-status] span");
              if (!span) return null;
              // The first character's box is the first line (the span is a block, so its own rect is every line).
              const range = document.createRange();
              range.setStart(span.firstChild, 0);
              range.setEnd(span.firstChild, 1);
              const first = range.getBoundingClientRect();
              return { top: first.top, bottom: first.bottom, boxTop: box.top, boxBottom: box.bottom };
            });
            if (!question) violations.push("final review #1: no Delete set question in the row");
            // "Shows" means the line's middle is inside the box: a descender or the half-leading may touch its edge.
            else if (question.top < question.boxTop - 0.5 || (question.top + question.bottom) / 2 > question.boxBottom)
              violations.push(`final review #1: the question's first line (${question.top.toFixed(1)}–${question.bottom.toFixed(1)}) is outside the messages box (${question.boxTop.toFixed(1)}–${question.boxBottom.toFixed(1)})`);
            const crowded = (await measureSheetRows(page))[0];
            const crowdedBody = crowded?.bodyHeight ?? 0;
            if (crowdedBody < 64) violations.push(`minor 492: with a notice and a status at 232 px the body is ${crowdedBody.toFixed(1)} px (want >= 64)`);
            const messagesHeight = await page.evaluate(() => document.querySelector("dialog[open] [data-sheet-messages]").getBoundingClientRect().height);
            if (messagesHeight < 18) violations.push(`minor 492: the notice and status show ${messagesHeight.toFixed(1)} px at 232 px (want one line, >= 18)`);
            for (const v of crowded?.violations ?? []) violations.push(`minor 492: ${v}`);
            await shoot(page, device, "63e-sheet-320-keyboard-messages", "Minor 492: a failure and the Delete question at 320 px on a 232 px frame: the messages scroll, the body keeps room");
            await page.evaluate(() => document.querySelector("dialog[open] [data-sheet-messages] > :first-child").replaceChildren());
            await page.locator("dialog[open] [data-sheet-actions]").getByRole("button", { name: "Keep set" }).click();
          } finally {
            await page.setViewportSize(viewport);
          }
        }
        // AC6: Enter submits through the row's primary. A capture-phase counter sees every submit on the page.
        const countSubmits = () => page.evaluate(() => { window.__sheetSubmits = 0; document.addEventListener("submit", () => { window.__sheetSubmits += 1; }, true); });
        state.showTimed = true;
        await go(`/app/workouts/routines/${D.TIMED.id}/edit`);
        await countSubmits();
        await page.getByRole("button", { name: "Edit section Main" }).click({ timeout: 4000 });
        await page.waitForSelector("dialog[open] [data-sheet-actions]", { timeout: 4000 });
        await page.locator("dialog[open]").getByLabel("Name", { exact: true }).press("Enter");
        await page.waitForTimeout(300);
        const sectionSubmits = await page.evaluate(() => window.__sheetSubmits);
        const sectionOpen = await page.locator("dialog[open]").count();
        if (sectionSubmits !== 1) violations.push(`AC6: Enter in the section sheet's Name submitted ${sectionSubmits} times (want 1)`);
        if (sectionOpen !== 0) violations.push("AC6: the section sheet stayed open after Enter");
        state.showTimed = false;
        await go(`/app/exercises`);
        await countSubmits();
        await page.getByRole("button", { name: /New exercise/ }).first().click();
        await page.waitForSelector("dialog[open] [data-sheet-actions]", { timeout: 4000 });
        const name = page.locator("dialog[open]").getByLabel("Name", { exact: true });
        await name.fill("Sled Push");
        await name.press("Enter");
        await page.waitForTimeout(300);
        const createSubmits = await page.evaluate(() => window.__sheetSubmits);
        const createOpen = await page.locator("dialog[open]").count();
        if (createSubmits !== 0) violations.push(`AC6: Enter in the create sheet with no type submitted ${createSubmits} times (want 0)`);
        if (createOpen !== 1) violations.push("AC6: the create sheet closed on Enter with Save disabled");
        await page.keyboard.press("Escape");
        // Phase B Review Focus 3: the picker's last control, "Create a custom exercise", is still reachable above its new
        // Cancel row once the body is scrolled to its end, with the keyboard down and with a 508 px frame.
        await go("/app/workouts");
        await page.getByRole("button", { name: "Add exercise", exact: true }).click();
        await page.waitForSelector("dialog[open] [data-sheet-actions]", { timeout: 4000 });
        for (const frame of [null, 508]) {
          if (frame) await setFrame(frame);
          const end = await page.evaluate(() => {
            const body = document.querySelector("dialog[open] [data-sheet-body]");
            body.scrollTop = body.scrollHeight;
            const create = [...body.querySelectorAll("button")].find((b) => b.textContent?.includes("Create a custom exercise"));
            const row = document.querySelector("dialog[open] [data-sheet-actions]").getBoundingClientRect();
            return create ? { bottom: create.getBoundingClientRect().bottom, rowTop: row.top } : null;
          });
          const where = frame ? `with a ${frame} px frame` : "with the keyboard down";
          if (!end) violations.push(`Review Focus 3: the picker has no "Create a custom exercise" row (${where})`);
          else if (end.bottom > end.rowTop + 0.5) violations.push(`Review Focus 3: the picker's create row ends at ${end.bottom.toFixed(1)}, under the row's top ${end.rowTop.toFixed(1)} (${where})`);
        }
        if (device === "mobile") await shoot(page, device, "02k-picker-end-keyboard-up", "Spec 17.10 Phase B Review Focus 3: the picker scrolled to its end with a 508 px frame: Create a custom exercise sits above the Cancel row");
        await page.keyboard.press("Escape");
      } catch (e) {
        violations.push(`the step stopped early: ${e.message.split("\n")[0]}`);
      } finally {
        state.showTimed = false;
      }
      sheetRows.push({ shot: `${at}/sheet-row-step`, violations });
      for (const v of violations) console.error(`  SHEET ROW ${at}: ${v}`);
    });
    await tryStep("summary sections", async () => {
      await go(`/app/history/${D.ids.latestPush}`);
      await page.getByRole("region", { name: "Main lifts" }).scrollIntoViewIfNeeded();
      await shoot(page, device, "58-summary-sections", "History summary: each section's name and note above its cards, no Edit (Spec 10.6 AC16)");
    });

    // Spec 10.7 AC63 (Phase C): the timed heading with Log result and a queued entry's tag, and the sheet in each format.
    await tryStep("log result heading", async () => {
      state.sectioned = structuredClone(D.activeTimed);
      await go("/app/workouts");
      await page.getByRole("button", { name: "Log result for Main" }).click({ timeout: 4000 });
      await page.getByRole("dialog", { name: "Log result" }).waitFor({ timeout: 4000 });
      await page.locator("dialog[open]").getByLabel("Round 4", { exact: true }).pressSequentially("354");
      state.hangWrites = true; // the PUT stays in flight, so the heading shows the queued entry's tag
      await page.locator("dialog[open]").getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("region", { name: "Main" }).getByText("Not saved yet").waitFor({ timeout: 4000 });
      await page.getByRole("region", { name: "Main" }).scrollIntoViewIfNeeded();
      await shoot(page, device, "92-session-timed-heading", "Live timed section: the plan with its total, the round times, Log result, and Not saved yet for a queued entry (Spec 10.7 AC19, AC39)");
      // Drop the held entry so no later page sends it to a workout the harness no longer serves.
      await page.evaluate(() => { try { window.localStorage.removeItem("sin:workout:outbox"); } catch { /* storage blocked */ } });
    });
    state.hangWrites = false;
    await tryStep("log result sheets", async () => {
      state.sectioned = structuredClone(D.activeTimed);
      await go("/app/workouts");
      await page.getByRole("button", { name: "Log result for Main" }).click({ timeout: 4000 });
      await page.getByRole("dialog", { name: "Log result" }).waitFor({ timeout: 4000 });
      await shoot(page, device, "93-log-result-set-timer", "Log result, Set Timer: one field per round, Next on the first empty one, the live Total (Spec 10.7 AC27, AC28)");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Log result for Finisher" }).click({ timeout: 4000 });
      const amrap = page.locator("dialog[open]");
      await amrap.getByRole("button", { name: "+1, increase rounds" }).click();
      await amrap.getByRole("button", { name: "+1, increase reps" }).click();
      await amrap.getByRole("button", { name: "Add round time" }).click();
      await amrap.getByLabel("Round 1", { exact: true }).pressSequentially("410");
      await shoot(page, device, "94-log-result-amrap", "Log result, AMRAP: Rounds and Reps steppers, the optional round ends with their hint and Add round time (Spec 10.7 AC29)");
      await page.keyboard.press("Escape");
    });
    await tryStep("log result time cap", async () => {
      const w = structuredClone(D.activeTimed);
      w.sections = w.sections.map((s) => (s.name === "Finisher" ? { ...s, timer: { format: "time_cap", capSeconds: 900 } } : s));
      state.sectioned = w;
      await go("/app/workouts");
      await page.getByRole("button", { name: "Log result for Finisher" }).click({ timeout: 4000 });
      const cap = page.locator("dialog[open]");
      await cap.getByLabel("Finish time", { exact: true }).pressSequentially("1420");
      await shoot(page, device, "95-log-result-time-cap", "Log result, Time Cap: Finished with a finish time (Spec 10.7 AC30)");
      await cap.getByRole("radio", { name: "Hit the cap" }).check();
      await cap.getByRole("button", { name: "+1, increase rounds" }).click();
      await shoot(page, device, "95-log-result-time-cap-hit", "Log result, Time Cap: Hit the cap, with Rounds and Reps (Spec 10.7 AC30)");
      await page.keyboard.press("Escape");
    });
    state.sectioned = null;

    // Spec 10.7 AC63 (Phase B): the clear-times confirm on a live timed workout, the summary's timed headings, and
    // History's score lines. The timed workouts are served only here, so every earlier capture is unchanged.
    await tryStep("timer change confirm", async () => {
      state.sectioned = structuredClone(D.activeTimed);
      await go("/app/workouts");
      await page.getByRole("button", { name: "Edit section Main" }).click({ timeout: 4000 });
      const sheet = page.locator("dialog[open]");
      await sheet.getByRole("group", { name: "Timer" }).getByRole("radio", { name: "AMRAP" }).check(); // Spec 17.7: a Segmented
      await sheet.getByLabel("Time limit", { exact: true }).pressSequentially("1200");
      await sheet.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("dialog", { name: "Change Main's timer?" }).waitFor({ timeout: 4000 });
      await shoot(page, device, "96-timer-change-confirm", "Change Main's timer? confirm over the Edit section sheet: Cancel focused, the danger Change and clear (Spec 10.7 AC16)");
      await page.keyboard.press("Escape");
    });
    state.sectioned = null;
    await tryStep("summary timed", async () => {
      await go(`/app/history/${D.finishedTimed.id}`);
      await page.getByRole("region", { name: "Main" }).scrollIntoViewIfNeeded();
      await shoot(page, device, "97-summary-timed", "History summary of a timed workout: each timed section's plan and score, its round times muted, no Log result (Spec 10.7 AC20)");
    });
    await tryStep("history timed", async () => {
      state.historyTimed = true;
      await go("/app/history");
      await page.getByRole("link", { name: /Conditioning/ }).first().scrollIntoViewIfNeeded();
      await shoot(page, device, "98-history-timed", "History with a timed workout: one line per scored timed section under the meta line, wrapping (Spec 10.7 AC21)");
    });
    state.historyTimed = false;

    // No active workout: start screen + routines.
    state.active = false;
    await page.evaluate(() => { try { window.localStorage.clear(); } catch { /* storage blocked */ } });
    await go("/app/workouts");
    await shoot(page, device, "05-workout-start", "Workouts tab with no active workout (Start + routines list, New routine and New from text)");

    await go(`/app/workouts/routines/${D.ids.PUSH_ID}`);
    await shoot(page, device, "06-routine-preview", "Routine preview: Push Day (sections, supersets, planned sets)");
    await go(`/app/workouts/routines/${D.ids.PULL_ID}`);
    await shoot(page, device, "07-routine-preview-simple", "Routine preview: Pull Day (no sections, one superset)");

    await go(`/app/workouts/routines/${D.ids.PUSH_ID}/edit`);
    await shoot(page, device, "08-routine-editor", "Routine editor, edit mode, Push Day");
    await tryStep("routine item sheet", async () => {
      const openBench = async (p) => {
        await p.locator('ul[aria-label^="Exercises"] li button[aria-label]').first().click({ timeout: 4000 });
        await p.waitForSelector("dialog[open] ol[aria-label='Planned sets']", { timeout: 4000 });
        return p.locator("dialog[open]");
      };
      const at = `${THEME}/${device}`;
      let sheet = await openBench(page);
      await shoot(page, device, "09-routine-item-sheet", "Routine editor item sheet for Bench Press: a five-set ramp, every row one closed line (Spec 17.11 AC11, AC15)");
      await checkPlanRows(page, `${at}/09-routine-item-sheet`);
      await sheet.getByRole("button", { name: /^3 · / }).click();
      await shoot(page, device, "09a-item-row-open", "Item sheet with the third set open in place: Type, Reps, Weight, Move up / Move down / Remove (Spec 17.11 AC12)");
      await checkPlanRows(page, `${at}/09a-item-row-open`, { open: true });
      // Minor 523: the first row's "First set" sits beside Move up.
      await sheet.getByRole("button", { name: /^1 · / }).click();
      await shoot(page, device, "09c-item-row-first-open", "Item sheet with set 1 open: 'First set' beside Move up (minor 523)");
      await checkPlanRowExtras(page, `${at}/09c-item-row-first-open`, { notes: true });
      await sheet.getByRole("button", { name: /^3 · / }).click();
      // Review Focus 3: React re-inserts a moved row's node, which blurs the pressed button in Chromium.
      await sheet.getByRole("button", { name: "Move down, set 3" }).click();
      await page.waitForTimeout(100);
      const moveFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "");
      const reps = sheet.getByLabel("Set 4 reps", { exact: true });
      await reps.fill("abc");
      await sheet.locator("[data-sheet-actions]").getByRole("button", { name: "Done" }).click();
      await sheet.getByRole("alert").first().waitFor({ timeout: 4000 });
      await shoot(page, device, "09b-item-row-invalid", "Item sheet after Done with 'abc' in a set's Reps: that row opens with its error (Spec 17.11 AC16)");
      await checkPlanRowExtras(page, `${at}/09b-item-row-invalid`, { invalid: true });
      await page.keyboard.press("Escape");
      await page.waitForSelector("dialog[open]", { state: "detached", timeout: 4000 }).catch(() => {});
      // Review Focus 1: Enter in an open row's Reps submits through the row's Done, once (an untouched sheet).
      await page.evaluate(() => { window.__planSubmits = 0; document.addEventListener("submit", () => { window.__planSubmits += 1; }, true); });
      sheet = await openBench(page);
      await sheet.getByRole("button", { name: /^1 · / }).click();
      await sheet.getByLabel("Set 1 reps", { exact: true }).press("Enter");
      await page.waitForTimeout(300);
      const enterSubmits = await page.evaluate(() => window.__planSubmits);
      const enterOpen = await page.locator("dialog[open]").count();
      sheet = await openBench(page);
      await checkPlanRows(page, `${at}/09-plan-row-focus-and-enter`, { moveFocus, enterSubmits, enterOpen });
      await page.keyboard.press("Escape");
    });
    if (device === "mobile") {
      // Spec 17.11 AC24: the plan rows at 320 × 568 with a long typed value on a closed line.
      await tryStep("plan rows 320", async () => {
        const nctx = await browser.newContext({ ...opts, viewport: { width: 320, height: 568 }, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
        try {
          await nctx.route(isSinApi, makeHandler({ active: false }));
          const np = await nctx.newPage();
          np.setDefaultTimeout(8000);
          await np.goto(BASE + `/app/workouts/routines/${D.ids.PUSH_ID}/edit`);
          await np.locator('ul[aria-label^="Exercises"] li button[aria-label]').first().click();
          const sheet = np.locator("dialog[open]");
          await sheet.getByRole("button", { name: /^3 · / }).click();
          await sheet.getByLabel("Set 3 reps", { exact: true }).fill("as many as I can manage on the day");
          await sheet.getByRole("button", { name: /^3 · / }).click();
          await shoot(np, "mobile-320", "09n-item-row-narrow", "Item sheet at 320 x 568: a closed line with a long typed value wraps inside its row (Spec 17.11 AC11, AC24)");
          await checkPlanRows(np, `${theme}/mobile-320/09n-item-row-narrow`);
          // The open row at 320: four type options, Reps and Weight, three actions and the edge note.
          await sheet.getByRole("button", { name: /^3 · / }).click();
          await shoot(np, "mobile-320", "09o-item-row-narrow-open", "Item sheet at 320 x 568 with the long-valued set open: its panel fits the width (Spec 17.11 AC24)");
          await checkPlanRows(np, `${theme}/mobile-320/09o-item-row-narrow-open`, { open: true });
          await sheet.getByRole("button", { name: /^1 · / }).click();
          await shoot(np, "mobile-320", "09p-item-row-narrow-first", "Item sheet at 320 x 568 with set 1 open: the action row wraps and 'First set' stays beside Move up (minor 523)");
          await checkPlanRowExtras(np, `${theme}/mobile-320/09p-item-row-narrow-first`, { notes: true });
        } finally {
          await nctx.close();
        }
      });
    }

    await go(`/app/workouts/routines/new`);
    await shoot(page, device, "10-routine-new", "Routine editor, create mode (empty)");

    // Spec 10.7 AC63: the section sheet's Timer group in each format, and the timed editor's headers and brackets.
    state.showTimed = true;
    for (const [, slug, label, fill] of [
      ["set_timer", "set-timer", "Set Timer", [["Rounds", "5"], ["Round length", "500"]]],
      ["amrap", "amrap", "AMRAP", [["Time limit", "1200"]]],
      ["time_cap", "time-cap", "Time Cap", []],
    ]) {
      await tryStep(`routine timer sheet ${slug}`, async () => {
        await go(`/app/workouts/routines/${D.TIMED.id}/edit`);
        await page.getByRole("button", { name: "Edit section Main" }).click({ timeout: 4000 });
        const sheet = page.locator("dialog[open]");
        await sheet.getByRole("group", { name: "Timer" }).getByRole("radio", { name: label }).check(); // Spec 17.7: a Segmented
        for (const [field, digits] of fill) {
          await sheet.getByLabel(field, { exact: true }).fill("");
          await sheet.getByLabel(field, { exact: true }).pressSequentially(digits);
        }
        await shoot(page, device, `90-routine-timer-sheet-${slug}`, `Section sheet: the Timer group set to ${label} (Spec 10.7 AC4, AC9)`);
        await page.keyboard.press("Escape");
      });
    }
    await tryStep("routine timed header", async () => {
      await go(`/app/workouts/routines/${D.TIMED.id}/edit`);
      await shoot(page, device, "91-routine-timed-header", "Routine editor: each timed section's plan line under its name, above the note, with the brackets (Spec 10.7 AC9, AC13)");
    });
    state.showTimed = false;

    // Spec 10.5 AC26: a one-off on the list and preview, the Finish dialog's line and box, the list after a finish.
    await tryStep("one-off routines", async () => {
      state.showClass = true;
      await go("/app/workouts");
      await shoot(page, device, "48-routines-one-off", "Routines list: the one-off first, tagged, with from text · until {date} (Spec 10.5 AC1–AC2)");
      await go(`/app/workouts/routines/${D.CLASS.id}`);
      await shoot(page, device, "49-routine-preview-one-off", "One-off preview: the tag, the note above Start, Keep as a routine (Spec 10.5 AC6–AC7)");
      state.active = state.oneOffActive = true;
      await go("/app/workouts");
      await page.getByTestId("session-bar").getByRole("button", { name: "Finish workout" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "50-finish-dialog-one-off", "Finish dialog from a one-off: the line and the unchecked Keep it in my routines (Spec 10.5 AC11)");
      await page.locator("dialog[open]").getByRole("button", { name: "Finish", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "Workout summary" }).waitFor({ timeout: 4000 });
      state.active = state.oneOffActive = false;
      await go("/app/workouts");
      await shoot(page, device, "51-routines-after-finish", "Routines list after that finish: the one-off is gone (Spec 10.5 AC15)");
    });
    state.active = state.oneOffActive = false;
    state.showClass = state.classGone = false;
    state.finishedOneOff = null;

    // Spec 10.4 AC39: routine from text, typed from the committed fixture (the session is in memory: no reloads).
    await tryStep("routine from text", async () => {
      const text = fs.readFileSync(path.join(repoRoot, "packages/core/test/fixtures/hiraya-2026-10-19.txt"), "utf8");
      await go("/app/workouts/routines/import");
      await shoot(page, device, "42-import-paste-empty", "New routine from text: the paste screen, empty (Spec 10.4 AC21)");
      await page.getByLabel("Workout text").fill(text);
      await shoot(page, device, "43-import-paste-filled", "The paste screen with the five screenshots' text (Spec 10.4 AC21)");
      await page.getByRole("button", { name: "Read workout" }).click();
      await page.getByRole("heading", { level: 1, name: "Check exercise names" }).waitFor({ timeout: 4000 });
      await page.locator("fieldset[data-card]").first().waitFor({ timeout: 4000 });
      await shoot(page, device, "44-import-names", "Check exercise names: exact (Push Press), similar and New cards (Spec 10.4 AC24)");
      const hand = page.getByRole("group", { name: "Hand Release Pushups" });
      await hand.getByText("More details").click();
      await shoot(page, device, "45-import-new-details", "A New card with More details open (Spec 10.4 AC26)");
      await hand.getByLabel("Name").fill("Bench Press");
      await hand.getByRole("button", { name: /^Use it instead/ }).waitFor({ timeout: 4000 });
      await shoot(page, device, "46-import-duplicate", "A New name already in the list: Use it instead (Spec 10.4 AC27)");
      await hand.getByLabel("Name").fill("Hand Release Pushups");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { level: 1, name: "New routine" }).waitFor({ timeout: 4000 });
      await shoot(page, device, "47-import-editor", "The editor after import: the info notice and New tags (Spec 10.4 AC30)");
      // The header (its plan line sits under the name), centered below the sticky app bar.
      await page.getByRole("button", { name: "Edit section Second Shift" }).evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shoot(page, device, "99-import-timed-preview-19", "The editor after import: Second Shift reads Time Cap 20:00 (Spec 10.7 AC55, AC63)");
    });
    // Spec 10.7 AC63: the second fixture, MORRO BAY, with the default name choices.
    await tryStep("routine from text, fixture 26", async () => {
      const text = fs.readFileSync(path.join(repoRoot, "packages/core/test/fixtures/hiraya-2026-10-26.txt"), "utf8");
      await go("/app/workouts/routines/import");
      await page.getByLabel("Workout text").fill(text);
      await page.getByRole("button", { name: "Read workout" }).click();
      await page.getByRole("heading", { level: 1, name: "Check exercise names" }).waitFor({ timeout: 4000 });
      await page.locator("fieldset[data-card]").first().waitFor({ timeout: 4000 });
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { level: 1, name: "New routine" }).waitFor({ timeout: 4000 });
      // The header (its plan line sits under the name), centered below the sticky app bar.
      await page.getByRole("button", { name: "Edit section MORRO BAY" }).evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shoot(page, device, "99-import-timed-preview-26", "The editor after import: MORRO BAY reads AMRAP 15:00 (Spec 10.7 AC55, AC63)");
    });

    await go(`/app/workouts/${D.ids.latestPush}`);
    await shoot(page, device, "11-workout-finished", "Finished workout (Push Day, 4 days ago) under the Workouts tab");

    await go("/app/history");
    await shoot(page, device, "12-history", `History list (${D.finished.length} finished workouts: badges with counts, and rows with none)`);
    if (device === "mobile") {
      const offset = await page.evaluate(() => {
        const main = document.querySelector("main")?.getBoundingClientRect();
        const row = document.querySelector('main a[href^="/app/history/"]')?.getBoundingClientRect();
        return main && row ? row.top - main.top : null;
      });
      historyOffsets.push({ offset });
      if (offset === null || offset > HISTORY_ROW_MAX_OFFSET) console.error(`  HISTORY OFFSET: the first row is ${offset} px from main's top (want <= ${HISTORY_ROW_MAX_OFFSET})`);
    }
    await go(`/app/history/${D.ids.latestFinished}`);
    await shoot(page, device, "13-history-detail", "History detail: Lower A, 2 days ago, with PR block");
    if (device === "mobile") {
      // Spec 17.6 AC21 (the finding that started the spec): at 390 × 844 the records start above the bottom nav, on the first screen.
      const firstScreen = { where: "13 records on the first screen at 390 × 844" };
      const violations = [];
      try {
        const box = await page.evaluate(() => {
          // The full-page capture just before leaves the scroller wherever it ended; measure the first screen.
          for (const el of document.querySelectorAll("*")) if (el.scrollTop) el.scrollTop = 0;
          window.scrollTo(0, 0);
          // By the heading that names the section: the screen's own section (named by its h1) also holds the records' h2.
          const region = [...document.querySelectorAll("main section[aria-labelledby]")].find((s) =>
            /record/i.test(document.getElementById(s.getAttribute("aria-labelledby"))?.textContent ?? ""),
          );
          const nav = document.querySelector('nav[aria-label="Primary"]');
          return { records: region ? region.getBoundingClientRect().top : null, nav: nav ? nav.getBoundingClientRect().top : null, viewport: [window.innerWidth, window.innerHeight] };
        });
        Object.assign(firstScreen, box);
        if (box.records === null) violations.push("13: no records region");
        else if (box.nav === null) violations.push("13: no Primary nav");
        else if (box.records >= box.nav) violations.push(`13: the records start at ${Math.round(box.records)} px, below the nav's top at ${Math.round(box.nav)} px`);
      } catch (e) {
        violations.push(`13: the check stopped early: ${e.message.split("\n")[0]}`);
      }
      summaryFirstScreen.push({ theme, device, ...firstScreen, violations });
      for (const v of violations) console.error(`  SUMMARY FIRST SCREEN ${theme}/${device}: ${v}`);
    }
    // #107: Back and the Workout menu lead the summary; open, the menu reveals Edit workout and Delete workout.
    await page.getByRole("button", { name: "Workout menu" }).click();
    await shoot(page, device, "13a-history-detail-menu", "History detail with the Workout menu open: Edit workout and Delete workout (Spec 17.6)");
    // Spec 17.2 AC40, Spec 17.6 AC20: the summary's records in every state, checked as well as captured.
    await tryStep("record ledger summaries", async () => {
      const violations = [];
      const steps = [];
      const read = async (where) => {
        const m = await measureLedger(page);
        steps.push({ where, ...m });
        return m;
      };
      const expect = (ok, text) => { if (!ok) violations.push(text); };
      try {
        await go(`/app/workouts/${D.ids.latestPush}`);
        let m = await read("11 latest push");
        expect(m.heading === "New records on 3 lifts", `11: heading "${m.heading}" (want "New records on 3 lifts")`);
        expect(m.liftsWithoutEstimate === 0, `11: ${m.liftsWithoutEstimate} lift(s) without an est. 1-rep max row`);
        await go(`/app/history/${D.ids.latestFinished}`);
        m = await read("13 history detail");
        expect(m.heading === null || m.heading.startsWith("Record"), `13: heading "${m.heading}" (want "Records from this workout…")`);
        await go(`/app/history/${D.ids.firstWorkout}`);
        m = await read("27 first record");
        expect(m.heading === null, `27: a ledger heading "${m.heading}" on a first-records-only workout`);
        expect(m.firsts.length >= 1, "27: no First time logged line");
        await shoot(page, device, "27-summary-first-record", "The first Push Day: every record it still holds is a first one, so quiet First time logged lines, no panel, no brass (Spec 17.6 AC12)");
        for (const [id, file, note] of [
          [D.ids.noRecords, "28-summary-no-records", "A light day: stats with volume, no records, no brass"],
          [D.ids.volumeOnly, "29-summary-volume-only", "Only a set-volume record: nothing shows, and History shows no badge for it"],
          [D.ids.plankOnly, "30-summary-no-volume", "A plank-only session: three stats, no volume, no records"],
          [D.finishedTimed.id, null, null],
        ]) {
          await go(`/app/history/${id}`);
          m = await read(file ?? "97 timed");
          expect(m.recordRegions.length === 0 && m.firsts.length === 0, `${file ?? "97"}: records shown (${m.recordRegions.join(", ")}${m.firsts.join(", ")})`);
          if (file) await shoot(page, device, file, note);
        }
        await go(`/app/history/${D.ids.conditioning}`);
        m = await read("65 conditioning");
        expect(m.labels.includes("Most calories") && m.labels.includes("Longest distance"), `65: rows ${JSON.stringify(m.labels)} (want Most calories and Longest distance)`);
        await go(`/app/workouts/${D.finishedManyLifts.id}`);
        m = await read("27a many lifts");
        expect(m.heading === "New records on 7 lifts" && m.lifts === 3 && m.toggle === "Show all 7 lifts", `27a: ${m.heading} / ${m.lifts} shown / "${m.toggle}"`);
        await shoot(page, device, "27a-summary-many-lifts", "Spec 17.6 AC11: seven lifts collapse to three behind Show all 7 lifts; the heading counts all seven");
        await page.getByRole("button", { name: "Show all 7 lifts" }).click();
        m = await read("27b many lifts open");
        expect(m.lifts === 7 && m.toggle === "Show fewer", `27b: ${m.lifts} shown / "${m.toggle}"`);
        await shoot(page, device, "27b-summary-many-lifts-open", "Spec 17.6 AC11: expanded, all seven lifts and Show fewer");
        await go(`/app/workouts/${D.finishedMixed.id}`);
        m = await read("27c mixed");
        expect(m.heading === "New records on 2 lifts" && m.firsts.length === 2, `27c: ${m.heading} / ${m.firsts.length} first line(s)`);
        await shoot(page, device, "27c-summary-mixed", "Spec 17.6 AC13: a panel for the two lifts that beat something, then two quiet First time logged lines");
        if (device === "mobile") {
          // AC4: at 320 × 568 nothing clips and nothing scrolls sideways.
          await page.setViewportSize({ width: 320, height: 568 });
          await go(`/app/workouts/${D.finishedManyLifts.id}`);
          await page.getByRole("button", { name: "Show all 7 lifts" }).click();
          m = await read("27d many lifts at 320");
          expect(!m.hscroll && m.overflowingRows.length === 0, `27d: sideways scroll ${m.hscroll}, rows overflowing ${JSON.stringify(m.overflowingRows)}`);
          await shoot(page, device, "27d-summary-ledger-320", "Spec 17.6 AC4: the ledger at 320 × 568, rows wrapping under their labels");
          await go(`/app/history/${D.ids.conditioning}`);
          m = await read("27d conditioning at 320");
          expect(!m.hscroll && m.overflowingRows.length === 0, `27d conditioning: sideways scroll ${m.hscroll}, rows overflowing ${JSON.stringify(m.overflowingRows)}`);
          // D6: the wider chart label fits the Metric group at 320 px.
          await go(`/app/exercises/${D.ids.bench}`);
          const metric = await page.getByRole("group", { name: "Metric" }).evaluate((group) => {
            const chip = [...group.querySelectorAll("button")].find((b) => b.textContent === "Est. 1-rep max");
            return { overflow: group.scrollWidth > group.clientWidth + 1, chip: chip ? chip.scrollWidth > chip.clientWidth + 1 : null };
          });
          steps.push({ where: "metric group at 320", ...metric });
          expect(!metric.overflow, "320: the Metric group overflows");
          expect(metric.chip === false, `320: the Est. 1-rep max chip is ${metric.chip === null ? "missing" : "clipped"}`);
        }
      } catch (e) {
        violations.push(`the step stopped early: ${e.message.split("\n")[0]}`);
      } finally {
        await page.setViewportSize(opts.viewport);
      }
      recordLedger.push({ theme, device, steps, violations });
      for (const v of violations) console.error(`  RECORD LEDGER ${theme}/${device}: ${v}`);
    });

    // Spec 18.0 AC49: the summary's Edit workout, the edit screen, its sheets and the last-set dialog.
    await tryStep("edit past workouts", async () => {
      await go(`/app/history/${D.ids.latestPush}`);
      await page.getByRole("button", { name: "Workout menu" }).click();
      await page.getByRole("button", { name: "Edit workout" }).waitFor();
      await shoot(page, device, "31-summary-edit", "Summary with a title and two-line notes; the Workout menu open on Edit workout (Spec 18.0, 17.6 AC22)");
      await go(`/app/history/${D.ids.latestPush}/edit`);
      await shoot(page, device, "32-edit-screen", "Edit screen: banner, header, Details panel, sectioned cards with a superset, Done (Spec 18.0)");
      await page.getByRole("button", { name: /^Add set to Bench/ }).first().click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "33-edit-add-set", "Add set sheet, copied forward from the last set (Spec 18.0 AC8)");
      // #203: an error under one field must not move the other; the unit select stays beside its value.
      const sheet = page.locator("dialog[open]");
      await sheet.getByLabel("Reps", { exact: true }).fill("");
      await shoot(page, device, "33b-edit-add-set-reps-required", "#203: Reps empty — Required under Reps; Weight, its unit and Reps stay level");
      await sheet.getByLabel("Weight", { exact: true }).fill("");
      await shoot(page, device, "33c-edit-add-set-both-required", "#203: both empty — each Required under its own row; the unit select stays beside the weight");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Edit details" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await page.getByLabel("Title").fill("x".repeat(121));
      await page.getByRole("button", { name: "Save details" }).click();
      await page.waitForTimeout(200);
      await shoot(page, device, "34-edit-details-error", "Details sheet with a too-long title (Spec 18.0 AC53)");
      await page.keyboard.press("Escape");
      await go(`/app/history/${D.ids.oneSet}/edit`);
      await page.getByRole("article").first().getByRole("listitem").first().getByRole("button").click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await page.getByRole("button", { name: "Delete set" }).click();
      await page.getByRole("button", { name: "Keep set" }).waitFor({ timeout: 4000 });
      await shoot(page, device, "35a-edit-delete-confirm", "Spec 17.5 AC18: the edit sheet's inline confirm, before the 409 path");
      await page.getByRole("button", { name: "Delete set" }).click();
      await page.getByRole("dialog", { name: "Delete this whole workout instead?" }).waitFor({ timeout: 4000 });
      await page.waitForTimeout(200);
      await shoot(page, device, "35-edit-last-set", "Delete the only set: Delete this whole workout instead? (Spec 18.0 AC18)");
      await page.keyboard.press("Escape");
      await go(`/app/history/${D.ids.latestPush}/edit`);
      await page.getByRole("button", { name: "Change time" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "41-change-time-edit", "Change Time on a finished workout: Took required, no hint (Spec 18.0 AC40)");
      await page.keyboard.press("Escape");
    });

    // Spec 18.2 AC27: the Exercises tab (All exercises, search, Records) and the exercise page.
    await go("/app/exercises");
    await shoot(page, device, "70-exercises-all", "All exercises: logged first by last-logged date, then Yours / Built in; a copy of a built-in (Spec 18.2 AC8–AC11)");
    await tryStep("All exercises search", async () => {
      await page.getByRole("searchbox", { name: "Search exercises" }).fill("press");
      await shoot(page, device, "71-exercises-search", "All exercises searched for 'press': the count line, order kept (Spec 18.2 AC12)");
      await page.getByRole("searchbox", { name: "Search exercises" }).fill("zercher");
      await shoot(page, device, "72-exercises-search-none", "All exercises with no match: create it, prefilled (Spec 18.2 AC16)");
    });
    await go("/app/exercises/records");
    await shoot(page, device, "14-progress", "Exercises > Records: today's Progress list under the view switch (Spec 18.2 AC5, AC6)");
    // Spec 17.11 Phase A: the chart first, records as name-free rows, then a closed "Exercise details".
    const mobile = device === "mobile";
    await go(`/app/exercises/${D.ids.bench}`);
    await shoot(page, device, "15-progress-bench", "Exercise page: Bench Press (built-in): the chart first, records rows, Exercise details closed (Spec 17.11 AC1–AC3, AC7)");
    if (mobile) await checkExercisePage(page, `${theme}/${device}/15-progress-bench`);
    await tryStep("exercise details open", async () => {
      await page.locator("summary", { hasText: /^Exercise details$/ }).click();
      await page.getByRole("button", { name: "Make your own copy" }).scrollIntoViewIfNeeded();
      await shoot(page, device, "15d-exercise-details-open", "Exercise page: Bench Press with Exercise details open: the table, the note and Make your own copy (Spec 17.11 AC3)");
    });
    await go(`/app/exercises/${D.ids.pullUp}`);
    await shoot(page, device, "16-progress-pullup", "Exercise page: Pull-up (bodyweight, reps metric), chart first (Spec 17.11 AC1)");
    if (mobile) await checkExercisePage(page, `${theme}/${device}/16-progress-pullup`);
    await go(`/app/exercises/${D.ids.pushPress}`);
    await shoot(page, device, "73-exercise-never-logged", "Exercise page: an own exercise never logged: the line, Exercise details open (Spec 18.2 AC22, Spec 17.11 AC4)");
    await go(`/app/exercises/${D.ids.rowingCopy}`);
    await shoot(page, device, "74-exercise-copy", "Exercise page: your copy of a logged built-in, one session so no chart, Edit and Delete under Exercise details (Spec 17.11 AC3)");
    // One logged session draws no chart, so 74 checks overflow and the summary only; 81 (the bench copy) measures a
    // copy's chart.
    if (mobile) await checkExercisePage(page, `${theme}/${device}/74-exercise-copy`, { chart: false });
    if (mobile) {
      // Spec 17.11 AC10 and Review Focus 5: a built-in with a "was" row, a duration in words and a "First record" row,
      // at 320 × 568. No fixture exercise has both kinds, so this context serves Weighted Sandbag Hold's records with
      // its heaviest weight as a first record.
      await tryStep("exercise page 320", async () => {
        const id = D.ids.sandbagHold;
        const records = D.records.filter((r) => r.exerciseId === id).map((r) => (r.recordType === "heaviest_weight" ? { ...r, previousValue: null } : r));
        if (!records.some((r) => r.previousValue === null) || !records.some((r) => r.previousValue !== null)) throw new Error("the 320 records need a was row and a first record");
        const nctx = await browser.newContext({ ...opts, viewport: { width: 320, height: 568 }, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
        await nctx.route(isSinApi, makeHandler({ active: false }));
        // Registered last, so it answers first; any other records read falls through to the fake.
        await nctx.route(
          (u) => isSinApi(u) && u.pathname === "/v1/personal-records" && u.searchParams.get("exerciseId") === id,
          (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ records }) }),
        );
        const np = await nctx.newPage();
        np.setDefaultTimeout(8000);
        await np.goto(BASE + `/app/exercises/${id}`);
        await np.getByText("First record").first().waitFor();
        await np.getByRole("region", { name: "Personal records" }).scrollIntoViewIfNeeded();
        await shoot(np, "mobile-320", "15n-exercise-narrow", "Exercise page at 320 x 568: records rows with was and First record wrap inside the row (Spec 17.11 AC7, AC10)");
        await checkExercisePage(np, `${theme}/mobile-320/15n-exercise-narrow`, { chart: false });
        await nctx.close();
      });
    }
    await tryStep("deleted exercise page and the usage-failed list", async () => {
      // A fresh context whose catalog no longer serves Barbell Curl (its records still do), and whose usage read fails.
      const dctx = await browser.newContext({ ...opts, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
      await dctx.route(isSinApi, makeHandler({ active: false, hideExercise: D.ids.curl, failUsage: true }));
      const dp = await dctx.newPage();
      dp.setDefaultTimeout(8000);
      await dp.goto(BASE + `/app/exercises/${D.ids.curl}`);
      await dp.getByText("This exercise was deleted.", { exact: false }).waitFor();
      await shoot(dp, device, "75-exercise-deleted", "Exercise page: a deleted exercise keeps its history, no details (Spec 18.2 AC24)");
      await dp.goto(BASE + "/app/exercises");
      await dp.getByText("Couldn't load when you last logged these").waitFor();
      await shoot(dp, device, "76-exercises-usage-failed", "All exercises when the usage read fails: A–Z, type-only lines, Try again (Spec 18.2 AC14)");
      await dctx.close();
    });
    if (device === "mobile") {
      await tryStep("600 exercises", async () => {
        const mctx = await browser.newContext({ ...opts, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
        await mctx.route(isSinApi, makeHandler({ active: false, catalog: D.manyExercises(600) }));
        const mp = await mctx.newPage();
        mp.setDefaultTimeout(8000);
        await mp.goto(BASE + "/app/exercises");
        await mp.getByRole("link", { name: /^Exercise 600/ }).waitFor();
        await shoot(mp, device, "77-exercises-600", "All exercises with 600 rows, not virtualized (Spec 18.2 AC18, D8)");
        await mctx.close();
      });
    }
    // Spec 18.2 AC55: Edit, Make your own copy and Delete, in a context whose catalog holds the lifter's copy of
    // Bench Press and whose routines (the one-off class among them) use it.
    await tryStep("manage exercises (edit, copy, delete)", async () => {
      const ms = { active: false, catalog: [...D.exercises, D.benchCopy], routines: D.routinesWithBenchCopy };
      const xctx = await browser.newContext({ ...opts, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
      await xctx.route(isSinApi, makeHandler(ms));
      const xp = await xctx.newPage();
      xp.setDefaultTimeout(8000);
      const open = async (id) => {
        await xp.goto(BASE + `/app/exercises/${id}`);
        await settle(xp);
      };
      // Spec 17.11 AC3: the actions sit in "Exercise details", closed on a logged exercise's page.
      const openDetails = async () => {
        const summary = xp.locator("summary", { hasText: /^Exercise details$/ });
        if (!(await summary.evaluate((s) => s.parentElement.open))) await summary.click();
      };
      const editSheet = () => xp.getByRole("dialog", { name: "Edit exercise" });
      const deleteDialog = (name) => xp.getByRole("dialog", { name: `Delete ${name}?` });

      await open(D.ids.pushPress);
      await shoot(xp, device, "80-exercise-own", "Exercise page: an own exercise, never logged, so Exercise details is open with Edit and Delete exercise (Spec 18.2 AC34, Spec 17.11 AC4)");
      // The catalog holds the lifter's copy of Bench Press, so the built-in's page lands on the copy (18.2 AC19).
      await open(D.ids.bench);
      await shoot(xp, device, "81-exercise-builtin", "Exercise page: Bench Press, which lands on the lifter's copy: chart first, Edit and Delete under a closed Exercise details (Spec 17.11 AC2, AC3)");
      if (device === "mobile") await checkExercisePage(xp, `${theme}/${device}/81-exercise-builtin`);

      await open(D.ids.pushPress);
      await openDetails();
      await xp.getByRole("button", { name: "Edit" }).click();
      await editSheet().waitFor();
      await shoot(xp, device, "82-edit-unlogged", "Edit sheet, never logged: all eight types enabled, the rename note (Spec 18.2 AC35, AC37, AC40)");
      await xp.keyboard.press("Escape");

      await open(D.benchCopy.id);
      await openDetails();
      await xp.getByRole("button", { name: "Edit" }).click();
      await editSheet().getByText("can only change to").waitFor();
      await shoot(xp, device, "83-edit-locked", "Edit sheet with logged sets: the other types disabled and muted, the note (Spec 18.2 AC37)");
      await editSheet().getByRole("radio", { name: "Weighted bodyweight" }).check();
      await editSheet().getByText("counts only the added weight", { exact: false }).scrollIntoViewIfNeeded();
      await shoot(xp, device, "84-edit-weight-note", "Edit sheet: Weighted bodyweight selected, the weight-meaning note (Spec 18.2 AC39)");
      await xp.keyboard.press("Escape");

      ms.typeLocked = true;
      await open(D.ids.pushPress);
      await openDetails();
      await xp.getByRole("button", { name: "Edit" }).click();
      await editSheet().getByRole("radio", { name: "Calories" }).check();
      await editSheet().getByRole("button", { name: "Save" }).click();
      await editSheet().getByText("already has logged sets", { exact: false }).waitFor();
      await shoot(xp, device, "85-edit-type-locked", "Edit sheet after 409 exercise-type-locked: the type reset, the error (Spec 18.2 AC41)");
      await xp.keyboard.press("Escape");
      ms.typeLocked = false;

      await open(D.benchCopy.id);
      await openDetails();
      await xp.getByRole("button", { name: "Delete exercise" }).click();
      await deleteDialog(D.benchCopy.name).getByText("Used in", { exact: false }).waitFor();
      await shoot(xp, device, "86-delete-routines", "Delete dialog naming two routines, one of them one-off, and the built-in coming back (Spec 18.2 AC47, AC49)");
      await xp.keyboard.press("Escape");

      await open(D.ids.pushPress);
      await openDetails();
      await xp.getByRole("button", { name: "Delete exercise" }).click();
      await deleteDialog("Push Press").getByText("Past workouts keep their sets", { exact: false }).waitFor();
      await shoot(xp, device, "87-delete-none", "Delete dialog with no routines (Spec 18.2 AC47)");
      await xp.keyboard.press("Escape");

      ms.failRoutines = true;
      await open(D.ids.pushPress);
      await openDetails();
      await xp.getByRole("button", { name: "Delete exercise" }).click();
      await deleteDialog("Push Press").getByText("Couldn't check which routines", { exact: false }).waitFor();
      await shoot(xp, device, "88-delete-check-failed", "Delete dialog when the routines check fails: Try again, Delete disabled (Spec 18.2 AC48)");
      await xp.keyboard.press("Escape");
      ms.failRoutines = false;

      const deadlift = D.exercises.find((e) => e.name === "Deadlift");
      await open(deadlift.id);
      await openDetails();
      await xp.getByRole("button", { name: "Make your own copy" }).click();
      await xp.getByText("Your copy is ready.", { exact: false }).waitFor();
      await shoot(xp, device, "89-exercise-copied", "The copy's page after Make your own copy: the status line (Spec 18.2 AC43)");
      await xctx.close();
    });
    // Spec 18.1 AC35: the new types' records and charts.
    await tryStep("new exercise types (records and charts)", async () => {
      await go("/app/exercises/records");
      await page.getByRole("link", { name: /Echo Bike/ }).first().scrollIntoViewIfNeeded();
      await shoot(page, device, "64-progress-new-types", "Progress list rows for the new types: Most calories, Longest distance, Longest hold headlines (Spec 18.1 AC28, AC30)");
      await go(`/app/history/${D.ids.conditioning}`);
      await page.getByText("Most calories").first().scrollIntoViewIfNeeded();
      await shoot(page, device, "65-summary-new-type-records", "Workout summary ledger: Most calories and a carry's Heaviest weight and Longest distance rows, meters as m (Spec 18.1 AC29, Spec 17.6 AC7)");
      const charts = [
        [D.ids.echoBike, "66-progress-calories", "Progress chart: Echo Bike, Calories metric, integer ticks (Spec 18.1 AC31, AC32)"],
        [D.ids.farmerCarry, "67-progress-carry", "Progress chart: Farmer Carry, Top set and Distance chips (Spec 18.1 AC31)"],
        [D.ids.sandbagHold, "68-progress-hold", "Progress chart: Weighted Sandbag Hold, Top set and Time chips (Spec 18.1 AC31)"],
      ];
      for (const [id, file, note] of charts) {
        await go(`/app/exercises/${id}`);
        await shoot(page, device, file, note);
      }
      await page.getByRole("group", { name: "Metric" }).getByRole("button", { name: "Time" }).click();
      await shoot(page, device, "69-progress-hold-time", "Progress chart: Weighted Sandbag Hold, Time metric in seconds, readout in words (Spec 18.1 AC32)");
    });

    await go("/app/profile");
    await shoot(page, device, "17-profile", "Profile: settings form, export, sign out, delete account");
    // Spec 17.7 AC27 (Phase A): the two shared controls where they replaced a select.
    await page.getByRole("group", { name: "Units" }).scrollIntoViewIfNeeded();
    await shoot(page, device, "s177a-profile-segmented", "Spec 17.7: Profile Units as a two-option Segmented; Time zone as a Select");
    await tryStep("picker select", async () => {
      state.active = true;
      await go("/app/workouts");
      await page.getByRole("button", { name: "Add exercise", exact: true }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await page.getByRole("combobox", { name: "Muscle" }).waitFor({ timeout: 4000 });
      await shoot(page, device, "s177a-picker-select", "Spec 17.7 AC7: the picker's Muscle and Equipment filters as inline Selects (6 px, chevron)");
      await page.keyboard.press("Escape");
      state.active = false;
    });
    // Spec 17.7 AC2: the four-option Set type in the panel, the edit sheet and a routine plan row, measured at 390 × 844
    // and 320 × 568 on the phone (desktop measures at its own width). A step that never reports fails the run.
    await tryStep("segmented widths", async () => {
      const steps = [];
      const violations = [];
      const sizes = device === "mobile" ? [{ width: 390, height: 844 }, { width: 320, height: 568 }] : [opts.viewport];
      const check = (where, size, m, rule) => {
        steps.push({ where, width: size.width, ...m });
        if (m.missing) return violations.push(`${where} at ${size.width}: ${m.missing}`);
        if (m.hscroll) violations.push(`${where} at ${size.width}: the page scrolls sideways`);
        if (m.sheetHscroll) violations.push(`${where} at ${size.width}: the sheet scrolls sideways`);
        for (const label of m.clipped) violations.push(`${where} at ${size.width}: "${label}" is clipped`);
        for (const label of m.wrapped) violations.push(`${where} at ${size.width}: "${label}" wraps to two lines`);
        const rows = m.perRow.join("+");
        if (rule === "two" && rows !== "2+2") violations.push(`${where} at ${size.width}: Set type is ${rows}, want 2 × 2`);
        if (rows === "3+1") violations.push(`${where} at ${size.width}: Set type is 3 + 1`);
      };
      state.active = true;
      try {
        for (const size of sizes) {
          await page.setViewportSize(size);
          const narrow = size.width === 320;
          // At 390 the panel (294 px) is under the four-across width, so 2 × 2; the sheets are wide enough for four.
          const rule = size.width <= 390 ? "two" : null;

          await go("/app/workouts");
          // Spec 17.7 Phase B: Set options became More ("More set options for {exercise}").
          await page.getByRole("button", { name: /^More set options for / }).first().click({ timeout: 4000 });
          await page.waitForTimeout(200);
          check("panel", size, await measureSegments(page, 'form[aria-label^="Log a set of"]', "Set type"), rule);
          if (!narrow) await shoot(page, device, "s177a-set-options-segmented", "Spec 17.7 AC6: Set options with Set type (2 × 2 in the 390 px panel) and Weight unit as Segmented");

          await go(`/app/history/${D.ids.latestPush}/edit`);
          await page.getByRole("button", { name: /^Add set to Bench/ }).first().click({ timeout: 4000 });
          await page.waitForSelector("dialog[open]", { timeout: 4000 });
          await page.waitForTimeout(200);
          check("edit sheet", size, await measureSegments(page, "dialog[open]", "Set type"), narrow ? "two" : null);
          await page.keyboard.press("Escape");

          await go(`/app/workouts/routines/${D.ids.PUSH_ID}/edit`);
          await page.locator('ul[aria-label^="Exercises"] li button[aria-label]').first().click({ timeout: 4000 });
          await page.waitForSelector("dialog[open]", { timeout: 4000 });
          // Spec 17.11: a loaded plan opens with every row closed; open set 1 to measure its type.
          await page.locator("dialog[open]").getByRole("button", { name: /^1 · / }).click({ timeout: 4000 });
          await page.waitForTimeout(200);
          check("plan row", size, await measureSegments(page, "dialog[open]", "Set 1 type"), narrow ? "two" : null);
          await shoot(page, device, `s177a-plan-row-segmented${narrow ? "-320" : ""}`, `Spec 17.7 AC6: a routine plan row's Set type across the row, Weight unit above the rows${narrow ? ", at 320 × 568 (2 × 2)" : ""}`);
          await page.keyboard.press("Escape");
        }
        if (steps.length !== sizes.length * 3) violations.push(`measured ${steps.length} of ${sizes.length * 3} surfaces`);
      } catch (e) {
        violations.push(`the step stopped early: ${e.message.split("\n")[0]}`);
      } finally {
        await page.setViewportSize(opts.viewport);
        state.active = false;
      }
      segments.push({ theme, device, steps, violations });
      for (const v of violations) console.error(`  SEGMENTED ${theme}/${device}: ${v}`);
    });
    // Spec 17.7 Phase B: AC22 (the card's header is at least 60 px shorter at 390), AC16 (More's block clears the bar
    // at 390 × 844 and 320 × 568), Review Focus 4 (a log with More open keeps the loop's guarantees; the reveal clears
    // the bar with the keypad up) and the AC27 shots. Taps go by coordinates, as in the logging loop: locator.click()
    // scrolls a sticky bar's list first. A step that never reports fails the run.
    await tryStep("card and more", async () => {
      const steps = [];
      const violations = [];
      const sizes = device === "mobile" ? [{ width: 390, height: 844 }, { width: 320, height: 568 }] : [opts.viewport];
      const panelButton = (name) => page.locator('form[aria-label^="Log a set of"]').getByRole("button", { name });
      const tap = async (locator) => {
        // Only a control the bar hides is brought up first; a thumb would scroll to it too.
        const hidden = await locator.evaluate((el) => el.getBoundingClientRect().bottom > document.querySelector('[data-testid="session-bar"]').getBoundingClientRect().top);
        if (hidden) {
          await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
          await page.waitForTimeout(250);
        }
        const box = await locator.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(500);
      };
      const openMoreAndCheck = async (where) => {
        await tap(panelButton(/^More set options for /));
        const m = await measureMore(page);
        steps.push({ step: where, ...m });
        if (m.missing) violations.push(`${where}: ${m.missing}`);
        else if (!m.open) violations.push(`${where}: More did not open`);
        else if (m.blockBottom > m.barTop) violations.push(`${where}: More's block ends at ${m.blockBottom}, under the bar at ${m.barTop}`);
      };
      state.active = true;
      try {
        for (const size of sizes) {
          await page.setViewportSize(size);
          const narrow = size.width === 320;
          const suffix = narrow ? "-320" : "";
          const at = `${size.width} × ${size.height}`;
          await go("/app/workouts");
          await page.evaluate(() => { document.querySelector('[data-testid="session-bar"]').closest("main").style.overflowAnchor = "none"; });
          if (size.width === 390) {
            const header = await measureCardHeader(page);
            steps.push({ step: `header at ${at}`, header, base: CARD_HEADER_BASE_390 });
            if (header > CARD_HEADER_BASE_390 - 60) violations.push(`AC22: the card's header is ${header}px at ${at}, want ≤ ${CARD_HEADER_BASE_390 - 60}`);
          }
          await shoot(page, device, `s177b-panel-more-closed${suffix}`, `Spec 17.7 AC12, AC21: the current card with Warm-up and More, no type line, no note row${narrow ? ", at 320 × 568" : ""}`);
          await openMoreAndCheck(`More at ${at}`);
          await shoot(page, device, `s177b-panel-more-open${suffix}`, `Spec 17.7 AC13, AC16: More open, its block above the bar${narrow ? ", at 320 × 568" : ""}`);
          await tap(panelButton(/^Warm-up for /));
          await shoot(page, device, `s177b-panel-warmup-pressed${suffix}`, `Spec 17.7 AC12, AC17: Warm-up pressed: filled, a check, the label names the type${narrow ? ", at 320 × 568" : ""}`);
          await page.locator("article:has(form)").getByRole("button", { name: /^Options for / }).click();
          // The click scrolls the card's header into view; bring up the list it opened (Move up … Superset … Section).
          await page.locator("article:has(form)").getByRole("button", { name: "Remove exercise" }).evaluate((el) => el.parentElement.scrollIntoView({ block: "center" }));
          await page.waitForTimeout(300);
          await shoot(page, device, `s177b-card-options-open${suffix}`, `Spec 17.7 AC19, AC20: Options with Move, Remove, Add note and the Superset toggles${narrow ? ", at 320 × 568" : ""}`);

          // Review Focus 4: with the keypad up the scroll padding is compact; the reveal must still clear the bar. The phone
          // at 390 × 844 only, faked as 01k does (a 508 px frame above a 336 px keypad); a desktop has no keypad, and at
          // 568 px tall the frame left above one could not hold the panel at all.
          await page.evaluate(() => { try { window.localStorage.removeItem("sin:workout:drafts"); } catch { /* storage blocked */ } });
          if (device === "mobile" && size.width === 390) {
            await go("/app/workouts");
            await page.evaluate(() => {
              const root = document.documentElement;
              document.querySelector('[data-testid="session-bar"]').closest("main").style.overflowAnchor = "none";
              root.style.setProperty("--app-top", "0px");
              root.style.setProperty("--app-height", "508px");
              root.setAttribute("data-keyboard", "open");
            });
            await page.waitForTimeout(250);
            await openMoreAndCheck(`More at ${at}, keypad up`);
            await page.evaluate(() => {
              const root = document.documentElement;
              root.removeAttribute("data-keyboard");
              root.style.removeProperty("--app-top");
              root.style.removeProperty("--app-height");
            });
          }

          // Review Focus 4: a log with More open: the button stays put and nothing in the panel is under the bar.
          state.trackLogged = {};
          await go("/app/workouts");
          await page.evaluate(() => { document.querySelector('[data-testid="session-bar"]').closest("main").style.overflowAnchor = "none"; });
          await openMoreAndCheck(`More at ${at}, before a log`);
          const before = await measureLoggingLoop(page);
          const log = page.getByTestId("session-bar").getByRole("button", { name: /^Log / });
          const box = await log.boundingBox();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(700); // past the bar's 600 ms double-tap window
          const after = await measureLoggingLoop(page);
          steps.push({ step: `log with More open at ${at}`, before: before.buttonTop, after: after.buttonTop, covered: after.covered });
          if (after.buttonTop !== before.buttonTop) violations.push(`log with More open at ${at}: button top ${after.buttonTop}, was ${before.buttonTop}`);
          if (after.covered.length) violations.push(`log with More open at ${at}: under the bar: ${after.covered.join(", ")}`);
          state.trackLogged = null;
          // The next size starts as the lifter found it: no rest running, no edited draft (the Warm-up tap stored one).
          await page.evaluate(() => {
            try { window.localStorage.removeItem("sin:workout:rest"); window.localStorage.removeItem("sin:workout:drafts"); } catch { /* storage blocked */ }
          });
        }
        // Per size: More, More before a log, the log; on the phone at 390 also the header and the keypad check.
        const want = sizes.length * 3 + (device === "mobile" ? 2 : 0);
        if (steps.length !== want) violations.push(`measured ${steps.length} of ${want} checks`);
      } catch (e) {
        violations.push(`the step stopped early: ${e.message.split("\n")[0]}`);
      } finally {
        await page.evaluate(() => { document.documentElement.removeAttribute("data-keyboard"); });
        await page.evaluate(() => {
          try { window.localStorage.removeItem("sin:workout:rest"); window.localStorage.removeItem("sin:workout:drafts"); } catch { /* storage blocked */ }
        });
        await page.setViewportSize(opts.viewport);
        state.trackLogged = null;
        state.active = false;
      }
      cardDeclutter.push({ theme, device, steps, violations });
      for (const v of violations) console.error(`  CARD DECLUTTER ${theme}/${device}: ${v}`);
    });
    // Spec 20.0 AC32: the Hevy key screen with no key, with a key, and after a failed check.
    await tryStep("hevy key screen", async () => {
      const hevyContext = async (seedKey, o = {}) => {
        const hctx = await browser.newContext({ ...opts, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
        await hctx.route(isSinApi, makeHandler({ active: false }));
        await hctx.route((u) => u.hostname === "api.hevyapp.com", hevyHandler);
        if (seedKey) {
          await hctx.addInitScript(({ k, v }) => window.localStorage.setItem(k, v), {
            k: `sin:hevy:key:${D.me.id}`,
            v: JSON.stringify({ v: 1, key: seedKey }),
          });
        }
        // Spec 20.2 AC23: the auto-push device preference.
        if (o.autoPush) await hctx.addInitScript(() => window.localStorage.setItem("sin:pref:hevy-auto-push", "on"));
        const hp = await hctx.newPage();
        hp.setDefaultTimeout(8000);
        hp.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(`${device} ${hp.url()}: ${msg.text().slice(0, 300)}`); });
        await hp.goto(BASE + "/app/profile/hevy");
        await hp.getByRole("heading", { level: 1, name: "Hevy" }).waitFor();
        await settle(hp);
        return { hctx, hp };
      };
      const absent = await hevyContext(null);
      await shoot(absent.hp, device, "hevy-key-absent", "Hevy screen with no key: paste field, helper, the two save buttons (Spec 20.0 AC4)");
      await absent.hctx.close();
      const present = await hevyContext(D.hevyGoodKey);
      await present.hp.getByText("Signed in to Hevy as carol_lifts").waitFor();
      await shoot(present.hp, device, "hevy-key-present", "Hevy screen with a key: last four, who it signs in as, Replace and Remove (Spec 20.0 AC5, AC6)");
      await present.hp.getByRole("button", { name: "Replace" }).click();
      await present.hp.getByLabel("Hevy API key").fill(D.hevyBadKey);
      await present.hp.getByRole("button", { name: "Save and remember" }).click();
      await present.hp.getByText("Hevy didn't accept that key.", { exact: false }).waitFor();
      await shoot(present.hp, device, "hevy-key-failed", "Hevy screen after a Replace that Hevy refused: the old key stays (Spec 20.0 AC5, AC6)");
      await present.hctx.close();

      // Spec 20.2 AC23 / AC30: the auto-push switch, off and on (with no key there is none: see hevy-key-absent).
      for (const [name, autoPush, note] of [
        ["hevy-auto-push-off", false, "The auto-push switch, off by default, with its help sentence (Spec 20.2 AC23)"],
        ["hevy-auto-push-on", true, "The auto-push switch on (Spec 20.2 AC23)"],
      ]) {
        const ap = await hevyContext(D.hevyGoodKey, { autoPush });
        const box = ap.hp.getByRole("checkbox", { name: "Send each workout to Hevy when I finish it" });
        await box.scrollIntoViewIfNeeded();
        await shoot(ap.hp, device, name, note);
        await ap.hctx.close();
      }

      // Spec 20.0 Phase B (AC32): the pairings card, a load preview, the Pairings screen and the markers sheet.
      const owner = await hevyContext(D.hevyGoodKey);
      await owner.hp.getByText("7 exercises paired").waitFor();
      await owner.hp.getByRole("heading", { level: 2, name: "Exercise pairings" }).scrollIntoViewIfNeeded();
      await shoot(owner.hp, device, "hevy-mapping-card", "The Exercise pairings card: count, section markers, Load, Download, Review (Spec 20.0 AC17)");
      await owner.hp.getByRole("button", { name: "Load a file" }).click();
      await owner.hp.getByLabel("Choose a file").setInputFiles({ name: "hevy-mapping.csv", mimeType: "text/csv", buffer: Buffer.from(D.hevyMappingCsv) });
      await owner.hp.getByRole("heading", { level: 3, name: /^Will be paired/ }).waitFor();
      await shoot(owner.hp, device, "hevy-load-preview", "Loading a file: paired, a calories line to confirm, a left-out line, and what will be removed (Spec 20.0 AC21)");
      await owner.hctx.close();
      const pairings = await hevyContext(D.hevyGoodKey);
      await pairings.hp.goto(BASE + "/app/profile/hevy/pairings");
      await pairings.hp.getByRole("heading", { level: 1, name: "Pairings" }).waitFor();
      await pairings.hp.getByRole("heading", { level: 2, name: "Bench Press" }).waitFor();
      await settle(pairings.hp);
      await shoot(pairings.hp, device, "hevy-pairings", "Pairings: by exercise, Sent as this, skips, markers, a deleted exercise (Spec 20.0 AC24)");
      await pairings.hctx.close();
      const markers = await browser.newContext({ ...opts, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
      await markers.route(isSinApi, makeHandler({ active: false, hevyMapping: D.hevyMappingNoMarkers }));
      await markers.route((u) => u.hostname === "api.hevyapp.com", hevyHandler);
      await markers.addInitScript(({ k, v }) => window.localStorage.setItem(k, v), { k: `sin:hevy:key:${D.me.id}`, v: JSON.stringify({ v: 1, key: D.hevyGoodKey }) });
      const mp = await markers.newPage();
      mp.setDefaultTimeout(8000);
      mp.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(`${device} ${mp.url()}: ${msg.text().slice(0, 300)}`); });
      await mp.goto(BASE + "/app/profile/hevy");
      await mp.getByRole("button", { name: "Choose them" }).click();
      await mp.getByRole("group", { name: "Warmup" }).waitFor();
      await shoot(mp, device, "hevy-markers-sheet", "Choosing the Warmup and workout section markers (Spec 20.0 AC30)");
      await markers.close();
    });
    // Spec 20.1 AC29 (Phase A): the import's preflight, reading, routines, names and summary.
    await tryStep("hevy import", async () => {
      const importContext = async (importMode = "ok") => {
        const ictx = await browser.newContext({ ...opts, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
        const istate = { active: false, importMode };
        await ictx.route(isSinApi, makeHandler(istate));
        await ictx.route((u) => u.hostname === "api.hevyapp.com", hevyHandler);
        await ictx.addInitScript(({ k, v }) => window.localStorage.setItem(k, v), { k: `sin:hevy:key:${D.me.id}`, v: JSON.stringify({ v: 1, key: D.hevyGoodKey }) });
        const ip = await ictx.newPage();
        ip.setDefaultTimeout(8000);
        ip.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(`${device} ${ip.url()}: ${msg.text().slice(0, 300)}`); });
        await ip.goto(BASE + "/app/profile/hevy/import");
        await ip.getByRole("heading", { level: 2, name: "Before you start" }).waitFor();
        await settle(ip);
        return { ictx, ip, istate };
      };
      /** Start → tick Pull A → skip the two unpaired names → the summary. */
      const toSummary = async (ip) => {
        await ip.getByRole("button", { name: "Start" }).click();
        await ip.getByRole("heading", { level: 2, name: "Routines to copy" }).waitFor();
        await ip.getByRole("checkbox", { name: "Pull A" }).check();
        await ip.getByRole("button", { name: "Continue" }).click();
        await ip.getByRole("heading", { level: 2, name: "Pair exercises" }).waitFor();
        for (const name of ["Seated Row (Cable)", "Bicep Curl (Barbell)"]) {
          await ip.getByRole("group", { name }).getByRole("radio", { name: "Skip this exercise (its sets are not imported)" }).check();
        }
        await ip.getByRole("button", { name: "Continue" }).click();
        await ip.getByRole("heading", { level: 2, name: "Summary" }).waitFor();
      };
      const reading = await importContext();
      await shoot(reading.ip, device, "hevy-import-preflight", "Import from Hevy: what it will do, the device zone and the unit, before anything is read (Spec 20.1 AC2)");
      holdWorkoutsPage = 2;
      await reading.ip.getByRole("button", { name: "Start" }).click();
      await reading.ip.getByText("Reading Hevy… workouts, page 1 of 3").waitFor();
      await shoot(reading.ip, device, "hevy-import-reading", "Reading Hevy: the stage line, page 1 of 3, and Cancel (Spec 20.1 AC3)");
      holdWorkoutsPage = null;
      await reading.ictx.close();

      const flow = await importContext();
      await flow.ip.getByRole("button", { name: "Start" }).click();
      await flow.ip.getByRole("heading", { level: 2, name: "Routines to copy" }).waitFor();
      await flow.ip.getByRole("checkbox", { name: "Pull A" }).check();
      await settle(flow.ip);
      await shoot(flow.ip, device, "hevy-import-routines", "Routines to copy, by Hevy folder: the cap room, one already in SIN, one ticked (Spec 20.1 AC7)");
      await flow.ip.getByRole("button", { name: "Continue" }).click();
      await flow.ip.getByRole("heading", { level: 2, name: "Pair exercises" }).waitFor();
      await settle(flow.ip);
      await shoot(flow.ip, device, "hevy-import-names", "Pair exercises: the templates the mapping lacks, by usage, with the cap line (Spec 20.1 AC9)");
      for (const name of ["Seated Row (Cable)", "Bicep Curl (Barbell)"]) {
        await flow.ip.getByRole("group", { name }).getByRole("radio", { name: "Skip this exercise (its sets are not imported)" }).check();
      }
      await flow.ip.getByRole("button", { name: "Continue" }).click();
      await flow.ip.getByRole("heading", { level: 2, name: "Summary" }).waitFor();
      for (const group of await flow.ip.locator("details").all()) await group.evaluate((d) => { d.open = true; });
      await settle(flow.ip);
      await shoot(flow.ip, device, "hevy-import-summary", "The summary: what the import would do, every list group open (Spec 20.1 AC12-AC14)");
      // Spec 20.1 AC29 (Phase B): the run caught mid-batch, then (once it lands) the finish, the routine at the cap, done.
      flow.istate.importMode = "hold";
      await flow.ip.getByRole("button", { name: /^Import \d/ }).click();
      await flow.ip.getByText(/^Importing… 0 of/).waitFor();
      await flow.ip.waitForTimeout(400);
      await shoot(flow.ip, device, "hevy-import-running", "Importing: the progress line, the batch's month, Keep this tab open and Stop (Spec 20.1 AC16)");
      await flow.ictx.close();

      const done = await importContext("ok");
      await toSummary(done.ip);
      await done.ip.getByRole("button", { name: /^Import \d/ }).click();
      await done.ip.getByRole("heading", { level: 2, name: "Done" }).waitFor({ timeout: 15000 });
      await done.ip.getByText("Records updated.").waitFor();
      await settle(done.ip);
      await shoot(done.ip, device, "hevy-import-done", "Done: the counts, records updated, and a routine the cap kept out (Spec 20.1 AC23, AC25)");
      await done.ictx.close();

      const stopped = await importContext("refuse");
      await toSummary(stopped.ip);
      await stopped.ip.getByRole("button", { name: /^Import \d/ }).click();
      await stopped.ip.getByRole("heading", { level: 2, name: "Stopped" }).waitFor();
      await settle(stopped.ip);
      await shoot(stopped.ip, device, "hevy-import-stopped", "Stopped: the server refused a batch; the static reason, its field, and Finish up (Spec 20.1 AC19, AC20)");
      await stopped.ictx.close();

      // Minor 253: a Stop by the lifter. The batch in flight lands, then the run stops with Finish up (a Stop during the
      // only batch leaves nothing to resume).
      const userStop = await importContext("gate");
      await toSummary(userStop.ip);
      await userStop.ip.getByRole("button", { name: /^Import \d/ }).click();
      await userStop.ip.getByText(/^Importing… 0 of/).waitFor();
      // The batch is held at the route before Stop, so there is a batch in flight to land.
      while (!userStop.istate.releaseImport) await userStop.ip.waitForTimeout(50);
      await userStop.ip.getByRole("button", { name: "Stop" }).click();
      await userStop.ip.getByText("Stopping after this batch…").waitFor();
      userStop.istate.releaseImport();
      await userStop.ip.getByRole("heading", { level: 2, name: "Stopped" }).waitFor();
      await settle(userStop.ip);
      await shoot(userStop.ip, device, "hevy-import-stopped-user", "Stopped by the lifter: the batch in flight landed, the counts and Finish up (Spec 20.1 AC20)");
      await userStop.ictx.close();

      // The run retries a 500 after 2 s, 4 s and 8 s before it pauses.
      const paused = await importContext("fail");
      await toSummary(paused.ip);
      await paused.ip.getByRole("button", { name: /^Import \d/ }).click();
      await paused.ip.getByRole("button", { name: "Resume" }).waitFor({ timeout: 25000 });
      await settle(paused.ip);
      await shoot(paused.ip, device, "hevy-import-paused", "Paused: couldn't reach the server, with Resume and Stop (Spec 20.1 AC19)");
      await paused.ictx.close();
    });
    // Spec 20.2 AC21: the Hevy line on a finished workout (Lower A), each state; the pairing sheet; the delete note.
    await tryStep("hevy send", async () => {
      hevyWrite = "ok";
      const workout = D.allWorkouts.find((w) => w.id === D.ids.latestFinished);
      const sendContext = async (o = {}) => {
        const sctx = await browser.newContext({ ...opts, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
        const sstate = { active: false, hevyLink: o.link, hevyMapping: o.mapping ?? D.hevyMappingFor(workout) };
        await sctx.route(isSinApi, makeHandler(sstate));
        await sctx.route((u) => u.hostname === "api.hevyapp.com", hevyHandler);
        if (o.key !== false) {
          await sctx.addInitScript(({ k, v }) => window.localStorage.setItem(k, v), { k: `sin:hevy:key:${D.me.id}`, v: JSON.stringify({ v: 1, key: D.hevyGoodKey }) });
        }
        if (o.autoPush) await sctx.addInitScript(() => window.localStorage.setItem("sin:pref:hevy-auto-push", "on"));
        const sp = await sctx.newPage();
        sp.setDefaultTimeout(8000);
        sp.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(`${device} ${sp.url()}: ${msg.text().slice(0, 300)}`); });
        await sp.goto(BASE + `/app/history/${workout.id}`);
        const region = sp.getByRole("region", { name: "Hevy" });
        await region.waitFor();
        await region.scrollIntoViewIfNeeded();
        await settle(sp);
        return { sctx, sp, region };
      };
      const still = async (name, note, o) => {
        const s = await sendContext(o);
        await shoot(s.sp, device, name, note);
        await s.sctx.close();
      };
      await still("hevy-send-none", "A finished workout not in Hevy: Not in Hevy yet, Send to Hevy (Spec 20.2 AC2)", {});
      await still("hevy-send-sent", "Sent to Hevy with the day it was synced, no button (Spec 20.2 AC2)", { link: D.hevyLinkOf("sent") });
      await still("hevy-send-changed", "Changed since sent to Hevy, with Update in Hevy (Spec 20.2 AC2, AC11)", { link: D.hevyLinkOf("changed") });
      await still("hevy-send-imported", "A workout imported from Hevy: From Hevy (Spec 20.2 AC2)", { link: D.hevyLinkOf("sent", "imported") });
      await still("hevy-send-no-key", "No Hevy key on this device: the line links to the key (Spec 20.2 AC3)", { key: false });
      {
        // Spec 20.2 AC25: auto-push on and one exercise not paired.
        const m = D.hevyMappingFor(workout);
        const s = await sendContext({ autoPush: true, mapping: { ...m, pairs: m.pairs.slice(1) } });
        await s.region.getByText(/needs? matching before this can go to Hevy/).waitFor();
        await shoot(s.sp, device, "hevy-send-needs-matching", "Auto-push on, an exercise not matched: the needs-matching line above Send (Spec 20.2 AC25)");
        await s.sctx.close();
      }

      hevyWrite = "hold";
      const sending = await sendContext({});
      await sending.region.getByRole("button", { name: "Send to Hevy" }).click();
      await sending.region.getByText("Sending to Hevy…").waitFor();
      await shoot(sending.sp, device, "hevy-send-sending", "Sending to Hevy…, the button disabled (Spec 20.2 AC5)");
      await sending.sctx.close();

      hevyWrite = "fail";
      const unsure = await sendContext({});
      await unsure.region.getByRole("button", { name: "Send to Hevy" }).click();
      await unsure.region.getByText("Not sure whether Hevy received it. Check before sending again.").waitFor({ timeout: 15000 });
      await settle(unsure.sp);
      await shoot(unsure.sp, device, "hevy-send-unsure", "Hevy didn't answer: not sure it arrived, with Check Hevy (Spec 20.2 AC9)");
      await unsure.sctx.close();
      hevyWrite = "ok";

      // The harness's own mapping leaves Plank (a duration exercise) unpaired, so Send opens the sheet.
      const sheet = await sendContext({ mapping: D.hevyMapping });
      await sheet.region.getByRole("button", { name: "Send to Hevy" }).click();
      const dialog = sheet.sp.getByRole("dialog", { name: "Match exercises for Hevy" });
      await dialog.waitFor();
      await dialog.getByRole("group").first().getByRole("button", { name: "Create in Hevy" }).click();
      await dialog.getByText("Hevy can't edit or delete an exercise after it's created. Check the details.").waitFor();
      await settle(sheet.sp);
      await shoot(sheet.sp, device, "hevy-send-sheet-create", "Match exercises for Hevy, a card's Create in Hevy step (Spec 20.2 AC13, AC14)");
      await sheet.sctx.close();

      const del = await sendContext({ link: D.hevyLinkOf("sent") });
      await del.sp.getByRole("button", { name: "Workout menu" }).click();
      await del.sp.getByRole("button", { name: "Delete workout" }).click();
      const confirm = del.sp.getByRole("dialog", { name: "Delete this workout?" });
      await confirm.getByText("This workout is also in Hevy.", { exact: false }).waitFor();
      await settle(del.sp);
      await shoot(del.sp, device, "hevy-send-delete-note", "Delete this workout? with the note that the Hevy copy stays (Spec 20.2 AC18)");
      await del.sctx.close();
    });
    await tryStep("sign-out guard dialog", async () => {
      // The guard only shows a dialog when sets are unsaved: log one set on the active workout with
      // writes held unanswered, then use Sign out from Profile (client-side nav keeps the outbox).
      state.active = true;
      state.hangWrites = true;
      await go("/app/workouts");
      await page.getByTestId("session-bar").getByRole("button", { name: /^Log / }).click();
      await page.waitForTimeout(500);
      await shoot(page, device, "26-queued-row", "A set logged with writes held: the row says Not saved yet");
      await page.getByRole("link", { name: "Profile" }).last().click();
      await settle(page);
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await page.waitForTimeout(300);
      await shoot(page, device, "18a-signout-syncing", "Sign-out guard dialog while an unsaved set is syncing");
      await page.waitForTimeout(9000); // SYNC_WAIT_MS is 8000
      await shoot(page, device, "18b-signout-warning", "Sign-out guard dialog: unsaved-sets warning (after the sync wait)");
      await page.keyboard.press("Escape");
    });
    state.hangWrites = false;
    state.active = false;
    await page.evaluate(() => { try { window.localStorage.clear(); } catch { /* storage blocked */ } });
    await tryStep("delete-account dialog", async () => {
      await go("/app/profile");
      await page.getByRole("button", { name: "Delete account…" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "19-delete-dialog-step1", "Delete-account confirmation, step 1");
      await page.locator("dialog[open]").getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(300);
      await shoot(page, device, "20-delete-dialog-step2", "Delete-account confirmation, step 2 (final)");
      await page.keyboard.press("Escape");
    });

    await go("/app/does-not-exist");
    await shoot(page, device, "21-not-found", "In-app 404");
    await ctx.close();

    // Logged out.
    const anon = await browser.newContext({ ...opts, colorScheme: theme, timezoneId: "America/Chicago", locale: "en-US" });
    await anon.addInitScript(() => { window.__SIN_FAKE_AUTH__ = false; });
    await anon.route(isSinApi, makeHandler({ active: false }));
    const ap = await anon.newPage();
    ap.on("pageerror", (err) => consoleErrors.push(`${device} anon: PAGEERROR ${err.message.slice(0, 300)}`));
    await ap.goto(BASE + "/");
    await shoot(ap, device, "00-landing", "Public landing page, logged out");
    await checkFrontDoor(ap, `${theme}/${device}/00-landing`);
    if (device === "mobile") {
      await ap.keyboard.press("Tab");
      await shoot(ap, device, "00a-landing-focus", "Landing with the Log in button focused (Spec 17.3 AC28)");
    }
    // The Auth0 hint cookie makes / show ResumingSession; the fake loginWithRedirect only logs, so it stays put.
    await anon.addCookies([{ name: "auth0.harness-client-id.is.authenticated", value: "true", url: BASE }]);
    await ap.goto(BASE + "/");
    await ap.getByTestId("resuming-session").waitFor();
    await shoot(ap, device, "00b-resuming", "Resuming your session, the front door's other screen (Spec 17.3 AC14)");
    await checkFrontDoor(ap, `${theme}/${device}/00b-resuming`);
    // "Go to sign in" leads straight to the landing, so the name must not move between the two (Spec 17.3 §5.2).
    {
      const [landing, resuming] = frontDoor.slice(-2);
      const drift = Math.abs(landing.nameTop - resuming.nameTop);
      if (drift > 1) {
        resuming.violations.push(`name ${drift.toFixed(1)}px off the landing's`);
        console.error(`  FRONT DOOR ${theme}/${device}/00b-resuming: name ${drift.toFixed(1)}px off the landing's`);
      }
    }
    // The sign-in error (BL-20): a short detail, then on the phone a long one and none.
    await anon.clearCookies();
    await ap.goto(BASE + "/callback?error=access_denied&error_description=Invalid%20state");
    await ap.getByTestId("auth-error").waitFor();
    await shoot(ap, device, "00c-auth-error", "Couldn't sign you in, on the front door (BL-20)");
    await checkFrontDoor(ap, `${theme}/${device}/00c-auth-error`);
    if (device === "mobile") {
      const long = "Your account has been blocked after multiple consecutive login attempts. We've sent you an email with instructions on how to unblock it.";
      await ap.goto(BASE + "/callback?error=unauthorized&error_description=" + encodeURIComponent(long));
      await ap.getByTestId("auth-error").waitFor();
      await shoot(ap, device, "00d-auth-error-long", "Sign-in error with a long Auth0 description (BL-20)");
      await checkFrontDoor(ap, `${theme}/${device}/00d-auth-error-long`);
      await ap.goto(BASE + "/callback?error=access_denied");
      await ap.getByTestId("auth-error").waitFor();
      await shoot(ap, device, "00e-auth-error-none", "Sign-in error with no description (BL-20)");
      await checkFrontDoor(ap, `${theme}/${device}/00e-auth-error-none`);
    }
    await anon.close();

    // The smallest phone (Spec 17.3 AC19 / AC21): the landing, and the sign-in error with a long detail (BL-20).
    if (device === "mobile") {
      const small = await browser.newContext({ ...opts, viewport: { width: 320, height: 568 }, colorScheme: theme });
      await small.addInitScript(() => { window.__SIN_FAKE_AUTH__ = false; });
      await small.route(isSinApi, makeHandler({ active: false }));
      const sp = await small.newPage();
      await sp.goto(BASE + "/");
      await shoot(sp, "mobile-320", "00-landing", "Landing at 320 x 568");
      await checkFrontDoor(sp, `${theme}/mobile-320/00-landing`);
      await sp.goto(BASE + "/callback?error=unauthorized&error_description=" + encodeURIComponent("Your account has been blocked after multiple consecutive login attempts. We've sent you an email with instructions on how to unblock it."));
      await sp.getByTestId("auth-error").waitFor();
      await shoot(sp, "mobile-320", "00d-auth-error-long", "Sign-in error with a long detail at 320 x 568 (BL-20)");
      await checkFrontDoor(sp, `${theme}/mobile-320/00d-auth-error-long`);
      await small.close();
    }
  }

  // Spec 17.13 AC4b: dates follow the device's locale, so other locales must lay out. The live header, the summary and
  // History at 390 px under en-GB and de-DE. A shot fails the run on an overlap, on a "Started" line that meets Change
  // Time, when the page's Intl didn't take the context's locale, or when a pinned layer covers anything on the first
  // screen (scroll top) that it doesn't cover on the same screen under en-US. Hits further down are the list scrolling
  // under the sticky bar, and a longer date that makes the page taller only moves which rows they are.
  // Review focus 4 and 5: the longest en-US moment on the live header at 320 × 568, and a chart whose span crosses a
  // year (full years, no overlap).
  if (DEVICE_FILTER.includes("mobile")) {
    const coveredAtTop = (shot) => {
      const dump = JSON.parse(fs.readFileSync(path.join(OUT, shot.file.replace(/\.png$/, ".layout.json")), "utf8"));
      return new Set((dump.pinnedCoverage.find((s) => s.scrollY === 0)?.hits ?? []).map((h) => h.covers));
    };
    const checkLocaleShot = async (page, locale, where, { baseline, extra = [] }) => {
      const shot = report.at(-1);
      const violations = [...extra];
      const actual = await page.evaluate(() => new Intl.DateTimeFormat().resolvedOptions().locale);
      if (actual !== locale) violations.push(`Intl reports ${actual}, not ${locale}`);
      if (shot.overlaps) violations.push(`${shot.overlaps} overlapping controls`);
      if (!baseline) violations.push("no en-US shot of this screen to compare with");
      else {
        const before = coveredAtTop(baseline);
        for (const c of coveredAtTop(shot)) {
          if (!before.has(c)) violations.push(`the first screen has ${c} under a pinned layer; ${baseline.file} doesn't`);
        }
      }
      localeChecks.push({ shot: shot.file, locale, where, baseline: baseline?.file ?? null, pinnedHits: shot.pinnedHits, baselinePinnedHits: baseline?.pinnedHits ?? null, violations });
      for (const v of violations) console.error(`  LOCALE ${shot.file}: ${v}`);
    };
    const mainShot = (name) => report.find((r) => r.file?.endsWith(`/mobile/${name}.png`) && !r.file.startsWith("locale-"));
    // The live screen scrolls to the current exercise; bring the header back and check its Started line against Change Time.
    const showHeader = async (page, text) => {
      const started = page.getByText(text ?? /^Started /, { exact: Boolean(text) }).first();
      await started.waitFor();
      await started.scrollIntoViewIfNeeded();
      const change = page.getByRole("button", { name: "Change time" });
      const [a, b] = [await started.boundingBox(), await change.boundingBox()];
      const meet = a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      return meet ? [`"${await started.textContent()}" meets Change time`] : [];
    };
    for (const locale of ["en-GB", "de-DE"]) {
      await tryStep(`locale ${locale}`, async () => {
        THEME = `locale-${locale}`;
        const ctx = await browser.newContext({ ...DEVICES.mobile, colorScheme: "light", timezoneId: "America/Chicago", locale });
        await ctx.route(isSinApi, makeHandler({ active: true }));
        const page = await ctx.newPage();
        page.setDefaultTimeout(8000);
        for (const [where, p, name] of [
          ["the live header", "/app/workouts", "01-workout-active"],
          ["the summary", `/app/history/${D.ids.latestFinished}`, "13-history-detail"],
          ["History", "/app/history", "12-history"],
        ]) {
          await page.goto(BASE + p);
          await settle(page);
          const extra = name === "01-workout-active" ? await showHeader(page) : [];
          await shoot(page, "mobile", name, `Spec 17.13 AC4b: ${where} under ${locale}`);
          await checkLocaleShot(page, locale, where, { baseline: mainShot(name), extra });
        }
        await ctx.close();
      });
    }
    await tryStep("locale en-US 320 header", async () => {
      THEME = "locale-en-US";
      // A start today (the time alone) is the baseline; then a start on Wed, Sep 30 at 12:05 PM Chicago time, the
      // longest en-US moment beside Change Time.
      const state = { active: true };
      const ctx = await browser.newContext({ ...DEVICES.mobile, viewport: { width: 320, height: 568 }, colorScheme: "light", timezoneId: "America/Chicago", locale: "en-US" });
      await ctx.route(isSinApi, makeHandler(state));
      const page = await ctx.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(BASE + "/app/workouts");
      await settle(page);
      const todayExtra = await showHeader(page);
      await shoot(page, "mobile-320", "01m-header-today", "Spec 17.13 review focus 4: the baseline, a start today, at 320 × 568");
      const today = report.at(-1);
      state.almostDone = { ...D.active, startedAt: "2026-09-30T17:05:00.000Z" };
      await page.goto(BASE + "/app/workouts");
      await settle(page);
      const extra = await showHeader(page, "Started Wed, Sep 30, 12:05 PM");
      await shoot(page, "mobile-320", "01n-header-long-moment", "Spec 17.13 review focus 4: the longest en-US moment beside Change Time at 320 × 568");
      await checkLocaleShot(page, "en-US", "the live header at 320", { baseline: today, extra: [...todayExtra, ...extra] });
      await ctx.close();
    });
    // Two charts across a year: three month starts (month labels), and Dec 20 to Jan 10 (no two month starts, so the
    // ends get day labels with the year, the longest labels the chart draws; final review I1).
    for (const [name, seriesDates] of [
      ["15y-chart-across-a-year", ["2025-11-20", "2025-12-18", "2026-01-15", "2026-02-10"]],
      ["15z-chart-across-a-year-ends", ["2025-12-20", "2026-01-10"]],
    ]) {
      await tryStep(`locale en-US chart ${name}`, async () => {
        THEME = "locale-en-US";
        const state = { active: false, seriesDates };
        const ctx = await browser.newContext({ ...DEVICES.mobile, colorScheme: "light", timezoneId: "America/Chicago", locale: "en-US" });
        await ctx.route(isSinApi, makeHandler(state));
        const page = await ctx.newPage();
        page.setDefaultTimeout(8000);
        await page.goto(BASE + `/app/exercises/${D.ids.bench}`);
        await page.locator("svg text").first().waitFor();
        // The x-axis labels: the svg texts that read as a date, with their boxes.
        const { ticks, width } = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          ticks: [...document.querySelectorAll("svg text")]
            .map((t) => ({ text: t.textContent ?? "", box: t.getBoundingClientRect() }))
            .filter((t) => /[A-Z][a-z]{2}/.test(t.text))
            .map((t) => ({ text: t.text, left: t.box.left, right: t.box.right, top: t.box.top, bottom: t.box.bottom })),
        }));
        const extra = [];
        if (ticks.length === 0) extra.push("no date ticks");
        if (ticks.some((t) => !/\b20\d\d\b/.test(t.text))) extra.push(`a tick without its full year: ${ticks.map((t) => t.text).join(", ")}`);
        for (const t of ticks) if (t.left < 0 || t.right > width) extra.push(`"${t.text}" runs off the screen (${Math.round(t.left)}–${Math.round(t.right)} of ${width})`);
        for (let i = 0; i < ticks.length; i++) for (let j = i + 1; j < ticks.length; j++) {
          const [a, b] = [ticks[i], ticks[j]];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) extra.push(`ticks overlap: "${a.text}" and "${b.text}"`);
        }
        await shoot(page, "mobile", name, `Spec 17.13 review focus 5: ticks ${ticks.map((t) => t.text).join(", ")}`);
        await checkLocaleShot(page, "en-US", "a chart across a year", { baseline: mainShot("15-progress-bench"), extra });
        await ctx.close();
      });
    }
  }

  // The Light / Dark / System override (Spec 17.0 AC18): Profile on a light OS with Dark stored.
  {
    THEME = "override-dark";
    const ctx = await browser.newContext({ ...DEVICES.mobile, colorScheme: "light", timezoneId: "America/Chicago", locale: "en-US" });
    await ctx.addInitScript(() => { try { window.localStorage.setItem("sin:pref:theme", "dark"); } catch { /* storage blocked */ } });
    await ctx.route(isSinApi, makeHandler({ active: false }));
    const page = await ctx.newPage();
    await page.goto(BASE + "/app/profile");
    await shoot(page, "mobile", "17-profile", "Profile on a light OS with the Dark override stored");
    await ctx.close();

    // The landing under the same override (Spec 17.3 AC27).
    const anon = await browser.newContext({ ...DEVICES.mobile, colorScheme: "light" });
    await anon.addInitScript(() => {
      window.__SIN_FAKE_AUTH__ = false;
      try { window.localStorage.setItem("sin:pref:theme", "dark"); } catch { /* storage blocked */ }
    });
    await anon.route(isSinApi, makeHandler({ active: false }));
    const ap = await anon.newPage();
    await ap.goto(BASE + "/");
    await shoot(ap, "mobile", "00-landing", "Landing on a light OS with the Dark override stored");
    await anon.close();
  }
} finally {
  await browser.close();
}

// Spec 17.1 AC24: every enabled, visible control on the session screens is at least 44 px in both axes.
// Spec 17.8: the panel, rest, new-type and edit-sheet captures count too, at every size (no trailing "-", so 24b, 33d,
// 59b and 60b are included).
const SESSION_SHOTS = /\/(01|03|04|2[2-6]|59|60|61|33|s177b)/;
const tooSmall = report.filter((r) => r.file && SESSION_SHOTS.test(r.file) && r.smallTargets?.length);
for (const r of tooSmall) console.error(`  SMALL TARGETS ${r.file}: ${r.smallTargets.join("; ")}`);
if (tooSmall.length) process.exitCode = 1;
// Spec 17.11 AC10: the exercise page's captures have no small target and no overlap ("Open workout" beside the readout),
// at 390 and 1280 px and at 320 × 568 (15n).
const EXERCISE_SHOTS = /\/(15|15n|16|75|81)-/;
const exerciseTight = report.filter((r) => r.file && EXERCISE_SHOTS.test(r.file) && (r.smallTargets?.length || r.overlaps));
for (const r of exerciseTight) console.error(`  EXERCISE TARGETS ${r.file}: ${r.overlaps} overlaps; ${r.smallTargets.join("; ")}`);
if (exerciseTight.length) process.exitCode = 1;
if (exercisePage.some((e) => e.violations.length)) process.exitCode = 1;
if (DEVICE_FILTER.includes("mobile") && (!exercisePage.some((e) => e.shot.endsWith("/15n-exercise-narrow")) || report.some((r) => r.note?.startsWith("SKIPPED exercise page 320")))) {
  console.error("  EXERCISE PAGE: the 320 step did not run");
  process.exitCode = 1;
}
if (frontDoor.some((f) => f.violations.length)) process.exitCode = 1;
if (planRows.some((r) => r.violations.length)) process.exitCode = 1;
if (!planRows.some((r) => r.moveFocus !== undefined) || report.some((r) => r.note?.startsWith("SKIPPED routine item sheet") || r.note?.startsWith("SKIPPED plan rows 320"))) {
  console.error("  PLAN ROWS: a plan-row step did not run");
  process.exitCode = 1;
}
if (DEVICE_FILTER.includes("mobile") && !["/09n-item-row-narrow", "/09o-item-row-narrow-open"].every((end) => planRows.some((r) => r.shot.endsWith(end)))) {
  console.error("  PLAN ROWS: the 320 step did not run");
  process.exitCode = 1;
}
if (offCenter.length) process.exitCode = 1;
if (loggingLoop.some((l) => l.violations.length)) process.exitCode = 1;
if (segments.some((l) => l.violations.length)) process.exitCode = 1;
// Spec 17.7 AC2: a segmented-widths step that never reported must not read as a pass either.
if (segments.length === 0 || report.some((r) => r.note?.startsWith("SKIPPED segmented widths"))) {
  console.error("  SEGMENTED: the step did not run on every device");
  process.exitCode = 1;
}
// Spec 17.7 Phase B: the card-and-more checks fail the run on a violation or when the step never reported.
if (cardDeclutter.some((l) => l.violations.length)) process.exitCode = 1;
if (cardDeclutter.length === 0 || report.some((r) => r.note?.startsWith("SKIPPED card and more"))) {
  console.error("  CARD DECLUTTER: the step did not run on every device");
  process.exitCode = 1;
}
// Spec 17.8 Phase A: the entry-panel checks fail the run on a violation or when the step never reported.
if (entryPanel.some((l) => l.violations.length)) process.exitCode = 1;
if (entryPanel.length === 0 || report.some((r) => r.note?.startsWith("SKIPPED entry panel"))) {
  console.error("  ENTRY PANEL: the step did not run on every device");
  process.exitCode = 1;
}
// Spec 17.6 AC20: the ledger checks fail the run on a violation or when the step never reported.
if (recordLedger.some((l) => l.violations.length)) process.exitCode = 1;
if (recordLedger.length === 0 || report.some((r) => r.note?.startsWith("SKIPPED record ledger"))) {
  console.error("  RECORD LEDGER: the step did not run on every device");
  process.exitCode = 1;
}
// Spec 17.6 AC21: the first-screen check fails the run on a violation, or when a mobile run never reached it.
if (summaryFirstScreen.some((s) => s.violations.length)) process.exitCode = 1;
if (DEVICE_FILTER.includes("mobile") && summaryFirstScreen.length === 0) {
  console.error("  SUMMARY FIRST SCREEN: the check did not run on mobile");
  process.exitCode = 1;
}
// Spec 17.10 AC19: the sheet-row checks fail the run on a violation, or when the step never reported.
if (sheetRows.some((r) => r.violations.length)) process.exitCode = 1;
if (!sheetRows.some((r) => r.shot.endsWith("/sheet-row-step")) || report.some((r) => r.note?.startsWith("SKIPPED sheet row"))) {
  console.error("  SHEET ROW: the step did not run on every device");
  process.exitCode = 1;
}
// A logging-loop step that never reported must not read as a pass.
if (loggingLoop.length === 0 || report.some((r) => r.note?.startsWith("SKIPPED logging loop"))) {
  console.error("  LOGGING LOOP: the step did not run on every device");
  process.exitCode = 1;
}
// Spec 17.13 AC4b: the locale checks fail the run on a violation, or when a mobile run never reported them.
if (localeChecks.some((l) => l.violations.length)) process.exitCode = 1;
if (DEVICE_FILTER.includes("mobile") && (localeChecks.length === 0 || report.some((r) => r.note?.startsWith("SKIPPED locale")))) {
  console.error("  LOCALE: a locale step did not run");
  process.exitCode = 1;
}
if (doubledTitles.length) process.exitCode = 1;
if (DEVICE_FILTER.includes("mobile") && (historyOffsets.length === 0 || historyOffsets.some((h) => h.offset === null || h.offset > HISTORY_ROW_MAX_OFFSET))) {
  console.error("  HISTORY OFFSET: the check failed or did not run");
  process.exitCode = 1;
}
fs.writeFileSync(path.join(OUT, "_report.json"), JSON.stringify({ base: BASE, doubledTitles, historyOffsets, report, frontDoor, exercisePage, planRows, offCenter, loggingLoop, segments, cardDeclutter, entryPanel, recordLedger, summaryFirstScreen, sheetRows, localeChecks, unmatched: [...unmatched], consoleErrors }, null, 1));
console.log(`\nunmatched API requests: ${unmatched.size ? [...unmatched].join(", ") : "none"}`);
console.log(`console errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 20)) console.log("  " + e);
