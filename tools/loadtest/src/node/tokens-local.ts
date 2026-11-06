import { accountEmail } from "./accounts.ts";

/**
 * Spec 16 — `local` tokens come from dev-idp (`GET /token`). `expiresInS` must cover the whole run (Review Focus 2);
 * dev-idp hands it to jose's `setExpirationTime`, which needs a unit, so it is sent as `<n>s`. Tokens stay in
 * memory: never logged, never written.
 */
export async function localTokens(
  ids: string[],
  opts: { idpUrl: string; expiresInS: number; fetchFn?: typeof fetch },
): Promise<string[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const tokens: string[] = [];
  for (const sub of ids) {
    const url = new URL("/token", opts.idpUrl);
    url.searchParams.set("sub", sub);
    url.searchParams.set("email", accountEmail(sub));
    url.searchParams.set("expires_in", `${Math.ceil(opts.expiresInS)}s`);
    const res = await fetchFn(url.toString());
    if (!res.ok) throw new Error(`dev-idp /token answered ${res.status} for ${sub}`);
    const body = (await res.json()) as { access_token?: unknown };
    if (typeof body.access_token !== "string") throw new Error(`dev-idp /token gave no access_token for ${sub}`);
    tokens.push(body.access_token);
  }
  return tokens;
}
