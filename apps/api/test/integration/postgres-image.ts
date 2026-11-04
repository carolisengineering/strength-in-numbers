import { readFileSync } from "node:fs";

/**
 * The Postgres image Testcontainers runs the integration suite (and the
 * `bench:*` scripts) against.
 *
 * Issue #9: it is read from `services.db.image` in the root
 * docker-compose.yml, so compose is the one pin. Dependabot bumps compose and
 * cannot see a TypeScript file, so a second copy here used to fail every
 * Postgres bump (PR #255). The `image-pins` unit test checks the compose pin's
 * format and that this file holds no digest of its own.
 */
export const POSTGRES_IMAGE = dbImageFromCompose(
  readFileSync(new URL("../../../../docker-compose.yml", import.meta.url), "utf8"),
);

/**
 * The `image:` of the `db` service in a compose file. A small line scan, not
 * a YAML parser: a service is a 2-space key under `services:`, and only an
 * `image:` at 4 spaces inside `db` counts. Throws if there is none.
 */
export function dbImageFromCompose(yaml: string): string {
  let inServices = false;
  let service: string | undefined;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inServices = /^services:\s*$/.test(line);
      service = undefined;
      continue;
    }
    if (!inServices) continue;
    const key = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (key) {
      service = key[1];
      continue;
    }
    const image = /^ {4}image:\s*(\S+)\s*$/.exec(line);
    if (image && service === "db") return image[1]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  throw new Error("docker-compose.yml has no services.db.image");
}
