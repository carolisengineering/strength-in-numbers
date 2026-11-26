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
import { APP_ROLE, appRoleProblems, setAppRoleLogin, type AppRoleReport } from "./app-role.js";
import { isLocalHost, redacted, resolveOwnerUrl } from "./owner-url.js";

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Minor 414: the password `docker-compose.yml`, `.env.example`, `.env.owner.example` and `docs/manual-testing.md` give
 * the local `sin_app`. It is public, so it is refused on any database but this machine's.
 */
export const LOCAL_APP_ROLE_PASSWORD = "sin_app_local";

/** Minor 724: written (stderr) whenever the local password is accepted, since a tunnel's host reads as local. */
export const LOCAL_PASSWORD_NOTICE =
  "using the repo's local password: for the compose database only (through a tunnel to another database, use openssl rand -hex 24)\n";

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
  const owner = resolveOwnerUrl(env);
  if (!owner.ok) {
    io.err(owner.detail === undefined ? `${owner.error}\n` : `${owner.error}: ${owner.detail}\n`);
    return 1;
  }

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
  // Minor 414: from the environment or the prompt alike; names neither the password nor the host.
  if (password === LOCAL_APP_ROLE_PASSWORD && !isLocalHost(owner.hostname)) {
    io.err("that is the repo's local password; use a generated one on a remote database (runbook: openssl rand -hex 24)\n");
    return 1;
  }
  // Minor 724: a tunnel on localhost to another database looks local here, and the command can't tell; say what the
  // local password is for.
  if (password === LOCAL_APP_ROLE_PASSWORD) io.err(LOCAL_PASSWORD_NOTICE);

  const secrets = [password, ...owner.secrets];
  const url = owner.url;

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
    io.err(`db:app-role failed: ${redacted(err, secrets)}\n`);
    return 1;
  } finally {
    if (owned) await prisma?.$disconnect();
  }
}

// Run when invoked directly (`node dist/db/app-role-cli.js`, or via scripts/db-app-role.ts).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
