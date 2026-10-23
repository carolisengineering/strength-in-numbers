import { describe, expect, it, vi } from "vitest";

const constructed = vi.hoisted(() => [] as unknown[]);
vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      constructed.push(options);
    }
  },
}));

const { prismaFor, resolveDatabaseUrl } = await import("../../src/db.js");

describe("#21 — one Prisma client factory for the server and the operator CLIs", () => {
  it("prismaFor always resolves the raw URL (TLS + pool backfill) and sets the app's log levels", () => {
    constructed.length = 0;
    const raw = "postgresql://u:p@host:5432/sin";
    prismaFor(raw);
    expect(constructed).toEqual([{ datasourceUrl: resolveDatabaseUrl(raw), log: ["warn", "error"] }]);
    expect(new URL((constructed[0] as { datasourceUrl: string }).datasourceUrl).searchParams.get("sslaccept")).toBe("strict");
  });

  it("the seed and records CLIs build their client through prismaFor, not new PrismaClient", async () => {
    const { readFileSync } = await import("node:fs");
    for (const path of ["../../src/seed/cli.ts", "../../src/records/cli.ts"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source, path).toContain("prismaFor(databaseUrl)");
      expect(source, path).not.toContain("new PrismaClient");
    }
  });
});
