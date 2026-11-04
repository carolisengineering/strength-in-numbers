import type { PrismaClient } from "@prisma/client";

const RAW = new Set(["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]);

/**
 * A Prisma client that counts the raw statements each interactive transaction runs (#245, #246). Calls on the root
 * client (the unlocked preflight) are not counted; tagged-template calls are. Test-only.
 */
export function countingPrisma(prisma: PrismaClient): { client: PrismaClient; statements(): number; reset(): void } {
  let count = 0;
  const countingTx = (tx: object) =>
    new Proxy(tx, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof prop !== "string" || !RAW.has(prop) || typeof value !== "function") return value;
        return (...args: unknown[]) => {
          count++;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  const client = new Proxy(prisma, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop !== "$transaction" || typeof value !== "function") return value;
      return (arg: unknown, ...rest: unknown[]) =>
        typeof arg === "function"
          ? (value as (...a: unknown[]) => unknown).call(target, (tx: object) => (arg as (t: object) => unknown)(countingTx(tx)), ...rest)
          : (value as (...a: unknown[]) => unknown).call(target, arg, ...rest);
    },
  });
  return {
    client,
    statements: () => count,
    reset: () => {
      count = 0;
    },
  };
}
