/** Spec 16 AC6 — a target decides the base URL and the token source, nothing else. */
export type TargetName = "local" | "staging" | "prod";

export interface Target {
  name: TargetName;
  /** `undefined` for `prod` here: Phase B reads it from `infra/prod.tfvars`, and Phase A refuses `prod`. */
  baseUrl: string | undefined;
  tokenSource: "dev-idp" | "auth0";
}

const TARGETS: Record<TargetName, Target> = {
  local: { name: "local", baseUrl: "http://localhost:8080", tokenSource: "dev-idp" },
  staging: { name: "staging", baseUrl: "https://si-api-ft2f.onrender.com", tokenSource: "auth0" },
  prod: { name: "prod", baseUrl: undefined, tokenSource: "auth0" },
};

export const TARGET_NAMES = Object.keys(TARGETS) as TargetName[];

export function resolveTarget(name: string): Target {
  if (!Object.hasOwn(TARGETS, name)) {
    throw new Error(`Unknown target "${name}"; use one of ${TARGET_NAMES.join(", ")}`);
  }
  return { ...TARGETS[name as TargetName] };
}
