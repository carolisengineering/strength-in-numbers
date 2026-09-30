import { describe, it, expect } from "vitest";
import { resolveDatabaseUrl } from "../../src/db.js";

describe("resolveDatabaseUrl (Spec 01 §8 Q9)", () => {
  it("backfills sslmode=require and connection_limit when absent", () => {
    const out = new URL(
      resolveDatabaseUrl("postgresql://u:p@host:5432/sin"),
    );
    expect(out.searchParams.get("sslmode")).toBe("require");
    expect(out.searchParams.get("connection_limit")).toBe("8");
  });

  it("leaves an explicit connection_limit and sslmode untouched", () => {
    const out = new URL(
      resolveDatabaseUrl(
        "postgresql://u:p@host:5432/sin?sslmode=prefer&connection_limit=20",
      ),
    );
    expect(out.searchParams.get("sslmode")).toBe("prefer");
    expect(out.searchParams.get("connection_limit")).toBe("20");
  });
});

describe("resolveDatabaseUrl — server certificate verification (#8)", () => {
  it("backfills sslaccept=strict so Prisma validates the chain and hostname", () => {
    const out = new URL(resolveDatabaseUrl("postgresql://u:p@host:5432/sin"));
    expect(out.searchParams.get("sslaccept")).toBe("strict");
  });

  it("backfills sslaccept=strict alongside an explicit sslmode=require", () => {
    const out = new URL(
      resolveDatabaseUrl("postgresql://u:p@host:5432/sin?sslmode=require"),
    );
    expect(out.searchParams.get("sslaccept")).toBe("strict");
  });

  it("leaves an explicit sslaccept untouched", () => {
    const out = new URL(
      resolveDatabaseUrl(
        "postgresql://u:p@host:5432/sin?sslmode=require&sslaccept=accept_invalid_certs",
      ),
    );
    expect(out.searchParams.get("sslaccept")).toBe("accept_invalid_certs");
  });

  it("does not add sslaccept when TLS is disabled (local compose)", () => {
    const out = new URL(
      resolveDatabaseUrl("postgresql://sin:sin@localhost:5433/sin?sslmode=disable"),
    );
    expect(out.searchParams.has("sslaccept")).toBe(false);
  });

  // Prisma's engine only knows disable / prefer / require and silently
  // downgrades anything else to `prefer` — so a libpq-style verify-full would
  // make TLS *optional*. Fail at boot instead.
  it.each(["verify-full", "verify-ca"])("rejects sslmode=%s, which Prisma would downgrade to prefer", (mode) => {
    expect(() =>
      resolveDatabaseUrl(`postgresql://u:p@host:5432/sin?sslmode=${mode}`),
    ).toThrow(/sslaccept=strict/);
  });
});
