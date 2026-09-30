/**
 * The Postgres image Testcontainers runs the integration suite against.
 *
 * Must equal `services.db.image` in the root docker-compose.yml — the
 * `#9 — container images are digest-pinned` unit test enforces it. Dependabot
 * bumps compose but cannot see this file, so a compose PR fails CI until this
 * line is updated to match.
 */
export const POSTGRES_IMAGE =
  "postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";
