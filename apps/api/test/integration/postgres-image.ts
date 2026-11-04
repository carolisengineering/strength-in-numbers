/**
 * The Postgres image Testcontainers runs the integration suite against.
 *
 * Must equal `services.db.image` in the root docker-compose.yml — the
 * `#9 — container images are digest-pinned` unit test enforces it. Dependabot
 * bumps compose but cannot see this file, so a compose PR fails CI until this
 * line is updated to match.
 */
export const POSTGRES_IMAGE =
  "postgres:16.15-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab";
