# Model strategy — which Claude to use for what (Blue Seal)

A cost-routing playbook for **Claude Code usage on this repo**. Goal: stop burning Fable-tier credits on everyday Blue Seal work (intake forms, admin views, Firebase services, rules, tests, QA) without losing Fable for the rare task that actually needs it.

> **There is no auto-router.** Claude Code never silently downgrades a task to a cheaper model based on "complexity" — that capability does not exist. Routing is always **deliberate**: the default in settings, a `/model` switch, or a model pinned into a subagent. So you can't *build* automatic complexity-routing; what you build (and what's set up here) is a sane default + a habit + a few pre-built cheap workers that make the right manual choice nearly free.

## The four tiers (verified pricing)

| Model | alias | $/1M in | $/1M out | Use it for |
|---|---|---:|---:|---|
| Fable 5 | `fable` | $10 | $50 | The rare hardest problem; long autonomous multi-step runs |
| **Opus 4.8** ← default | `opus` | $5 | $25 | Standard + hard feature work, architecture, deep debugging |
| Sonnet 4.6 | `sonnet` | $3 | $15 | Routine edits, writing tests, QA walkthroughs |
| Haiku 4.5 | `haiku` | $1 | $5 | Reading code, broad search, mechanical edits |

**Why Fable drains credits:** it's the most expensive model on three axes at once — $50/MTok output, a tokenizer that emits ~30% more tokens for the same content, and always-on thinking that can't be disabled (even a trivial ask pays for reasoning). Opus 4.8 is ~half the per-token price with none of the token inflation, so for everyday work the real gap is wider than the sticker prices.

**The default is already Opus 4.8** — set once at user level (`~/.claude/settings.json` → `"model": "opus"`), so **this repo already inherits it** (no per-project setting needed). It's the lowest-precedence layer, so any `/model` switch still overrides it for a stretch.

## Routing cheat-sheet (Blue Seal task types)

| Task | Model | How |
|---|---|---|
| "Where/how does X work", trace a flow, broad search | Haiku | built-in `Explore`, or invoke **`scout`** (Blue Seal-aware) |
| Write/extend unit tests (`*.test.ts`) or rules tests (`tests/rules/`) | Sonnet | invoke **`test-writer`** |
| Browser QA walkthrough of the app | Sonnet | invoke **`qa-runner`** (drives `docs/QA_PLAYWRIGHT.md`) |
| Feature work: intake forms, services, callables, rules, kanban/chat, admin views, architecture, debugging | Opus 4.8 | nothing — it's the default |
| Trivial mechanical edit (rename, copy tweak, help.ts FAQ) | Sonnet / Haiku | `/model sonnet` for a stretch, then `/model opus` |
| The rare hardest problem / long autonomous run | Fable 5 | `/model fable` → `/model opus` when the hard part's done |

The three cheap workers live in [`.claude/agents/`](../.claude/agents/) — `scout` (Haiku, read-only research), `test-writer` (Sonnet), `qa-runner` (Sonnet). Their pinned models keep them cheap even while the main loop is on Opus; the main loop hands work to them based on each file's `description`. (Omitting `model:` in an agent makes it inherit Opus — so cheap agents must pin explicitly.)

## The "reserve Fable" rule

Fable is worth $50/MTok in exactly two cases:
- **(a)** a single very hard problem nothing else cracks (a gnarly rules/permissions bug, a tricky payments-state machine), or
- **(b)** a long autonomous multi-step run you leave going — an overnight refactor or a big migration — where its long-horizon coherence pays off.

**Not** for everyday features, QA, tests, research, or chatting. The moment the hard part is done: `/model opus`.

## The levers

- **`/model <tier>`** — live switch (`opus` / `sonnet` / `haiku` / `fable`); persists to `.claude/settings.local.json` for this project.
- **User-level default** — `"model": "opus"` in `~/.claude/settings.json`. Applies across all projects, including this one; overridable per-project and by `/model`.
- **Custom subagents** — a model pinned in an agent's frontmatter keeps that work cheap regardless of the main loop's model.
- **`/effort low|medium|high|xhigh|max`** — dials reasoning depth (and token spend) independently of the model. Drop to `medium`/`low` for routine work; reserve `xhigh`/`max` for genuinely hard problems.
- **Fast mode** (`/fast`, Opus only) is a *latency* feature — faster output, **not** a credit-saver. Don't reach for it to save money.
