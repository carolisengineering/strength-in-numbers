# @sin/loadtest

Spec 16's load-test tool: k6 lifters at real gym pace against `local`, `staging` or `prod`, reporting how many lifters mid-workout the target handles before set saves get slow, errors appear or requests are rate limited.

Needs k6 2.x (2.3.0 tested) on the machine that runs it (`brew install k6`); CI never does. Usage and safety rules: `docs/specs/16-load-testing.md` and the runbook `docs/runbooks/load-testing.md`.
