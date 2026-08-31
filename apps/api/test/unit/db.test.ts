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
        "postgresql://u:p@host:5432/sin?sslmode=verify-full&connection_limit=20",
      ),
    );
    expect(out.searchParams.get("sslmode")).toBe("verify-full");
    expect(out.searchParams.get("connection_limit")).toBe("20");
  });
});
