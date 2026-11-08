// apps/api/src/db/app-role-cli.ts
/**
 * `pnpm --filter @sin/api run db:app-role` (Spec 21.1 AC29, §6.5): gives the restricted login `sin_app` its login and
 * password, then prints its flags and memberships. Runs on the OWNER login; the password comes from `APP_ROLE_PASSWORD`
 * or, in a terminal, a prompt with echo off. Idempotent: run it again to rotate the password.
 *
 * Exit 1 when the owner URL is missing, the password is shorter than 12 characters or cannot be read, the role is
 * missing or unclean (the output names each problem), or anything fails. The password is never printed, logged or put
 * in an error message.
 */
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "../db.js";
import { APP_ROLE, appRoleProblems, setAppRoleLogin, type AppRoleReport } from "./app-role.js";
import { ownerDatabaseUrl } from "./owner-url.js";

export const MIN_PASSWORD_LENGTH = 12;

export interface AppRoleIo {
  prompt(question: string): Promise<string>;
  out(s: string): void;
  err(s: string): void;
  isTTY: boolean;
}

/** A prompt that does not echo what is typed. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void };
    process.stdout.write(question);
    output._writeToOutput = () => undefined; // mute the echo of every keystroke
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const processIo: AppRoleIo = {
  prompt: promptHidden,
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
  isTTY: process.stdin.isTTY === true,
};

const yesNo = (b: boolean) => (b ? "yes" : "no");

function describeReport(r: AppRoleReport): string {
  return (
    `${r.rolname}: login ${yesNo(r.canLogin)}, superuser ${yesNo(r.superuser)}, bypassrls ${yesNo(r.bypassrls)}, ` +
    `createrole ${yesNo(r.createRole)}, createdb ${yesNo(r.createDb)}\n` +
    `memberOf: ${r.memberOf.length === 0 ? "none" : r.memberOf.join(", ")}\n`
  );
}

/** An error's text with every secret replaced: the message of a failed connect or statement may quote either. */
function redacted(err: unknown, secrets: readonly string[]): string {
  const name = (err as Error)?.constructor?.name ?? typeof err;
  let message = err instanceof Error ? err.message : String(err);
  for (const s of secrets) if (s.length > 0) message = message.split(s).join("***");
  return `${name}: ${message.split("\n").filter((l) => l.trim() !== "").slice(-3).join(" ")}`;
}

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: { io?: AppRoleIo; makePrisma?: (url: string) => PrismaClient } = {},
): Promise<number> {
  const io = deps.io ?? processIo;
  const args = argv.filter((a) => a !== "--");
  if (args.length > 0) {
    io.err(`db:app-role takes no arguments (got ${args.length})\n`);
    return 1;
  }
  const owner = ownerDatabaseUrl(env);
  if (!owner.ok) {
    io.err(`${owner.error}\n`);
    return 1;
  }
  const ownerRaw = owner.url;

  let password = env.APP_ROLE_PASSWORD ?? "";
  if (password === "") {
    if (!io.isTTY) {
      io.err("set APP_ROLE_PASSWORD, or run db:app-role in a terminal to be asked for it\n");
      return 1;
    }
    password = await io.prompt(`Password for ${APP_ROLE}: `);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    io.err(`the ${APP_ROLE} password must be at least ${MIN_PASSWORD_LENGTH} characters\n`);
    return 1;
  }

  let ownerPassword = "";
  let url: string;
  try {
    url = resolveDatabaseUrl(ownerRaw);
    ownerPassword = decodeURIComponent(new URL(url).password);
  } catch (err) {
    io.err(`OWNER_DATABASE_URL rejected: ${redacted(err, [ownerRaw, password])}\n`);
    return 1;
  }

  const owned = deps.makePrisma === undefined;
  let prisma: PrismaClient | undefined;
  try {
    prisma = deps.makePrisma ? deps.makePrisma(url) : new PrismaClient({ datasourceUrl: url });
    const report = await setAppRoleLogin(prisma, password);
    io.out(describeReport(report));
    const problems = appRoleProblems(report);
    if (problems.length > 0) {
      io.err(`${APP_ROLE} is not clean: ${problems.join("; ")}\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    io.err(`db:app-role failed: ${redacted(err, [password, ownerPassword, ownerRaw, url])}\n`);
    return 1;
  } finally {
    if (owned) await prisma?.$disconnect();
  }
}

// Run when invoked directly (`node dist/db/app-role-cli.js`, or via scripts/db-app-role.ts).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
