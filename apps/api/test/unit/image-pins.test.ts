import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POSTGRES_IMAGE } from "../integration/postgres-image.js";

/**
 * Issue #9 — container images are pinned to a patch tag + sha256 digest, and
 * Dependabot keeps the Dockerfile / docker-compose.yml references current. It
 * cannot see the Testcontainers string, so this tripwire fails CI whenever a
 * compose bump lands without the matching one-line edit in
 * test/integration/postgres-image.ts.
 */
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (rel: string) => readFileSync(new URL(rel, `file://${repoRoot}`), "utf8");

// `name:patch-tag@sha256:<64 hex>` — Dependabot updates the tag and digest together.
const PINNED = /^[a-z0-9./-]+:\d+\.\d+(\.\d+)?-[a-z0-9-]+@sha256:[0-9a-f]{64}$/;

function composeDbImage(): string {
  const lines = read("docker-compose.yml").match(/^\s+image:\s*(\S+)\s*$/gm) ?? [];
  expect(lines, "docker-compose.yml should declare exactly one `image:`").toHaveLength(1);
  return lines[0]!.replace(/^\s+image:\s*/, "").trim();
}

describe("#9 — container images are digest-pinned", () => {
  it("Dockerfile base image is pinned to a patch tag + digest", () => {
    // Each `FROM [--flag…] <ref> [AS <alias>]`; refs naming an earlier stage's
    // alias are internal, everything else is an external image.
    const froms = read("Dockerfile").match(/^FROM\s+.*$/gm) ?? [];
    const aliases = new Set<string>();
    const external: string[] = [];
    for (const line of froms) {
      const tokens = line.split(/\s+/).slice(1).filter((t) => !t.startsWith("--"));
      const ref = tokens[0]!;
      if (!aliases.has(ref)) external.push(ref);
      const alias = tokens[1]?.toUpperCase() === "AS" ? tokens[2] : undefined;
      if (alias) aliases.add(alias);
    }
    expect(external).toHaveLength(1);
    expect(external[0]).toMatch(/^node:/);
    expect(external[0]).toMatch(PINNED);
  });

  it("docker-compose db image is pinned to a patch tag + digest", () => {
    const image = composeDbImage();
    expect(image).toMatch(/^postgres:/);
    expect(image).toMatch(PINNED);
  });

  it("Testcontainers uses the same Postgres image as docker-compose", () => {
    expect(POSTGRES_IMAGE).toBe(composeDbImage());
  });
});

// Spec 13.0 AC14 — observability images: upstream tags have no distro suffix
// (prom/prometheus:v3.15.0, grafana/grafana:13.2.3), so a looser tag pattern.
const PINNED_PLAIN = /^[a-z0-9./-]+:v?\d+\.\d+\.\d+(-[a-z0-9-]+)?@sha256:[0-9a-f]{64}$/;

describe("Spec 13.0 AC14 — observability compose images are digest-pinned", () => {
  it("pins prometheus, tempo and grafana", () => {
    const images = (read("docker-compose.observability.yml").match(/^\s+image:\s*(\S+)\s*$/gm) ?? []).map((l) =>
      l.replace(/^\s+image:\s*/, "").trim(),
    );
    expect(images.map((i) => i.split(":")[0]).sort()).toEqual(["grafana/grafana", "grafana/tempo", "prom/prometheus"]);
    for (const i of images) expect(i).toMatch(PINNED_PLAIN);
  });
});
