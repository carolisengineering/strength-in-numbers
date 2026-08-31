import { describe, it, expect, vi } from "vitest";
import { createGracefulShutdown } from "../../src/shutdown.js";

describe("createGracefulShutdown (Criterion 13)", () => {
  it("drains the app, then closes the pool, then exits 0", async () => {
    const order: string[] = [];
    const app = {
      close: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("app.close");
      }),
    };
    const prisma = {
      $disconnect: vi.fn(async () => {
        order.push("prisma.$disconnect");
      }),
    };
    const exit = vi.fn<(code: number) => void>();

    await createGracefulShutdown({ app, prisma, exit })("SIGTERM");

    expect(order).toEqual(["app.close", "prisma.$disconnect"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does not start a second drain; a second signal forces exit(1)", async () => {
    let releaseClose!: () => void;
    const app = {
      close: vi.fn(
        () => new Promise<void>((resolve) => (releaseClose = resolve)),
      ),
    };
    const prisma = { $disconnect: vi.fn(async () => {}) };
    const exit = vi.fn<(code: number) => void>();

    const shutdown = createGracefulShutdown({
      app,
      prisma,
      exit,
      drainTimeoutMs: 10_000,
    });

    const first = shutdown("SIGTERM"); // starts draining, awaits close()
    await shutdown("SIGINT"); // second signal → force exit
    expect(exit).toHaveBeenCalledWith(1);
    expect(app.close).toHaveBeenCalledTimes(1);

    releaseClose();
    await first;
  });

  it("forces exit(1) when the drain exceeds drainTimeoutMs", async () => {
    const app = { close: vi.fn(() => new Promise<void>(() => {})) }; // never resolves
    const prisma = { $disconnect: vi.fn(async () => {}) };
    const exit = vi.fn<(code: number) => void>();

    await createGracefulShutdown({ app, prisma, exit, drainTimeoutMs: 25 })(
      "SIGTERM",
    );

    expect(exit).toHaveBeenCalledWith(1);
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });

  it("exits 1 when draining throws", async () => {
    const app = {
      close: vi.fn(async () => {
        throw new Error("drain failed");
      }),
    };
    const prisma = { $disconnect: vi.fn(async () => {}) };
    const exit = vi.fn<(code: number) => void>();

    await createGracefulShutdown({ app, prisma, exit })("SIGTERM");

    expect(prisma.$disconnect).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
