import type { FastifyInstance } from "fastify";
import type { WorldActor } from "./app.js";
import type { CaseResponse, Req } from "./cases.js";
import type { LeakScanner } from "./compare.js";

/**
 * Minor 380 — the one way the cross-user suite sends a request, shared by the world building (`world.ts`) and the
 * runner, so both get the same two checks:
 * - a `429` fails by name. The suite runs under `GENEROUS_LIMITS`; a limit reached during setup used to read as a
 *   confusing "expected 201";
 * - every response A or C receives goes to the leak scan (AC12 says "anywhere in the suite"). B's own responses hold
 *   B's data by design and are not recorded.
 */
export type CrossUserRequest = (actor: WorldActor, req: Req, where?: string) => Promise<CaseResponse>;

export function crossUserRequester(app: FastifyInstance, as: (actor: WorldActor) => Record<string, string>, scanner?: LeakScanner): CrossUserRequest {
  return async (actor, req, where = `${req.method} ${req.url}`) => {
    const res = await app.inject({
      method: req.method as "GET",
      url: req.url,
      headers: { ...as(actor), ...(req.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(req.body === undefined ? {} : { payload: JSON.stringify(req.body) }),
    });
    if (res.statusCode === 429) throw new Error(`rate limited during the cross-user suite: raise GENEROUS_LIMITS (${actor} ${where})`);
    if (actor !== "B") scanner?.record(res.body, `${actor} ${where}`);
    return { status: res.statusCode, headers: res.headers, body: res.body };
  };
}

/** Sends the request and fails unless the status matches; returns the parsed body (`{}` for an empty one). */
export async function mustAnswer<T = { id: string; [key: string]: unknown }>(request: CrossUserRequest, actor: WorldActor, req: Req, status: number, who?: string): Promise<T> {
  const res = await request(actor, req, who === undefined ? undefined : `${who}: ${req.method} ${req.url}`);
  if (res.status !== status) throw new Error(`${who === undefined ? "" : `${who}: `}${actor} ${req.method} ${req.url} answered ${res.status}, expected ${status}: ${res.body}`);
  return (res.body === "" ? {} : JSON.parse(res.body)) as T;
}
