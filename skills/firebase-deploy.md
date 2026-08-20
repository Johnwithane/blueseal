# Firebase deploy

The deploy-before-commit discipline (see [CLAUDE.md](../CLAUDE.md#firebase-deployment-discipline)) — with the exact commands, the expected output, and the failure modes you'll actually hit.

---

## What deploys where

[firebase.json](../firebase.json) wires four targetable buckets. Each one maps to a file (or directory) the client code may depend on:

| Target | Source | When client depends on it |
| --- | --- | --- |
| `firestore:rules` | [firestore.rules](../firestore.rules) | Any service function that reads/writes a collection — if the rule isn't deployed, the client gets `permission-denied`. |
| `firestore:indexes` | [firestore.indexes.json](../firestore.indexes.json) | Any service function with a composite `where(...).where(...).orderBy(...)` query — if the index isn't built, the client gets `failed-precondition` with an index-create URL. |
| `storage` | [storage.rules](../storage.rules) | Any component that uploads/reads from Cloud Storage — same failure mode as Firestore rules. |
| `functions` | [functions/src/](../functions/src/) | Any component that calls `httpsCallable(...)` — if the callable isn't deployed, the client gets `functions/not-found`. |

Hosting (`firebase deploy --only hosting`) is the client itself — it ships *after* commit + push, not before. The rule is about the server-side contracts the committed client expects to be live.

---

## The sequence (every time)

```bash
# 1. Verify locally first — rules tests + lint + build + units
npm run lint && npm run build && npm run test:run

# 2. Targeted deploy of only what changed. Pick the minimum:
firebase deploy --only firestore:rules                          # rules only
firebase deploy --only firestore:rules,firestore:indexes        # rules + indexes
firebase deploy --only storage                                  # storage rules only
firebase deploy --only functions                                # all functions
firebase deploy --only functions:acceptVouch                    # one specific callable
firebase deploy --only firestore:rules,storage,functions        # multi-target feature

# 3. Confirm success in CLI output (see "What success looks like" below)
# 4. Commit the code change
# 5. Push (hosting deploys via CI or `npm run deploy:prod`)
```

**Never skip step 1.** The functions predeploy hook runs `npm --prefix functions run build` (see [firebase.json](../firebase.json) line 15) which is just `tsc`. If there's a TS error in `functions/`, deploy fails *after* you've already deployed rules — leaving prod with new rules pointing at functions that don't exist yet. Run the verify gates first so you fail before any deploy starts.

---

## What success looks like

After every deploy, the CLI ends with `✔ Deploy complete!` and a project console URL. Per-target success lines you should see:

- `✔ firestore: released rules firestore.rules to cloud.firestore` — rules are live, instant.
- `✔ firestore: deployed indexes in firestore.indexes.json successfully` — index *jobs queued*. Building can take 1–10 min for big collections. The client will keep returning `failed-precondition` until the index finishes building, even though deploy "succeeded".
- `✔ storage: released rules storage.rules to firebase.storage` — instant.
- `✔ functions[functionName(region)]: Successful update operation` — one line per function. Cold start on the next call (~5–10s).

If you see anything other than `✔` for a target — **stop, fix, redeploy, then commit**. A partial deploy is the worst state: some contracts live, some not.

---

## Common failure modes

**`functions: predeploy error`** — TS compile failed in `functions/`. The line above shows the exact error. Fix in `functions/src/**.ts`, re-run the deploy. No rules or hosting were touched yet.

**`HTTP Error: 400, Request contains an invalid argument`** on rules — usually a syntax error in `firestore.rules` (missing semicolon, unmatched brace, undefined helper). The CLI prints the line number. Fix and redeploy.

**`HTTP Error: 403, Permission iam.serviceAccounts.ActAs is required`** — your local Firebase CLI auth is stale or you're on the wrong account. Run `firebase login --reauth` and `firebase use` to confirm the active project.

**Index build pending for minutes after "successful" deploy** — expected for large collections. Check status at `console.firebase.google.com/project/<project>/firestore/indexes`. The client query will throw `failed-precondition` until the green ✔ appears next to the index. If the feature is read-blocking, hold the commit until the index is built.

**`functions/not-found` immediately after deploying a new callable** — client cached the old function list. Hard-refresh, or wait 30s for the v2 cold-start to warm. If it persists, check the function actually appears in `functions/src/index.ts` exports and re-deploy.

**A function disappeared from `functions/src/index.ts` exports** — the CLI prompts `The following functions are found in your project but do not exist in your local source code: <name>. Would you like to proceed with deletion?`. Read the prompt carefully — if the function is genuinely removed (and no client still calls it), answer yes. If you accidentally removed an import, answer no, fix the export, redeploy.

**`Quota exceeded for total allowable CPU per project per region`** (Cloud Run health-check failure on the last functions in a batch) — you deployed too many functions at once. Past ~200 functions, `--only functions` exhausts the `us-central1` Cloud Run CPU allocation and the tail of the batch fails, even though the earlier ones deployed fine. Deploy the affected functions targeted (`--only functions:<name>`) once the quota frees up, or request a CPU quota increase for the region. CI avoids the whole class by resolving a targeted list — see below.

**CI deployed nothing / deployed everything unexpectedly** — `.github/workflows/deploy.yml` resolves which functions a push actually changed and deploys only those. It widens to a full deploy on purpose for anything shared (`functions/src/lib/*`, `package.json`, `tsconfig.json`, `firebase.json`), for a source file with no matching `index.ts` export (an un-exported helper could affect anything), and when `index.ts` *drops or remaps* an export — only a full deploy prunes a function that no longer exists. Adding an export deploys just that function. Read the "Resolve changed functions" step log to see which branch it took.

**Rules deploy succeeded but emulator and prod behave differently** — `tests/rules/` was run against the emulator; the deployed rules can still be wrong if rules tests have gaps. Add the missing test case, fix the rule, redeploy.

---

## Rollback

Rules and functions both keep a deploy history. From the Firebase console:

- **Firestore rules:** `Firestore → Rules → History tab → Rollback` next to a previous version. Instant.
- **Storage rules:** `Storage → Rules → History tab → Rollback`. Instant.
- **Cloud Functions:** no console rollback. Re-deploy from a previous git commit: `git checkout <prev-sha> -- functions/src && firebase deploy --only functions:<name> && git checkout HEAD -- functions/src`. This is why each function should be small and independently deployable — easier to roll back one without disturbing the rest.
- **Indexes:** can't be "rolled back" — they're additive. To remove an index, delete its entry from `firestore.indexes.json` and redeploy; existing indexes will be torn down.

If a deploy goes bad on a Friday afternoon and the rollback isn't obvious, **roll back the rules first** (instant + reversible) to lock prod into a safe state, then debug the function deploy without time pressure.

---

## What NOT to do

- **`firebase deploy` with no `--only`.** Deploys *everything* — rules, indexes, functions, AND hosting. For a one-file rule tweak this means a full hosting push, which busts CDN caches and shows users a fresh client on next load. Always scope with `--only`.
- **`npm run deploy:prod` to push rules.** That script is hosting-only. It won't deploy your rules even if the diff looks fine. Different tool for different jobs.
- **Skipping rules tests because "the rule is trivial".** Trivial rules are exactly the ones that silently break — a missing `&&` or a swapped `request.resource` vs `resource` is a Friday-night incident. Run `npm run test:run` every time.
- **Deploying from a dirty working tree without intent.** If `git status` has uncommitted changes you weren't planning to ship, you're about to deploy them. Stash or commit first, then deploy what you meant to.
