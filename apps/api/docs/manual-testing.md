# Manual testing — Foundation & Auth (Spec 01)

How to exercise the real `verify → provision → route` path with `curl`, before any
Auth0 tenant exists. A local IdP stand-in (`scripts/dev-idp.ts`) serves a JWKS and
mints RS256 tokens shaped like the ones the Auth0 post-login Action produces
(namespaced `email` / `email_verified` claims).

For the automated equivalents see `test/unit/` (fast, offline) and
`test/integration/` (`RUN_INTEGRATION=1`, needs Docker).

---

## Prerequisites

- Docker (for the Postgres container)
- Node 22, `pnpm` (via `corepack enable`)
- `jq` (used to pull tokens out of JSON)

## Ports on this machine

A native Postgres already owns `:5432` and Grafana owns `:3000`, so this doc uses:

| Service | Port |
|---|---|
| compose Postgres | `5433` → 5432 in the container |
| API | `8080` |
| dev-idp | `9999` |

`apps/api/.env.example` is already set to these. Adjust if your machine differs.

---

## 1. Start Postgres

```bash
docker compose up -d db
```

## 2. Apply migrations

```bash
DATABASE_URL='postgresql://sin:sin@localhost:5433/sin?sslmode=disable' \
  pnpm --filter @sin/api exec prisma migrate deploy
```

Expected: `0001_create_user` applies cleanly.

## 3. Start the local IdP

Leave this running in its own terminal. It prints a ready-to-use user token and an
M2M-style token on startup.

```bash
pnpm --filter @sin/api dev:idp
```

- `GET http://localhost:9999/.well-known/jwks.json` — the signing keys
- `GET http://localhost:9999/token?sub=&email=&email_verified=false&no_email=1&expires_in=1h`
  — mint a token with whatever claims you want

The keypair is persisted to `apps/api/.dev-idp-key.json` (gitignored) so a restart
does not invalidate tokens you already handed out.

## 4. Start the API

```bash
cp apps/api/.env.example apps/api/.env    # first time only
pnpm --filter @sin/api dev                # auto-loads apps/api/.env
```

Expected log line: `"api listening"` on port `8080`.

---

## 5. Walk through the endpoints

Grab two tokens (`%7C` is a URL-encoded `|`):

```bash
UT=$(curl -s 'localhost:9999/token?sub=devidp%7Ccarol&email=carol@example.com' | jq -r .access_token)
MT=$(curl -s 'localhost:9999/token?no_email=1&sub=devidp%7Cm2m'               | jq -r .access_token)
```

| # | Command | Expected |
|---|---|---|
| 1 | `curl -s localhost:8080/healthz` | `200` · `{"status":"ok"}` |
| 2 | `curl -s localhost:8080/readyz` | `200` · `{"status":"ready"}` (probe cached 3 s) |
| 3 | `curl -si localhost:8080/v1/me` | `401` · problem+json, `type` ends `/unauthenticated` |
| 4 | `curl -si -H "Authorization: Bearer not.a.jwt" localhost:8080/v1/me` | `401` · `type` ends `/invalid-token`, no internal detail |
| 5 | `curl -si -H "Authorization: Bearer $MT" localhost:8080/v1/_authcheck` | `200` · echoes `sub` / `aud` / `exp`, **no** user row created |
| 6 | `curl -si -H "Authorization: Bearer $MT" localhost:8080/v1/me` | `401` · `type` ends `/invalid-token` (M2M token has no email claim) |
| 7 | `curl -s -H "Authorization: Bearer $UT" localhost:8080/v1/me` | `200` · `isNewUser:true`, `id` is a UUIDv7 |
| 8 | repeat #7 | `200` · `isNewUser:false`, same `id` |

PATCH:

```bash
# valid → 200, updated representation, no isNewUser
curl -s -X PATCH -H "Authorization: Bearer $UT" -H 'content-type: application/json' \
  -d '{"displayName":"Carol","unitPreference":"lb","timezone":"America/Chicago"}' \
  localhost:8080/v1/me

# unknown field → 422 with errors[{path:"nickname"}]
curl -s -X PATCH -H "Authorization: Bearer $UT" -H 'content-type: application/json' \
  -d '{"nickname":"x"}' localhost:8080/v1/me

# invalid IANA zone → 422 with errors[{path:"timezone"}]
curl -s -X PATCH -H "Authorization: Bearer $UT" -H 'content-type: application/json' \
  -d '{"timezone":"Mars/Phobos"}' localhost:8080/v1/me
```

CORS preflight:

```bash
# listed origin → 204 + Access-Control-Allow-Origin + Access-Control-Expose-Headers
curl -si -X OPTIONS -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' localhost:8080/v1/me | grep -i 'access-control-'

# unlisted origin → no Access-Control-Allow-Origin header (browser blocks it)
curl -si -X OPTIONS -H 'Origin: https://evil.example.com' \
  -H 'Access-Control-Request-Method: GET' localhost:8080/v1/me | grep -i 'access-control-allow-origin'
```

Deleted-account path (`403`): soft-delete the row, then call `/v1/me` again.

```bash
docker compose exec -T db psql -U sin -d sin \
  -c "update \"user\" set deleted_at = now() where auth_sub = 'devidp|carol';"
curl -si -H "Authorization: Bearer $UT" localhost:8080/v1/me   # 403 · type ends /account-deleted
```

Inspect the row directly:

```bash
docker compose exec -T db psql -U sin -d sin -c 'select * from "user";'
```

---

## 6. Teardown

```bash
# Ctrl-C the API and the dev-idp terminals
docker compose down            # add -v to also drop the Postgres volume
rm -f apps/api/.dev-idp-key.json
```

---

## Notes

- **503 `auth-unavailable`** — killing the dev-idp mid-session usually still lets
  tokens verify, because `jose` caches the JWKS for ~10 min. The 503 path (IdP
  unreachable, cold cache) is covered directly in
  `test/unit/auth-verify.test.ts`.
- **`http://` issuer** — only allowed when `NODE_ENV` is not `production`. In prod
  the config loader rejects a non-`https` `AUTH0_ISSUER`.
- **Against a real Auth0 tenant later** — point `AUTH0_ISSUER` at
  `https://<tenant>.us.auth0.com/`, set `AUTH0_AUDIENCE` to the API identifier,
  and get tokens from the Auth0 dashboard or a client-credentials grant instead
  of the dev-idp. Nothing else changes.
