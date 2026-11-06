# Runbook — Observability (metrics & traces)

Spec: [13.0 — Observability: Metrics & Traces](../specs/13.0-observability-metrics-traces.md).

The API is instrumented with OpenTelemetry. Telemetry is **off unless configured**: with no
`OTEL_*_EXPORTER` variable set, nothing is constructed, nothing listens on `:9464`, and nothing
is sent.

| Where | Metrics | Traces |
|---|---|---|
| Local | Prometheus **pulls** `:9464/metrics` | pushed (OTLP/HTTP) to local Tempo |
| Staging | pushed (OTLP) to Grafana Cloud | pushed (OTLP) to Grafana Cloud |
| Tests / CI | off | off |

Dashboards and alert rules live in `ops/grafana/` and are shared by both backends.

---

## 1. Local stack

### Start it

```bash
docker compose up -d db                                   # the app's Postgres (5433)
docker compose -f docker-compose.observability.yml up -d  # Prometheus :9090, Tempo :4318/:3200, Grafana :3001
docker compose -f docker-compose.observability.yml logs tempo | tail -20   # no config errors
```

In `apps/api/.env`, uncomment the telemetry block from `.env.example`:

```bash
OTEL_METRICS_EXPORTER=prometheus
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=1
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local
```

`/metrics` listens on `127.0.0.1:9464` only, so nothing else on your network can read it (#120).
`OTEL_EXPORTER_PROMETHEUS_HOST` and `OTEL_EXPORTER_PROMETHEUS_PORT` change the address:
- **macOS / Windows (Docker Desktop):** nothing to change. The compose Prometheus reaches the
  host's loopback through `host.docker.internal` (checked 2026-11-01).
- **Linux:** `host.docker.internal` is the Docker bridge address (`host-gateway`), which a
  loopback listener doesn't answer. Set `OTEL_EXPORTER_PROMETHEUS_HOST` to the bridge address
  (usually `172.17.0.1`), not `0.0.0.0`, which would expose it to your network again.
- **API in compose** (the `api:9464` target): the `api` service in `docker-compose.yml` sets no
  telemetry variables. Add `OTEL_METRICS_EXPORTER: prometheus` and
  `OTEL_EXPORTER_PROMETHEUS_HOST: 0.0.0.0` to its `environment`. `0.0.0.0` there means inside
  the container only; compose doesn't publish `9464`.

Then run the API and the local IdP (two terminals):

```bash
pnpm --filter @sin/api run dev:idp
pnpm --filter @sin/api run dev
```

If the local DB is new, run `DATABASE_URL='postgresql://sin:sin@localhost:5433/sin?sslmode=disable' pnpm run db:migrate:deploy`
and `pnpm --filter @sin/api run seed:catalog` once first.

### Generate traffic

```bash
TOKEN=$(curl -s localhost:9999/token | jq -r .access_token)
H=(-H "authorization: Bearer $TOKEN" -H "content-type: application/json")
EX=$(curl -s "${H[@]}" localhost:8080/v1/exercises | jq -r '[.exercises[] | select(.modality == "weight_reps")][0].id')
for i in $(seq 1 20); do
  W=$(curl -s "${H[@]}" -X POST localhost:8080/v1/workouts \
        -d "{\"clientGeneratedId\":\"$(uuidgen | tr A-Z a-z)\",\"startedAt\":\"$(date -u +%FT%TZ)\"}" | jq -r .id)
  WE=$(curl -s "${H[@]}" -X POST localhost:8080/v1/workouts/$W/exercises -d "{\"exerciseId\":\"$EX\"}" | jq -r .id)
  curl -s -o /dev/null "${H[@]}" -X POST localhost:8080/v1/workout-exercises/$WE/sets \
       -d '{"reps":5,"weight":80,"weightUnit":"kg","isComplete":true}'
  sleep 1   # a finish in the same second as its start can be refused
  curl -s -o /dev/null "${H[@]}" -X PATCH localhost:8080/v1/workouts/$W -d "{\"endedAt\":\"$(date -u +%FT%TZ)\"}"
  curl -s -o /dev/null "${H[@]}" "localhost:8080/v1/workouts?limit=5"
done
```

Twenty rounds clear the alert rules' 20-request floor. Past about 20 rounds the API's own
write rate limits answer `429`, which is expected.

### Check it

1. **Prometheus targets** (`http://localhost:9090/targets`): `si-api` at
   `host.docker.internal:9464` is **UP**. `api:9464` is DOWN unless the API also runs in
   compose. That is expected. If `host.docker.internal:9464` is DOWN, look in the API log for
   `Prometheus /metrics could not listen on 127.0.0.1:9464 (listen EADDRINUSE …)`: another
   process has the port, so no metrics are served. Stop it, or set
   `OTEL_EXPORTER_PROMETHEUS_PORT` and change the target in `ops/prometheus/prometheus.yml`.
2. **Grafana** (`http://localhost:3001`, no login) → Dashboards → *strength-in-numbers* →
   **si-api — overview** and **si-api — usage**: every panel shows data. The *Restarts*
   annotation appears only after the API restarts.
3. **Explore → Tempo → Search**: a trace named `POST /v1/workouts` with `prisma:*` spans under
   it. From a span, the *Request rate for this route* link opens the matching Prometheus query.
4. **Alerting → Alert rules**: three rules in **Normal**.

To find a request's log lines from a trace, copy the trace id and search the API's terminal
output for `"trace_id":"<id>"`. Logs are not in Loki (BL-22), so there is no trace → logs link.

### See a rule fire

1. In `ops/grafana/alerts/api.yaml`, lower `api-slow`'s threshold from `params: [1]` to
   `params: [0.001]`.
2. `docker compose -f docker-compose.observability.yml restart grafana`
3. Run the traffic loop above, then watch Alerting → Alert rules. The rule goes Pending, then
   Firing after its 5-minute `for`. Nothing is sent: there is no local contact point.
4. Revert the threshold and restart Grafana again.

### Reset

```bash
docker compose -f docker-compose.observability.yml down -v   # drops Prometheus + Tempo data
```

If another local project already uses port 9090, 3001, 3200 or 4318, stop it first. The ports
are fixed in `docker-compose.observability.yml`.

---

## 2. Grafana Cloud setup (once)

1. Create a free Grafana Cloud account and a stack (grafana.com → *My Account* → *Add stack*), in
   a US region. `render.yaml`'s `OTEL_EXPORTER_OTLP_ENDPOINT` records the current stack's zone.
2. On the grafana.com portal's **Manage Stack** page, the **OpenTelemetry** card → **Configure**.
   Note (skip its offer to generate a token, whose scopes may be broader than step 3's):
   - the **OTLP endpoint**, `https://otlp-gateway-<zone>.grafana.net/otlp`
   - the **instance ID** (a number)

   Inside the Grafana app (*Launch*), the same page is **Connections → Add new connection →
   OpenTelemetry (OTLP)**.
3. Portal sidebar → **Security → Access Policies → Create access policy** (inside the Grafana
   app: **Administration → Users and access → Cloud access policies**):
   - name `si-api-staging-write`, realm = this stack
   - scopes: **`metrics:write` and `traces:write` only** (no read, no logs). A leaked token
     can then write junk but read nothing.
   - **Add token** → copy it once.
4. Build the header value:

   ```bash
   printf '%s' '<instanceId>:<token>' | base64 | tr -d '\n'
   ```

   Run it in your own terminal, never through an assistant's shell. The `tr` matters on Linux:
   GNU `base64` wraps long output, and a newline inside the header makes every export fail.

   In the Render dashboard → **si-api** → **Environment**, set
   `OTEL_EXPORTER_OTLP_HEADERS` = `Authorization=Basic%20<base64 output>`. Keep the `%20`: the
   value is URL-decoded, and a literal space would also work, but the encoded form survives
   copy-paste. The header is a secret: it lives only in the Render dashboard (`sync: false`
   in `render.yaml`).
5. `OTEL_EXPORTER_OTLP_ENDPOINT` in `render.yaml` must be the endpoint from step 2. For a new
   stack in another zone, change it there (PR).

## 3. Turn it on

`render.yaml` already sets `OTEL_METRICS_EXPORTER=otlp` and `OTEL_TRACES_EXPORTER=otlp` on
**si-api** (since 2026-11-05, #124), so every deploy exports. The only step left for a new stack
is the header secret (§2 step 4), plus the endpoint if the zone changed (§2 step 5).

Set `OTEL_EXPORTER_OTLP_HEADERS` **before** the exporters reach the service. Without it the API
still starts, but every export is refused (401) until the header is set.

After the restart, the API log has no `ConfigError`. Any later export failure shows as one
`warn` line per signal per 5 minutes: `telemetry export problem: …` with `signal`. Other SDK
warnings have their own line, at most one per 5 minutes: `telemetry SDK warning: …` with
`signal: "sdk"` (#126). They never hide an export failure.

## 4. Import dashboards and alerts

**Dashboards:** Dashboards → New → **Import** → upload `ops/grafana/dashboards/api-overview.json`,
pick the stack's Prometheus data source (usually `grafanacloud-<stack>-prom`) for the
`datasource` variable → Import. Repeat for `usage.json`.

**Alert rules:** Alerting → Alert rules → **New alert rule**, one per rule in
`ops/grafana/alerts/api.yaml`. Copy each query `expr`, threshold, `for: 5m`, and set
**No data → OK**, **Error → Error**. Under the query's **Options**, check that **Type** is
**Instant** (the file's `instant: true`). The threshold then applies straight to query A, with
no Reduce step. Or use *More → Import* if the stack offers it, replacing
`datasourceUid: prometheus` with the stack's Prometheus data-source UID first. Put them in a
folder `strength-in-numbers`, evaluation group `si-api`, interval 1m.

**Contact point:** Alerting → Contact points → **Add contact point** → type Email → the owner's
address → **Test** → confirm the email arrives. Alerting → Notification policies → set it as
the default policy's contact point.

## 5. AC15 checklist (after the next merge to `main`)

The CI `post-deploy smoke` job hits staging after each merge. Within about 2 minutes:

- [ ] Explore → Prometheus: `http_server_request_duration_seconds_count` has series with
      `http_route` labels.
- [ ] Explore → Tempo: a trace from the smoke run (for example `GET /v1/me`).
- [ ] **Every panel** of both imported dashboards has data. If a panel is empty in Cloud but
      not locally, Cloud translated a metric name differently (Spec 13.0 §6.11). Switch to
      option 2 (a `metric_suffix` dashboard variable) and record it in Spec 13.0 D13.
- [ ] The three alert rules are imported and Normal.
- [ ] The contact-point test email arrived.

Record the result in the PR or in Spec 13.0 D13.

Render free sleeps after about 15 minutes idle. While asleep the API pushes nothing, so gaps
in the graphs mean idle, not down. Every rule treats no data as OK, and there is no "API is
down" alert on staging (Spec 13.0 D7).

## 5a. Spec 13.3: CPU and DB-pool panels (after the 13.3 merge)

1. Dashboards → `si-api — overview` → **⋮ → Import** again with the new
   `ops/grafana/dashboards/api-overview.json` (keep the same UID, overwrite). Pick the same
   Prometheus data source.
2. Set the **CPU limit (cores)** variable to `0.1` (Render free) and save the dashboard. For the
   production Cloud Run it is `1`.
3. After the next post-deploy smoke, check (Spec 13.3 AC16):
   - [ ] **CPU cores in use** has data and reads plausibly against the 0.1 line.
   - [ ] **DB connections in use vs limit** shows a flat limit of 8 and an in-use line.
   - [ ] **DB queries waiting** and **Mean pool wait per query** have data (often 0 at rest).
   - [ ] **CPU throttled:** record whether it has data on Render (present / absent) in the PR
         and in Spec 13.3 §12 D4. "No data" is a valid answer: the host doesn't report it.
   - [ ] The names match local (no `_seconds_seconds` or missing `_total`); if a panel is empty
         in Cloud but not locally, it's the Spec 13.0 §6.11 name translation (option 2).

Spec 16's first staging load run waits for this checklist.

## 6. Rollback

- **Stop sending:** set `OTEL_METRICS_EXPORTER=none` and `OTEL_TRACES_EXPORTER=none` in the
  Render dashboard. The service restarts; no deploy is needed. This is **temporary**:
  `render.yaml` says `otlp`, so the next merge to `main` turns export back on. Merge a
  `render.yaml` PR with both set to `none` before any other merge.
- **A leaked token:** delete it in Grafana Cloud (Security → Access Policies →
  `si-api-staging-write`). That cuts it off at once, whatever Render says; exports then fail
  with 401 until a new header is set.
- **Remove exported data:** delete the Grafana Cloud stack.
- **Code rollback:** revert the PR. Nothing persistent to undo (no migration).

## 7. Free-tier limits

Grafana Cloud free: 10k active metric series, 50 GB of traces, 14-day retention. Check
**Usage** monthly. At current cardinality the API emits a few hundred series. A sudden jump
means an attribute with unbounded values reached a metric, which the View allowlist
(`apps/api/src/telemetry/views.ts`) should make impossible.
