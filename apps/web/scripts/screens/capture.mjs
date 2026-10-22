// Screenshot capture for the SPA against the harness Vite server (Spec 17.0 §6.10, AC18).
// Usage: node capture.mjs <baseUrl>   (run.mjs starts the server and calls this; see README.md)
// Output: apps/web/.screens/<theme>/<device>/<NN-name>[-full].png + .layout.json, and _report.json.
// The page.evaluate callbacks below run in the browser, so they use DOM globals.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as D from "./data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(webRoot, "../..");
const require = createRequire(path.join(webRoot, "package.json"));
const { chromium } = require("@playwright/test");

const OUT = path.join(webRoot, ".screens");
const BASE = process.argv[2] ?? "http://localhost:5287";
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
    else if (m === "PATCH" && p === "/v1/me") res = json({ ...D.me, ...JSON.parse(req.postData() ?? "{}") });
    else if (m === "GET" && p === "/v1/exercises") res = json({ exercises: D.exercises, syncToken: "1.100" });
    else if (m === "GET" && p === "/v1/muscle-groups") res = json({ muscleGroups: D.muscleGroups });
    else if (m === "GET" && p === "/v1/equipment") res = json({ equipment: D.equipment });
    // Spec 10.5 AC26: the one-off is listed only while `showClass` is on, until the one-off finish removes it.
    else if (m === "GET" && p === "/v1/routines") res = json({ routines: state.showClass && !state.classGone ? [D.CLASS, ...D.routines] : D.routines });
    else if (m === "GET" && (seg = /^\/v1\/routines\/([^/]+)$/.exec(p))) {
      const listed = state.showClass && !state.classGone ? [D.CLASS, ...D.routines] : D.routines;
      const r = listed.find((x) => x.id === decodeURIComponent(seg[1]));
      res = r ? json(r) : problem(404, "not-found", "Not found");
    } else if (m === "POST" && /^\/v1\/routines\/[^/]+\/keep$/.test(p)) {
      res = { status: 204, body: "" };
    } else if (m === "GET" && p === "/v1/workouts/active") {
      const live = state.oneOffActive ? D.activeOneOff : state.planned ? D.activePlanned : state.done ? D.activeDone : D.active;
      res = state.active ? json(live) : problem(404, "not-found", "No active workout");
    } else if (m === "PATCH" && state.oneOffActive && (seg = /^\/v1\/workouts\/([^/]+)$/.exec(p))) {
      // The one-off finish: the server removes the routine (Spec 09.3); the detail no longer reads as one-off.
      state.finishedOneOff = { ...D.activeOneOff, endedAt: new Date().toISOString(), plannedDurationSeconds: null, routineIsOneOff: false };
      state.classGone = true;
      res = json({ ...state.finishedOneOff, newRecords: [] });
    } else if (m === "GET" && p === "/v1/workouts") res = json(D.history);
    else if (m === "GET" && (seg = /^\/v1\/workouts\/([^/]+)$/.exec(p))) {
      const id = decodeURIComponent(seg[1]);
      const w = state.finishedOneOff?.id === id ? state.finishedOneOff : D.allWorkouts.find((x) => x.id === id);
      res = w ? json(w) : problem(404, "not-found", "Not found");
    } else if (m === "GET" && p === "/v1/personal-records") {
      const ex = url.searchParams.get("exerciseId");
      const wo = url.searchParams.get("workoutId");
      res = json({ records: D.records.filter((r) => (!ex || r.exerciseId === ex) && (!wo || r.workoutId === wo)) });
    } else if (m === "GET" && (seg = /^\/v1\/progress\/exercises\/([^/]+)$/.exec(p))) {
      const series = D.progressFor(decodeURIComponent(seg[1]));
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      series.points = series.points.filter((pt) => (!from || pt.localDate >= from) && (!to || pt.localDate <= to));
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
      const we = D.active.exercises.find((e) => e.id === decodeURIComponent(seg[1]));
      const t = new Date().toISOString();
      res = json({
        id: crypto.randomUUID(), workoutExerciseId: decodeURIComponent(seg[1]), clientGeneratedId: b.clientGeneratedId ?? null,
        setNumber: (we?.sets.length ?? 0) + 1, setType: b.setType ?? "working", reps: b.reps ?? null,
        weight: b.weight ?? null, weightUnit: b.weightUnit ?? null, weightKg: b.weightUnit === "lb" ? b.weight * 0.45359237 : b.weight ?? null,
        distance: b.distance ?? null, distanceUnit: b.distanceUnit ?? null, distanceM: null, durationS: b.durationS ?? null,
        rpe: b.rpe ?? null, isComplete: b.isComplete ?? true, completedAt: t, createdAt: t, updatedAt: t,
      }, 201);
    } else {
      unmatched.add(`${m} ${p}${url.search}`);
      console.warn(`  UNMATCHED ${m} ${url.pathname}${url.search}`);
      res = problem(404, "not-found", "Not served by the harness");
    }
    await route.fulfill(res);
  };
}

// --------------------------------------------------------------- layout evidence
// The app shell is a 100dvh grid whose <main> scrolls, so window scrolling / Playwright fullPage
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
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
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
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
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
        if ((pos === "fixed" || pos === "sticky") && vis(el)) pinnedRoots.add(el);
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
    await ctx.route((u) => u.pathname.startsWith("/v1/"), makeHandler(state));
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
      await shoot(page, device, "24-duration-exercise", "Plank current: Minutes / Seconds fields, no steppers");
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

    // Spec 18.0 AC49 (Phase B): the live header with and without a took, the Change Time sheet and the "Ends …" line.
    await tryStep("change time (live)", async () => {
      await go("/app/workouts");
      await shoot(page, device, "36-live-header", "Live header: the clock and Workout menu; Started and Change Time on row 2 (Spec 18.0 AC34)");
      await page.getByRole("button", { name: "Change Time" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "37-change-time-live", "Change Time sheet on a live workout: Day, Started at, Took, the hint (Spec 18.0 AC30)");
      const ahead = await page.evaluate(() => {
        const d = new Date(Date.now() + 60 * 60_000);
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
      await page.locator('ul[aria-label^="Exercises"] li button[aria-label]').first().click({ timeout: 4000 });
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "09-routine-item-sheet", "Routine editor item sheet for Bench Press (plan mode)");
      await page.keyboard.press("Escape");
    });

    await go(`/app/workouts/routines/new`);
    await shoot(page, device, "10-routine-new", "Routine editor, create mode (empty)");

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
    });

    await go(`/app/workouts/${D.ids.latestPush}`);
    await shoot(page, device, "11-workout-finished", "Finished workout (Push Day, 4 days ago) under the Workouts tab");

    await go("/app/history");
    await shoot(page, device, "12-history", "History list (12 finished workouts: badges with counts, and rows with none)");
    await go(`/app/history/${D.ids.latestFinished}`);
    await shoot(page, device, "13-history-detail", "History detail: Lower A, 2 days ago, with PR block");
    // #107: Back and the Workout menu lead the summary; open, the menu reveals Delete workout.
    await page.getByRole("button", { name: "Workout menu" }).click();
    await shoot(page, device, "13a-history-detail-menu", "History detail with the Workout menu open (#107)");
    // Spec 17.2 AC40: the summary in its other states.
    await tryStep("record-card summaries", async () => {
      await go(`/app/history/${D.ids.firstWorkout}`);
      await shoot(page, device, "27-summary-first-record", "The first Push Day: the one record it still holds is a first record ('First record' in brass, no gain, no was)");
      await go(`/app/history/${D.ids.noRecords}`);
      await shoot(page, device, "28-summary-no-records", "A light day: stats with volume, no records section, no brass");
      await go(`/app/history/${D.ids.volumeOnly}`);
      await shoot(page, device, "29-summary-volume-only", "Only a set-volume record: the section is hidden and History shows no badge for it");
      await go(`/app/history/${D.ids.plankOnly}`);
      await shoot(page, device, "30-summary-no-volume", "A plank-only session: three stats, no volume, no records");
    });

    // Spec 18.0 AC49: the summary's Edit workout, the edit screen, its sheets and the last-set dialog.
    await tryStep("edit past workouts", async () => {
      await go(`/app/history/${D.ids.latestPush}`);
      await shoot(page, device, "31-summary-edit", "Summary with a title, two-line notes and Edit workout under the stats (Spec 18.0)");
      await go(`/app/history/${D.ids.latestPush}/edit`);
      await shoot(page, device, "32-edit-screen", "Edit screen: banner, header, Details panel, sectioned cards with a superset, Done (Spec 18.0)");
      await page.getByRole("button", { name: /^Add set to Bench/ }).first().click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "33-edit-add-set", "Add set sheet, copied forward from the last set (Spec 18.0 AC8)");
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
      await page.getByRole("dialog", { name: "Delete this whole workout instead?" }).waitFor({ timeout: 4000 });
      await page.waitForTimeout(200);
      await shoot(page, device, "35-edit-last-set", "Delete the only set: Delete this whole workout instead? (Spec 18.0 AC18)");
      await page.keyboard.press("Escape");
      await go(`/app/history/${D.ids.latestPush}/edit`);
      await page.getByRole("button", { name: "Change Time" }).click();
      await page.waitForSelector("dialog[open]", { timeout: 4000 });
      await shoot(page, device, "41-change-time-edit", "Change Time on a finished workout: Took required, no hint (Spec 18.0 AC40)");
      await page.keyboard.press("Escape");
    });

    await go("/app/progress");
    await shoot(page, device, "14-progress", "Progress list (exercises with records)");
    await go(`/app/progress/${D.ids.bench}`);
    await shoot(page, device, "15-progress-bench", "Exercise progress chart: Bench Press");
    await go(`/app/progress/${D.ids.pullUp}`);
    await shoot(page, device, "16-progress-pullup", "Exercise progress chart: Pull-up (bodyweight, reps metric)");

    await go("/app/profile");
    await shoot(page, device, "17-profile", "Profile: settings form, export, sign out, delete account");
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
    await anon.route((u) => u.pathname.startsWith("/v1/"), makeHandler({ active: false }));
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
      await small.route((u) => u.pathname.startsWith("/v1/"), makeHandler({ active: false }));
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

  // The Light / Dark / System override (Spec 17.0 AC18): Profile on a light OS with Dark stored.
  {
    THEME = "override-dark";
    const ctx = await browser.newContext({ ...DEVICES.mobile, colorScheme: "light", timezoneId: "America/Chicago", locale: "en-US" });
    await ctx.addInitScript(() => { try { window.localStorage.setItem("sin:pref:theme", "dark"); } catch { /* storage blocked */ } });
    await ctx.route((u) => u.pathname.startsWith("/v1/"), makeHandler({ active: false }));
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
    await anon.route((u) => u.pathname.startsWith("/v1/"), makeHandler({ active: false }));
    const ap = await anon.newPage();
    await ap.goto(BASE + "/");
    await shoot(ap, "mobile", "00-landing", "Landing on a light OS with the Dark override stored");
    await anon.close();
  }
} finally {
  await browser.close();
}

// Spec 17.1 AC24: every enabled, visible control on the session screens is at least 44 px in both axes.
const SESSION_SHOTS = /\/(01|03|04|2[2-6])-/;
const tooSmall = report.filter((r) => r.file && SESSION_SHOTS.test(r.file) && r.smallTargets?.length);
for (const r of tooSmall) console.error(`  SMALL TARGETS ${r.file}: ${r.smallTargets.join("; ")}`);
if (tooSmall.length) process.exitCode = 1;
if (frontDoor.some((f) => f.violations.length)) process.exitCode = 1;
fs.writeFileSync(path.join(OUT, "_report.json"), JSON.stringify({ base: BASE, report, frontDoor, unmatched: [...unmatched], consoleErrors }, null, 1));
console.log(`\nunmatched API requests: ${unmatched.size ? [...unmatched].join(", ") : "none"}`);
console.log(`console errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 20)) console.log("  " + e);
