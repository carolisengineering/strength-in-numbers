#!/usr/bin/env bash
# Runbook first-deploy.md "0018 — Timed sections" step 6 (Spec 09.5 Phase B) against staging.
# Needs a USER access token (an M2M token has no email claim and is refused):
#   TOKEN='<jwt>' bash docs/runbooks/scripts/check-0018-phase-b.sh
# Creates a scratch live workout (fails with 409 if one is already active), runs the checks, then deletes it.
set -u
BASE="${BASE:-https://si-api-ft2f.onrender.com}"
: "${TOKEN:?set TOKEN to a user access token}"
H=(-H "authorization: Bearer $TOKEN" -H "content-type: application/json")
pass=0; fail=0
call() { # method path [body] -> sets CODE and BODY
  local out; out=$(curl -sS -w '\n%{http_code}' -X "$1" "${H[@]}" ${3:+--data "$3"} "$BASE$2")
  CODE="${out##*$'\n'}"; BODY="${out%$'\n'*}"
}
check() { # label expected-code [python expr over j]
  local ok=1
  [ "$CODE" = "$2" ] || ok=0
  if [ $ok = 1 ] && [ -n "${3:-}" ]; then
    python3 -c "import json,sys; j=json.loads(sys.argv[1]); sys.exit(0 if ($3) else 1)" "$BODY" || ok=0
  fi
  if [ $ok = 1 ]; then pass=$((pass+1)); echo "ok   $1 ($CODE)"; else fail=$((fail+1)); echo "FAIL $1: got $CODE $BODY"; fi
}

call POST /v1/workouts "{\"clientGeneratedId\":\"$(uuidgen | tr A-Z a-z)\",\"startedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"title\":\"0018 phase B scratch\"}"
check "create scratch workout" 201 || true
W=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('id',''))" "$BODY" 2>/dev/null)
[ -n "$W" ] || { echo "no workout id; stopping"; exit 1; }
call POST "/v1/workouts/$W/sections" '{"name":"Finisher"}'
check "add section" 201
S=$(python3 -c "import json,sys; j=json.loads(sys.argv[1]); print(j.get('id') or j['section']['id'])" "$BODY")
echo "workout $W  section $S"

call PATCH "/v1/workout-sections/$S" '{"timer":{"format":"amrap","capSeconds":720}}'
check "1. PATCH amrap timer" 200 "'amrap' in json.dumps(j)"
call PUT "/v1/workout-sections/$S/round-times/1" '{"seconds":250}'
check "2. PUT round 1 = 250" 200
call PUT "/v1/workout-sections/$S/result" '{"rounds":5,"reps":7}'
check "2. PUT result 5+7" 200
call GET "/v1/workouts/$W"
check "2. GET shows round + result" 200 "'250' in json.dumps(j) and '\"rounds\": 5' in json.dumps(j)"
call PATCH "/v1/workout-sections/$S" '{"timer":{"format":"time_cap","capSeconds":900}}'
check "3. PATCH time_cap without discard" 409 "'section-result-exists' in j.get('type','')"
call PATCH "/v1/workout-sections/$S" '{"timer":{"format":"time_cap","capSeconds":900},"discardResult":true}'
check "3. PATCH time_cap with discardResult" 200
call GET "/v1/workouts/$W"
check "3. GET result null, roundTimes []" 200 "'\"result\": null' in json.dumps(j) and '\"roundTimes\": []' in json.dumps(j)"
call PUT "/v1/workout-sections/$S/round-times/1" '{"seconds":100}'
check "4. PUT round 1 = 100" 200
call DELETE "/v1/workout-sections/$S/round-times/1"
check "4. DELETE round 1" 204
call DELETE "/v1/workout-sections/$S/round-times/1"
check "4. DELETE round 1 again" 204

call DELETE "/v1/workouts/$W"
check "discard scratch workout" 204
echo "passed $pass, failed $fail"
echo "Then on Neon (step 5): SELECT count(*) FROM workout_section_round r JOIN workout_section s ON s.id = r.workout_section_id WHERE s.timer_format IS NULL;  -- expect 0"
