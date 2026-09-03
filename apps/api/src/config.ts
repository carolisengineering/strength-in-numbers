import { z } from "zod";

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

  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),

  SERVICE_NAME: z.string().min(1).default("si-api"),
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
  readonly otelExporterUrl: string | undefined;
  readonly serviceName: string;
}

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, unknown>): Config {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const env0 = env as Record<string, unknown>;
    const issues = parsed.error.issues.map((issue) => {
      const varName = String(issue.path[0] ?? "(config)");
      // A var absent from the environment gets a uniform "is required",
      // regardless of which Zod issue code the missing key produced
      // (`invalid_type` for a plain field, `invalid_value` for a bare enum).
      const absent = varName !== "(config)" && env0[varName] === undefined;
      return `${varName}: ${absent ? "is required" : issue.message}`;
    });
    throw new ConfigError([...new Set(issues)]);
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
    logLevel: c.LOG_LEVEL,
    otelExporterUrl: c.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: c.SERVICE_NAME,
  });
}
