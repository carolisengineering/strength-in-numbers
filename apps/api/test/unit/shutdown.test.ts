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

describe("AC12 — telemetry flush on shutdown", () => {
  it("still flushes telemetry when the drain times out, then exits 1", async () => {
    const app = { close: vi.fn(() => new Promise<void>(() => {})) };
    const prisma = { $disconnect: vi.fn(async () => {}) };
    const telemetry = { shutdown: vi.fn(async () => {}) };
    const exit = vi.fn<(code: number) => void>();

    await createGracefulShutdown({ app, prisma, telemetry, exit, drainTimeoutMs: 25 })("SIGTERM");

    expect(telemetry.shutdown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still flushes telemetry when draining throws, then exits 1", async () => {
    const app = {
      close: vi.fn(async () => {
        throw new Error("drain failed");
      }),
    };
    const prisma = { $disconnect: vi.fn(async () => {}) };
    const telemetry = { shutdown: vi.fn(async () => {}) };
    const exit = vi.fn<(code: number) => void>();

    await createGracefulShutdown({ app, prisma, telemetry, exit })("SIGTERM");

    expect(telemetry.shutdown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("flushes telemetry after the drain and the pool close, then exits 0", async () => {
    const order: string[] = [];
    const app = { close: vi.fn(async () => void order.push("app.close")) };
    const prisma = { $disconnect: vi.fn(async () => void order.push("prisma.$disconnect")) };
    const telemetry = { shutdown: vi.fn(async () => void order.push("telemetry.shutdown")) };
    const exit = vi.fn<(code: number) => void>();

    await createGracefulShutdown({ app, prisma, telemetry, exit })("SIGTERM");

    expect(order).toEqual(["app.close", "prisma.$disconnect", "telemetry.shutdown"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("a hung flush is abandoned after telemetryTimeoutMs; still exits 0 with a warn (Review Focus 5)", async () => {
    const app = { close: vi.fn(async () => {}) };
    const prisma = { $disconnect: vi.fn(async () => {}) };
    const telemetry = { shutdown: vi.fn(() => new Promise<void>(() => {})) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const exit = vi.fn<(code: number) => void>();

    await createGracefulShutdown({ app, prisma, telemetry, logger, exit, telemetryTimeoutMs: 20 })("SIGTERM");

    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ telemetryTimeoutMs: 20 }), expect.stringMatching(/telemetry/));
  });

  it("a failing flush still exits 0 with a warn", async () => {
    const telemetry = { shutdown: vi.fn(async () => { throw new Error("export failed"); }) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const exit = vi.fn<(code: number) => void>();
    await createGracefulShutdown({
      app: { close: vi.fn(async () => {}) },
      prisma: { $disconnect: vi.fn(async () => {}) },
      telemetry, logger, exit,
    })("SIGTERM");
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("without telemetry the sequence is unchanged", async () => {
    const order: string[] = [];
    const exit = vi.fn<(code: number) => void>();
    await createGracefulShutdown({
      app: { close: vi.fn(async () => void order.push("app.close")) },
      prisma: { $disconnect: vi.fn(async () => void order.push("prisma.$disconnect")) },
      exit,
    })("SIGTERM");
    expect(order).toEqual(["app.close", "prisma.$disconnect"]);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
