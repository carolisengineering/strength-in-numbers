import { z } from "zod";

/**
 * Typed, fail-fast web configuration (Spec 04.0 §6.2 / §8).
 *
 * `loadConfig` is pure — it takes an env bag (`import.meta.env`) and returns a
 * frozen Config, or throws ConfigError naming every offending `VITE_*` var so
 * the boot-time `console.error` is actionable. `bootstrap.tsx` calls it once
 * before React mounts; an invalid config renders the static "misconfigured"
 * fallback instead of a blank screen (§6, §9, AC2).
 *
 * Kept React-free and DOM-free, mirroring `apps/api/src/config.ts`.
 */

export class ConfigError extends Error {
  override readonly name = "ConfigError";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid web configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
    );
    this.issues = issues;
  }
}

const APP_ENVS = ["local", "staging", "production"] as const;

/** True for a parseable absolute `http(s)` URL. */
const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const schema = z.object({
  // Auth0 tenant domain — a bare host (`tenant.us.auth0.com`): no scheme, no path.
  VITE_AUTH0_DOMAIN: z
    .string()
    .trim()
    .min(1, "is required")
    .refine(
      (v) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(v),
      "must be a bare host with no scheme (drop the https://)",
    )
    .refine((v) => !v.includes("/"), "must not contain a path or trailing slash"),

  VITE_AUTH0_CLIENT_ID: z.string().trim().min(1, "is required"),

  // Auth0 API audience — an https URL identifier; must equal the API's
  // AUTH0_AUDIENCE (Spec 01).
  VITE_AUTH0_AUDIENCE: z
    .string()
    .trim()
    .min(1, "is required")
    .refine(isHttpUrl, "must be an http(s) URL"),

  // Backend origin the API client prefixes onto `/v1/...` — no trailing slash.
  VITE_API_BASE_URL: z
    .string()
    .trim()
    .min(1, "is required")
    .refine(isHttpUrl, "must be an http(s) URL")
    .refine((v) => !v.endsWith("/"), "must not have a trailing slash"),

  // Gates dev-hard vs prod-warn response validation (§6.4 / Q15). Optional.
  VITE_APP_ENV: z.enum(APP_ENVS).default("local"),
});

export interface Config {
  readonly VITE_AUTH0_DOMAIN: string;
  readonly VITE_AUTH0_CLIENT_ID: string;
  readonly VITE_AUTH0_AUDIENCE: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_APP_ENV: (typeof APP_ENVS)[number];
}

export function loadConfig(env: Record<string, unknown>): Config {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const varName = String(issue.path[0] ?? "(config)");
      // A var absent from the environment gets a uniform "is required",
      // whichever Zod issue code the missing key produced.
      const absent = varName !== "(config)" && env[varName] === undefined;
      return `${varName}: ${absent ? "is required" : issue.message}`;
    });
    throw new ConfigError([...new Set(issues)]);
  }

  return Object.freeze({
    VITE_AUTH0_DOMAIN: parsed.data.VITE_AUTH0_DOMAIN,
    VITE_AUTH0_CLIENT_ID: parsed.data.VITE_AUTH0_CLIENT_ID,
    VITE_AUTH0_AUDIENCE: parsed.data.VITE_AUTH0_AUDIENCE,
    VITE_API_BASE_URL: parsed.data.VITE_API_BASE_URL,
    VITE_APP_ENV: parsed.data.VITE_APP_ENV,
  });
}

let memoized: Config | undefined;

/**
 * Memoised singleton config for app code (Spec 04.0 §6.2 / §6.3). Parses
 * `import.meta.env` once and caches it. `bootstrap()` is the first caller, from
 * inside its try/catch, so an invalid config surfaces as the static fallback
 * page and nothing downstream (the Auth0 provider in step 4, later screens) ever
 * sees the throw. Tests use the pure `loadConfig(env)` primitive instead.
 */
export function getConfig(): Config {
  memoized ??= loadConfig(import.meta.env as Record<string, unknown>);
  return memoized;
}

/** Test-only: drop the memoised config so the next `getConfig()` re-parses. */
export function resetConfigCache(): void {
  memoized = undefined;
}
