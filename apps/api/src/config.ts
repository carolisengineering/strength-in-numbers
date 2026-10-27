import { z } from "zod";
import type { ClientIpSource } from "./plugins/rate-limit.js";
import { DEFAULT_SERVICE_NAME, parseTelemetryEnv, type TelemetryConfig } from "./telemetry/config.js";

/**
 * Typed, fail-fast configuration (Spec 01 §8).
 *
 * `loadConfig` is pure — it takes an env bag and returns a frozen Config or
 * throws ConfigError naming every offending variable. `server.ts` calls it once
 * with `process.env` before binding a port (Spec 01 §2 criterion 2).
 */

export class ConfigError extends Error {
  override readonly name = "ConfigError";
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.issues = issues;
  }
}

const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

const isBareOrigin = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // An origin has no path, query, or fragment and stringifies back to itself.
  return (
    url.origin === value &&
    (url.pathname === "" || url.pathname === "/") &&
    value.endsWith("/") === false
  );
};

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),

  PORT: z
    .string()
    .regex(/^\d+$/, "must be an integer")
    .transform(Number)
    .refine((n) => n >= 1 && n <= 65535, "must be between 1 and 65535"),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (v) => v.startsWith("postgres://") || v.startsWith("postgresql://"),
      "must be a postgres:// connection string",
    )
    // Prisma's engine only knows disable / prefer / require and silently
    // downgrades anything else (libpq's verify-ca / verify-full) to `prefer`
    // — TLS optional. Fail here so it surfaces as a ConfigError at boot (#8).
    .refine(
      (v) => {
        try {
          const mode = new URL(v).searchParams.get("sslmode");
          return mode === null || ["disable", "prefer", "require"].includes(mode);
        } catch {
          return true; // an unparseable URL is Prisma's problem to report
        }
      },
      "sslmode must be disable, prefer or require (Prisma ignores verify-full); use sslmode=require&sslaccept=strict for certificate verification",
    ),

  AUTH0_ISSUER: z
    .url("must be a URL")
    .refine(
      (v) => v.startsWith("https://") || v.startsWith("http://"),
      "must be an http(s) URL",
    )
    .refine((v) => v.endsWith("/"), "must end with a trailing slash"),

  AUTH0_AUDIENCE: z.string().min(1, "is required"),

  AUTH0_CLAIM_NAMESPACE: z
    .url("must be a URL")
    .refine((v) => v.endsWith("/"), "must end with a trailing slash"),

  WEB_ORIGIN: z
    .string()
    .min(1, "is required")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .refine((list) => list.length > 0, "must list at least one origin")
    .refine(
      (list) => list.every(isBareOrigin),
      "each entry must be a bare scheme://host[:port] origin (no path, no wildcard)",
    ),

  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),

  // #127: trimmed here, and this one value is the log `service` and the trace resource name (D17).
  SERVICE_NAME: z.string().trim().min(1).default(DEFAULT_SERVICE_NAME),

  // Spec 15 AC25: which proxy chain the client address comes from (`clientAddress()`, plugins/rate-limit.ts).
  CLIENT_IP_SOURCE: z.enum(["render", "cloud-run"]).default("render"),

  // Spec 19.0 AC16: the Hevy integration's allow-list. Unset or empty means nobody; whitespace trimmed.
  HEVY_ENABLED_USER_IDS: z
    .string()
    .optional()
    .transform((s) =>
      (s ?? "")
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter((id) => id.length > 0),
    )
    .refine((ids) => ids.every((id) => z.guid().safeParse(id).success), "must be a comma-separated list of user ids"),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV !== "production") return;

  // In production every trusted URL must be TLS. Plain http is only ever for a
  // local dev IdP stand-in / dev SPA (Spec 01 §7).
  if (!data.AUTH0_ISSUER.startsWith("https://")) {
    ctx.addIssue({
      code: "custom",
      path: ["AUTH0_ISSUER"],
      message: "must be https in production",
    });
  }

  const insecureOrigins = data.WEB_ORIGIN.filter(
    (o) => !o.startsWith("https://"),
  );
  if (insecureOrigins.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["WEB_ORIGIN"],
      message: `must be https in production (got: ${insecureOrigins.join(", ")})`,
    });
  }
});

const COMMIT_SHA = /^[0-9a-f]{40}$/;

/**
 * Spec 15 AC11: the commit this process was built from. `SIN_COMMIT` (the image's build argument), else
 * `RENDER_GIT_COMMIT` (Render's runtime env); the first non-blank, trimmed. Anything but 40 lowercase hex is "dev".
 */
export function resolveCommit(env: { SIN_COMMIT?: unknown; RENDER_GIT_COMMIT?: unknown }): string {
  const value = [env.SIN_COMMIT, env.RENDER_GIT_COMMIT]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find((v) => v !== "");
  return value !== undefined && COMMIT_SHA.test(value) ? value : "dev";
}

export interface Config {
  readonly nodeEnv: "development" | "test" | "production";
  readonly isProduction: boolean;
  readonly port: number;
  readonly databaseUrl: string;
  readonly auth0: {
    readonly issuer: string;
    readonly audience: string;
    readonly claimNamespace: string;
    readonly jwksUri: string;
  };
  readonly webOrigins: readonly string[];
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly telemetry: TelemetryConfig;
  readonly serviceName: string;
  /** Spec 15 AC11: reported by `/healthz`. */
  readonly commit: string;
  /** Spec 15 AC25: `render` (CF-Connecting-IP behind a private socket) or `cloud-run` (the right-most X-Forwarded-For). */
  readonly clientIpSource: ClientIpSource;
  /** Spec 19.0 AC16: the users the Hevy routes answer for; everyone else gets `404`. Frozen; never from the database. */
  readonly hevyEnabledUserIds: ReadonlySet<string>;
}

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, unknown>): Config {
  const parsed = schema.safeParse(env);
  // Spec 13.0 AC2: telemetry issues join the same ConfigError, so one boot
  // reports every bad variable.
  const telemetry = parseTelemetryEnv(env as Record<string, unknown>, parsed.success ? parsed.data.SERVICE_NAME : DEFAULT_SERVICE_NAME);

  if (!parsed.success || telemetry.issues.length > 0) {
    const env0 = env as Record<string, unknown>;
    const issues = (parsed.success ? [] : parsed.error.issues).map((issue) => {
      const varName = String(issue.path[0] ?? "(config)");
      // A var absent from the environment gets a uniform "is required",
      // regardless of which Zod issue code the missing key produced
      // (`invalid_type` for a plain field, `invalid_value` for a bare enum).
      const absent = varName !== "(config)" && env0[varName] === undefined;
      return `${varName}: ${absent ? "is required" : issue.message}`;
    });
    throw new ConfigError([...new Set([...issues, ...telemetry.issues])]);
  }

  const c = parsed.data;
  return Object.freeze({
    nodeEnv: c.NODE_ENV,
    isProduction: c.NODE_ENV === "production",
    port: c.PORT,
    databaseUrl: c.DATABASE_URL,
    auth0: Object.freeze({
      issuer: c.AUTH0_ISSUER,
      audience: c.AUTH0_AUDIENCE,
      claimNamespace: c.AUTH0_CLAIM_NAMESPACE,
      jwksUri: `${c.AUTH0_ISSUER}.well-known/jwks.json`,
    }),
    webOrigins: Object.freeze(c.WEB_ORIGIN),
    commit: resolveCommit(env as Record<string, unknown>),
    clientIpSource: c.CLIENT_IP_SOURCE,
    logLevel: c.LOG_LEVEL,
    serviceName: c.SERVICE_NAME,
    telemetry: telemetry.config,
    hevyEnabledUserIds: Object.freeze(new Set(c.HEVY_ENABLED_USER_IDS)),
  });
}
