/**
 * Spec 16 AC22 — the tool's secrets and settings live in one gitignored file, `tools/loadtest/.env.loadtest`
 * (`.env.example` lists the names). The CLI reads that file itself and never `process.env`, so a stray shell export
 * can't leak in. Errors name a variable, never a value; a `Secrets` object prints as "[redacted]".
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

export const ENV_FILE = fileURLToPath(new URL("../../.env.loadtest", import.meta.url));
const ENV_LABEL = "tools/loadtest/.env.loadtest";

export const RUN_SECRETS = [
  "AUTH0_DOMAIN",
  "AUTH0_AUDIENCE",
  "LOADTEST_AUTH0_CLIENT_ID",
  "LOADTEST_AUTH0_CLIENT_SECRET",
  "LOADTEST_AUTH0_CONNECTION",
  "LOADTEST_ACCOUNT_PASSWORD",
] as const;
/** `setup-accounts`: the Management credentials, plus what a created user needs. */
export const SETUP_SECRETS = [
  "AUTH0_DOMAIN",
  "LOADTEST_AUTH0_CONNECTION",
  "LOADTEST_ACCOUNT_PASSWORD",
  "AUTH0_MGMT_CLIENT_ID",
  "AUTH0_MGMT_CLIENT_SECRET",
] as const;
export const METRICS_SECRETS = ["GRAFANA_PROM_RW_URL", "GRAFANA_PROM_RW_USER", "GRAFANA_PROM_RW_TOKEN"] as const;
export const ANNOTATION_SECRETS = ["GRAFANA_URL", "GRAFANA_ANNOTATION_TOKEN"] as const;

export type SecretName =
  | (typeof RUN_SECRETS)[number]
  | (typeof SETUP_SECRETS)[number]
  | (typeof METRICS_SECRETS)[number]
  | (typeof ANNOTATION_SECRETS)[number];

export const SECRET_NAMES: readonly SecretName[] = [
  ...new Set<SecretName>([...RUN_SECRETS, ...SETUP_SECRETS, ...METRICS_SECRETS, ...ANNOTATION_SECRETS]),
];

/** The values that must never be printed. Domains, URLs, ids and the connection name are settings, not secrets. */
const SECRET_VALUES: ReadonlySet<SecretName> = new Set<SecretName>([
  "LOADTEST_AUTH0_CLIENT_SECRET",
  "LOADTEST_ACCOUNT_PASSWORD",
  "AUTH0_MGMT_CLIENT_SECRET",
  "GRAFANA_PROM_RW_TOKEN",
  "GRAFANA_ANNOTATION_TOKEN",
]);

/** `KEY=value` lines; `#` comments and blank lines skipped; an optional `export `; matching outer quotes stripped. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export class Secrets {
  readonly #values: ReadonlyMap<SecretName, string>;

  constructor(values: ReadonlyMap<SecretName, string>) {
    this.#values = values;
  }

  get(name: SecretName): string {
    const value = this.#values.get(name);
    if (value === undefined) throw new Error(`${name} was not loaded`);
    return value;
  }

  /** The loaded secret values, for redaction. */
  values(): string[] {
    return [...this.#values].filter(([name]) => SECRET_VALUES.has(name)).map(([, value]) => value);
  }

  toJSON(): string {
    return "[redacted]";
  }

  toString(): string {
    return "[redacted]";
  }

  [inspect.custom](): string {
    return "[redacted]";
  }
}

/** Picks `need` out of parsed values; a missing or empty variable throws, naming it (Review Focus 1). */
export function secretsFrom(values: Record<string, string>, need: readonly SecretName[]): Secrets {
  const picked = new Map<SecretName, string>();
  for (const name of need) {
    const value = values[name];
    if (value === undefined || value === "") throw new Error(`missing ${name} in ${ENV_LABEL}`);
    picked.set(name, value);
  }
  return new Secrets(picked);
}

export function loadSecrets(path: string, need: readonly SecretName[]): Secrets {
  if (!existsSync(path)) {
    throw new Error(`no ${ENV_LABEL}: copy tools/loadtest/.env.example and fill it in (runbook load-testing.md)`);
  }
  return secretsFrom(parseEnvFile(readFileSync(path, "utf8")), need);
}
