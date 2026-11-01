import { Prisma, type PrismaClient } from "@prisma/client";

type Tagged = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

/**
 * The real client, with every `$queryRaw` and `$executeRaw` run inside `$transaction` recorded (its SQL text, in
 * order) on its way through. Everything else passes through unchanged. For tests that pin a statement's shape or
 * order against a real database (minors 207, 286). Only the interactive `$transaction(fn)` form is wrapped, and the
 * `Unsafe` raw calls are not recorded: a test of code that uses either needs this helper extended first.
 */
export function recordingClient(prisma: PrismaClient): { client: PrismaClient; seen: string[] } {
  const seen: string[] = [];
  const recordingTx = (tx: object) =>
    new Proxy(tx, {
      get(target, key) {
        const value = Reflect.get(target, key) as unknown;
        if (key === "$queryRaw" || key === "$executeRaw") {
          return (strings: TemplateStringsArray, ...values: unknown[]) => {
            seen.push(Prisma.sql(strings, ...values).sql);
            return (value as Tagged).call(target, strings, ...values);
          };
        }
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  const client = new Proxy(prisma, {
    get(target, key) {
      if (key === "$transaction") {
        return (fn: (tx: object) => Promise<unknown>, opts?: unknown) => target.$transaction((tx) => fn(recordingTx(tx)), opts as never);
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as PrismaClient;
  return { client, seen };
}
