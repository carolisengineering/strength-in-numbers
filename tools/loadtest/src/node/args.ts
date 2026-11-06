import { resolveTarget, type TargetName } from "../plan/targets.ts";
import type { RunType } from "../plan/schedule.ts";

/** Spec 16 §5 — `loadtest run <gym|push|burst> --target …`, `loadtest cleanup --target …`, `loadtest seed --target …`. */
export interface RunCommand {
  cmd: "run";
  type: RunType;
  target: TargetName;
  dryRun: boolean;
  /** 1 for gym and burst; above 1 for push (AC3, AC9). */
  push: number;
  allowUnpassedPush: boolean;
  /** Send k6's metrics to local Prometheus by remote write (D18); off with `--no-metrics-output`. */
  metricsOutput: boolean;
  /** How many accounts (default: the largest step). */
  lifters?: number;
  /** Dev only, local only: replace the step list. */
  steps?: number[];
  /** Dev only, local only: multiply every hold (for short checks). */
  holdScale?: number;
}

export type Command = RunCommand | { cmd: "cleanup" | "seed"; target: TargetName; lifters?: number };

export const USAGE =
  "usage: loadtest run <gym|push|burst> --target <local|staging|prod> [--lifters N] [--push F] [--dry-run] " +
  "[--allow-unpassed-push] [--no-metrics-output] [--steps a,b,c --hold-scale s (local only)]\n" +
  "       loadtest cleanup --target <…> [--lifters N]\n" +
  "       loadtest seed --target <…> [--lifters N]";

const positiveInt = (flag: string, v: string | undefined): number => {
  if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1) throw new Error(`${flag} needs a whole number of at least 1`);
  return Number(v);
};

export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  if (cmd !== "run" && cmd !== "cleanup" && cmd !== "seed") throw new Error(USAGE);

  let type: RunType | undefined;
  if (cmd === "run") {
    const t = rest.shift();
    if (t !== "gym" && t !== "push" && t !== "burst") throw new Error(`run type must be gym, push or burst\n${USAGE}`);
    type = t;
  }

  let target: string | undefined;
  let lifters: number | undefined;
  let push: number | undefined;
  let steps: number[] | undefined;
  let holdScale: number | undefined;
  let dryRun = false;
  let allowUnpassedPush = false;
  let metricsOutput = true;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i]!;
    const value = () => {
      const v = rest[i + 1];
      i += 1;
      return v;
    };
    if (flag === "--target") target = value();
    else if (flag === "--lifters") lifters = positiveInt("--lifters", value());
    else if (cmd === "run" && flag === "--push") {
      const v = value();
      push = Number(v);
      if (!(push > 1)) throw new Error("--push needs a factor above 1 (for example 2 or 4)");
    } else if (cmd === "run" && flag === "--dry-run") dryRun = true;
    else if (cmd === "run" && flag === "--allow-unpassed-push") allowUnpassedPush = true;
    else if (cmd === "run" && flag === "--no-metrics-output") metricsOutput = false;
    else if (cmd === "run" && flag === "--steps") steps = (value() ?? "").split(",").map((s) => positiveInt("--steps", s));
    else if (cmd === "run" && flag === "--hold-scale") {
      holdScale = Number(value());
      if (!(holdScale > 0 && holdScale <= 1)) throw new Error("--hold-scale needs a number in (0, 1]");
    } else throw new Error(`unknown flag ${flag}\n${USAGE}`);
  }

  if (target === undefined) throw new Error(`--target is required\n${USAGE}`);
  const resolved = resolveTarget(target);
  if (resolved.name !== "local") throw new Error(`${resolved.name} is not wired yet (Spec 16 Phase B)`);

  if (cmd !== "run") return lifters === undefined ? { cmd, target: resolved.name } : { cmd, target: resolved.name, lifters };

  if (type === "push" && push === undefined) throw new Error("a push run needs --push <factor above 1>");
  if (type !== "push" && push !== undefined) throw new Error(`--push only applies to a push run, not ${type}`);
  if ((steps !== undefined || holdScale !== undefined) && resolved.name !== "local") {
    throw new Error("--steps and --hold-scale are for local checks only");
  }
  return {
    cmd,
    type: type!,
    target: resolved.name,
    dryRun,
    push: push ?? 1,
    allowUnpassedPush,
    metricsOutput,
    ...(lifters !== undefined ? { lifters } : {}),
    ...(steps !== undefined ? { steps } : {}),
    ...(holdScale !== undefined ? { holdScale } : {}),
  };
}
