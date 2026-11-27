import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false,
    isAuthenticated: true,
    error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { API_BASE_URL } from "../../test/catalogHarness";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

function setup(recordTypes: ("heaviest_weight" | "best_est_1rm" | "best_set_volume")[]) {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ reps: 5, weight: 100, weightKg: 100 })] }],
  });
  const e = workout.exercises[0]!;
  const records = recordTypes.map((recordType) =>
    makePersonalRecord({
      workoutId: workout.id,
      exerciseId: e.exerciseId,
      sourceExerciseId: e.exerciseId,
      sourceSetId: e.sets[0]!.id,
      recordType,
      unit: recordType === "best_set_volume" ? "kg_reps" : "kg",
      value: recordType === "best_set_volume" ? 500 : 100,
      previousValue: recordType === "best_set_volume" ? 450 : 90,
    }),
  );
  prepareApp({ auth, fake: createWorkoutFake({ finished: [workout], records }) });
  return { workout, ...renderApp("/app/history") };
}

/** A finished workout of `lifts` exercises, each holding a weight and an estimate record, beaten unless `firstOnly`. */
function setupLifts(lifts: number, { firstOnly = false } = {}) {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: Array.from({ length: lifts }, (_, i) => ({ modality: "weight_reps" as const, name: `Lift ${i + 1}`, sets: [makeSet({ reps: 5, weight: 100, weightKg: 100 })] })),
  });
  const records = workout.exercises.flatMap((e) =>
    (["heaviest_weight", "best_est_1rm"] as const).map((recordType) =>
      makePersonalRecord({
        workoutId: workout.id,
        exerciseId: e.exerciseId,
        sourceExerciseId: e.exerciseId,
        exerciseName: e.exerciseNameSnapshot,
        sourceSetId: e.sets[0]!.id,
        recordType,
        value: 100,
        previousValue: firstOnly ? null : 90,
      }),
    ),
  );
  prepareApp({ auth, fake: createWorkoutFake({ finished: [workout], records }) });
  return { workout, ...renderApp("/app/history") };
}

describe("07.6 AC15 — the badge names lifts", () => {
  it("three lifts that each beat two records: 'PR on 3 lifts', named 'Records on 3 lifts'", async () => {
    setupLifts(3);
    const row = await screen.findByRole("link", { name: /Lift 1/ });
    expect(within(row).getByRole("img", { name: "Records on 3 lifts" })).toHaveTextContent("PR on 3 lifts");
  });

  it("one lift: 'PR on 1 lift', named 'Records on 1 lift'", async () => {
    setupLifts(1);
    const row = await screen.findByRole("link", { name: /Lift 1/ });
    expect(within(row).getByRole("img", { name: "Records on 1 lift" })).toHaveTextContent("PR on 1 lift");
  });

  it("first-ever records only: no badge", async () => {
    setupLifts(2, { firstOnly: true });
    const row = await screen.findByRole("link", { name: /Lift 1/ });
    expect(within(row).queryByRole("img")).toBeNull();
  });
});

describe("07.6 AC17 — the fake counts lifts, as the API does", () => {
  it("six beaten non-volume rows over three lifts serve recordCount 3", async () => {
    setupLifts(3);
    const body = (await (await fetch(`${API_BASE_URL}/v1/workouts?limit=20`)).json()) as { items: { recordCount: number }[] };
    expect(body.items[0]!.recordCount).toBe(3);
  });
});

describe("17.2 AC34 / 07.6 AC16 — the History row and the summary agree", () => {
  it("weight, estimate and set volume beaten on one lift: the row says 'PR on 1 lift' and the summary counts 1 lift", async () => {
    const { workout, router } = setup(["heaviest_weight", "best_est_1rm", "best_set_volume"]);
    const row = await screen.findByRole("link", { name: /Bench Press/ });
    expect(within(row).getByRole("img", { name: "Records on 1 lift" })).toHaveTextContent("PR on 1 lift");
    await act(() => router.navigate(`/app/history/${workout.id}`));
    expect(await screen.findByRole("region", { name: "Records from this workout on 1 lift" })).toBeInTheDocument();
  });

  it("a workout whose only record is set volume has no badge and no records section", async () => {
    const { workout, router } = setup(["best_set_volume"]);
    const row = await screen.findByRole("link", { name: /Bench Press/ });
    expect(within(row).queryByRole("img")).toBeNull();
    await act(() => router.navigate(`/app/history/${workout.id}`));
    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /record/i })).toBeNull();
  });
});

describe("17.2 AC32 / 07.6 AC17 — the web never re-derives recordCount", () => {
  it("HistoryRow only compares recordCount to zero and prints it", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "HistoryRow.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Spec 07.6: the one place it is printed is the copy helper, which only formats the number it is given.
    expect(code.match(/historyBadgeText\(workout\.recordCount\)/g)).toHaveLength(1);
    const rest = code.replace("historyBadgeText(workout.recordCount)", "");
    const uses = [...rest.matchAll(/recordCount[^\n]*/g)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((u) => /^recordCount\s*>\s*0/.test(u))).toBe(true); // otherwise only compared to zero
    expect(src).not.toMatch(/recordCount\s*[-+*/]/);
  });

  it("the copy helpers print the count without arithmetic (minor 676)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const [file, name] of [["historyCopy.ts", "historyBadgeText"], ["../records/recordLedger.ts", "liftCountText"]] as const) {
      const use = countUse(readFileSync(join(here, file), "utf8"), name);
      expect(use, `${file} ${name}`).not.toBeNull();
      expect(use!.used, `${file} ${name}`).toBe(true);
      expect(use!.arithmetic, `${file} ${name}`).toEqual([]);
    }
  });

  it("minor 753: a renamed parameter and a multi-line return type are still read", () => {
    const sample = "export function f(count: number): {\n  visible: string;\n} {\n  return { visible: `${count + 1}` };\n}";
    const use = countUse(sample, "f");
    expect(use?.names).toEqual(["count"]);
    expect(use?.arithmetic).toEqual(["count + 1"]);
  });

  it("minor 782: the samples", () => {
    expect(countUse('function f(n: number) { return "lifts"; }', "f")?.used).toBe(false);
    expect(countUse("function f({ n }: { n: number }) { return `${n}`; }", "f")).toEqual({ names: ["n"], used: true, arithmetic: [] });
    expect(countUse("function f(n: number) { /* n - 1 is … */ return `${n}`; }", "f")?.arithmetic).toEqual([]);
    expect(countUse("function f(count: number) { return `${(count) + 1}`; }", "f")?.arithmetic).not.toEqual([]);
    expect(countUse("function f(n: number) { return `${-n}`; }", "f")?.arithmetic).toEqual(["-n"]);
    expect(countUse("function f(n: number) { return `${Math.max(n, 0)}`; }", "f")?.arithmetic).toEqual(["Math.max(n, 0)"]);
    expect(countUse("function f(n: number) { return `${x.n}`; }", "f")?.used).toBe(false);
  });
});

const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
]);
const UNARY = new Set([ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken]);

/**
 * Minors 753, 782: how a top-level function uses its first parameter, read with the TypeScript compiler, so a multi-line
 * return type, any name and a destructured parameter are read right, and comments (not nodes) are never read. `names`:
 * the parameter's identifier, or each name it destructures; `used`: the body names one as a value (not `x.n`'s `n`);
 * `arithmetic`: each arithmetic expression on one (parentheses removed), and each `Math.` call. Null when there's no such
 * function.
 */
function countUse(code: string, name: string): { names: string[]; used: boolean; arithmetic: string[] } | null {
  const file = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true);
  const fn = file.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
  const param = fn?.parameters[0]?.name;
  if (fn?.body === undefined || param === undefined) return null;
  const names: string[] = [];
  const collect = (binding: ts.BindingName): void => {
    if (ts.isIdentifier(binding)) names.push(binding.text);
    else for (const element of binding.elements) if (!ts.isOmittedExpression(element)) collect(element.name);
  };
  collect(param);
  const isName = (node: ts.Expression): boolean => {
    let inner = node;
    while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
    return ts.isIdentifier(inner) && names.includes(inner.text);
  };
  let used = false;
  const arithmetic: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && names.includes(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) used = true;
    if (ts.isBinaryExpression(node) && ARITHMETIC.has(node.operatorToken.kind) && (isName(node.left) || isName(node.right))) arithmetic.push(node.getText(file));
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && UNARY.has(node.operator) && isName(node.operand)) arithmetic.push(node.getText(file));
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Math") {
      arithmetic.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return { names, used, arithmetic };
}
