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

  it("is idempotent — a second signal is ignored", async () => {
    const app = { close: vi.fn(async () => {}) };
    const prisma = { $disconnect: vi.fn(async () => {}) };
    const exit = vi.fn<(code: number) => void>();

    const shutdown = createGracefulShutdown({ app, prisma, exit });
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
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
