# Blue Seal — JMeter load test

A small, **safe-by-default** Apache JMeter plan ([`blueseal.jmx`](./blueseal.jmx))
that load-tests two surfaces:

| Thread group | Target | What it measures | Side effects |
| --- | --- | --- | --- |
| `01 Hosting baseline (GET /)` | `https://<hosting_host>/` | static hosting / CDN throughput + latency | none |
| `02 Callable auth+read path (no writes)` | `POST https://<fn_host>/clientMarkPaid` with a **non-existent** jobId | Cloud Function cold-start + auth + one Firestore read + the not-found error path | **none — it never writes data** (the job doesn't exist, so the callable throws `not-found` before any mutation) |

The callable sampler is deliberately a **read-only / fail-fast** probe so you can
measure real function throughput without polluting Firestore. With a valid token
it exercises auth + a read; without one it measures the unauthenticated fast
path (the assertion passes on any 2xx/4xx — only a 5xx/timeout is a failure).

## Prerequisites

- **JMeter 5.6+** — `brew install jmeter`, `choco install jmeter`, or
  [download](https://jmeter.apache.org/download_jmeter.cgi). `jmeter` must be on
  PATH (or call it by full path).
- **Node 18+** (for the token helper — uses global `fetch`).

## 1. (Optional) mint an auth token

The callable path is more representative with a real Firebase ID token. Mint one
for a test account (reuses the e2e creds in `e2e/.env.local`, or pass them):

```bash
# bash
TOKEN=$(node loadtest/get-id-token.mjs)
# or explicitly:
TOKEN=$(node loadtest/get-id-token.mjs clientqa@blueseal.app 'the-password')
```

```powershell
# PowerShell
$TOKEN = node loadtest/get-id-token.mjs
```

Tokens last ~1 hour. Skip this step to load-test the unauthenticated path.

## 2. Run (non-GUI — use this for actual load)

```bash
mkdir -p loadtest/out
jmeter -n -t loadtest/blueseal.jmx \
  -Jtoken="$TOKEN" -Jthreads=10 -Jramp=5 -Jloops=10 \
  -l loadtest/out/results.jtl -e -o loadtest/out/report
# open loadtest/out/report/index.html for the HTML dashboard (throughput, p90/p95/p99, error %)
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force loadtest/out | Out-Null
jmeter -n -t loadtest/blueseal.jmx -Jtoken="$TOKEN" -Jthreads=10 -Jramp=5 -Jloops=10 -l loadtest/out/results.jtl -e -o loadtest/out/report
```

Open the plan in the GUI to edit/iterate: `jmeter -t loadtest/blueseal.jmx`
(GUI mode is for authoring only — always run load in `-n` non-GUI mode).

## Configurable properties (`-J<name>=<value>`)

| Prop | Default | Meaning |
| --- | --- | --- |
| `threads` | `10` | concurrent virtual users per thread group |
| `ramp` | `5` | seconds to ramp all threads up |
| `loops` | `10` | iterations per thread (total requests/group = threads × loops) |
| `token` | _(empty)_ | Firebase ID token for the `Authorization: Bearer` header |
| `protocol` | `https` | `https` (deployed) or `http` (emulator) |
| `hosting_host` | `blueseal-762af.web.app` | hosting domain for group 01 |
| `fn_host` | `us-central1-blueseal-762af.cloudfunctions.net` | functions host for group 02 |

Example — heavier soak against the deployed test project:
`-Jthreads=50 -Jramp=30 -Jloops=40` (50 × 40 = 2 000 requests/group).

## Safety & cost

- This points at the **deployed test-mode project** by default. It has no real
  users and the callable sampler writes nothing, so light runs are safe — but
  **Cloud Functions invocations cost money and can autoscale**. Start small
  (the 10/5/10 default ≈ 100 requests/group) and scale deliberately.
- For heavy/sustained load, run against the **emulator** instead:
  `firebase emulators:start --only functions,firestore`, then override
  `-Jprotocol=http -Jhosting_host=127.0.0.1:5000`. Note the functions emulator
  uses a longer path (`/<project>/<region>/<fn>`); for the callable group, edit
  the sampler's domain→`127.0.0.1`, add port `5001`, and path→
  `/blueseal-762af/us-central1/clientMarkPaid`.
- Never point this at a production project with real users.

## What "good" looks like

Watch the HTML dashboard / Summary Report for:
- **Error % = 0** (any 5xx or timeout means the service buckled — the assertion
  flags it). Expected non-error responses: `200` (hosting), `401`/`404` (callable).
- **Throughput** (req/s) holding steady as threads rise.
- **p95 / p99 latency** — hosting should be tens of ms (CDN); the callable will
  show a fat tail on cold starts (first hits per instance), flattening as
  instances warm.

## Extending

To load-test other endpoints, copy the callable thread group and change the
sampler `path` + body. Keep load samplers **idempotent / non-mutating** (read
paths, validation failures, or against the emulator) so a run never leaves
junk data behind.
