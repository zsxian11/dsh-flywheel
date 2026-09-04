# dsh-flywheel

[中文](README.md) | English

The "session flywheel" plugin for **DeepSeek Harness (DSH)** — an out-of-repo standalone repository (v1) that shares one index and retrieval protocol with the Cursor side.

Goal in one line: under **per-session isolation**, bring a long one-shot session closer to Cursor's "current sentence carries only the working set"; pass short cards between sessions via a project-level artifact graph + inverted index, instead of gluing transcripts together.

## Repository layout

```
packages/core/                # protocol + retrieval orchestration (no sqlite binding, no DSH runtime dependency)
packages/lexical-sqlite/      # v1 LexicalIndex + GraphStore: SQLite FTS5 + edges (node:sqlite, WAL)
packages/dsh-bundle/          # DSH bundle: Host plugins + Web settings card (./client)
```

The full plan lives in `_docs/flywheel-plugin-plan.md` (not restated here).

## Plugin roles (design §6.1)

| Cordis name | Entry | Responsibility |
|---|---|---|
| `flywheel-store` | `@dsh-flywheel/dsh-bundle/store` | Registers the `flywheel` settings namespace, provides `ctx.flywheel`, assembles providers from settings |
| `flywheel-lexical-sqlite` | `@dsh-flywheel/dsh-bundle/lexical-sqlite` | Mounts `sqlite-fts` (required in v1) |
| `flywheel-inject` | `@dsh-flywheel/dsh-bundle/inject` | `agent/pre-step` working-set injection (step 1 + real user message, digest dedupe) |
| `flywheel-index` | `@dsh-flywheel/dsh-bundle/index` | File events + purpose-sentence ingest + correction supersede |
| `flywheel-window` | `@dsh-flywheel/dsh-bundle/window` | Idle stage-switch `compactNow` |
| `flywheel-trim` | `@dsh-flywheel/dsh-bundle/trim` | `tools/post-execute` bounds oversized tool results (including `read`, default 8000 chars) |
| `tool-flywheel` | `@dsh-flywheel/dsh-bundle/tools` | `project_search` / `session_search` / `session_read` |
| `flywheel-web` | `@dsh-flywheel/dsh-bundle` | Empty Host apply so the Web scanner sees `dsh.client` on the package root |
| (browser) | `@dsh-flywheel/dsh-bundle/client` | Settings left-nav "Session flywheel" section (zh/en dictionaries) |

The service surface stays small: `ctx.flywheel.retrieve / ingest / queueClaimExtract / config()`.

## Install (local dev instance, offline)

`@dsh-flywheel/*` is not published yet, and the three packages reference each other through `link:` relative dependencies, so **offline installs must use directory links** (tarball-to-tarball transitive deps cannot resolve offline without a registry — verified). To install into a running dsh (profile `web` in this example):

```sh
cd /Users/zhaoshuxian/Desktop/myproject/dsh-flywheel

# 1) Build only after the running dsh task finishes (do not rewrite lib/ while it is live)
pnpm --filter @dsh-flywheel/core build
pnpm --filter @dsh-flywheel/lexical-sqlite build
pnpm --filter @dsh-flywheel/dsh-bundle build    # host: lib/*.js (includes the empty root apply)
pnpm --filter @dsh-flywheel/dsh-bundle bundle   # browser: lib/client.js

# 2) Add all three as links to the profile (core / lexical-sqlite become plain
#    dependencies; dsh-bundle joins profile layers because it declares dsh.bundle)
npx @deepseek-ai/dsh plugin --profile web add \
  link:./packages/core link:./packages/lexical-sqlite link:./packages/dsh-bundle

# 3) Verify the layer mounted (optional: --dump-config to see the flywheel layer)
npx @deepseek-ai/dsh --profile web --dump-config

# 4) Restart the instance so the new bundle layer takes effect
npx @deepseek-ai/dsh web --no-open
```

Notes:

- At runtime `@deepseek-ai/*` resolves from the dsh installation's shared module fallback (no registry needed).
- Uninstall: `npx @deepseek-ai/dsh plugin --profile web remove @dsh-flywheel/dsh-bundle` (then remove the other two packages).
- The settings card needs `lib/client.js` (`pnpm --filter @dsh-flywheel/dsh-bundle bundle`) and the package-root `flywheel-web` patch row. Run `pnpm install` once in this repo before the first bundle so `tsdown` / `lightningcss` are present.
- Once published to npm you can install with one command, `dsh plugin --profile web add dsh-flywheel-dsh-bundle`; revert the three packages' `link:` deps to version ranges at that point.

After install:

- **Settings** left navigation shows a standalone "Session flywheel" section (not a Plugin configuration card, and not Flywheel / the package name).
- The first-step real user message injects ≤ `ftsK` node cards + 1 hop ≤ `hopExtra`; an unchanged digest does not re-inject.
- Tool results (including `read`) over `maxToolResultChars` (default 8000) become a head/tail preview, so later steps do not replay whole files. Trim runs inner of spill; if official spill still writes a file, the spill path is stripped from `read` results.
- Tool loops / subagents never re-retrieve; written pptx/pdf/xlsx/… get a `PRODUCED` edge.
- A user correction (`不对|不是|改成|作废…`, any case, Chinese/English) marks the last 3 active claim/change nodes `superseded`.
- After a rule hit, `summarizationModel` (default `deepseek-v4-flash`) rewrites the purpose sentence in the background to a ≤80-char purpose + bound path; an 8s timeout or any failure keeps the rule excerpt, and this never awaits in pre-step (§7.3 claim flash).

## Configuration (schema = settings page = CLI JSON, no hardcoded K)

Field names and defaults live in `packages/core/src/config.ts` (`DEFAULT_CONFIG`); the DSH-side schemastery mirror is `packages/dsh-bundle/src/config.ts`. Key constraints:

- `ftsK` / `hopExtra` / `vectorK` positive integers; `hop` must be `1` (v1 does not open multi-hop).
- `maxChars` 500–8000.
- `maxToolResultChars` 1000–32000; `trimToolResults` is on by default. This only bounds **in-turn** tool results written into history; it does not skip a model API call.
- `lexicalBackend` must be mounted; v1 mounts only `sqlite-fts`. Selecting `elasticsearch` without its provider rejects the save (fail loud); sqlite retrieval is unaffected.
- `vectorBackend: off` (default) means zero embeddings on the hot path; v1 does not implement ES / cloud vector — interfaces and card fields are reserved (P6/P7).
- Secrets use `role('secret')` and never appear in settings read responses.

## Why an in-turn loop is still expensive

Every tool-loop step is still one Messages call. The flywheel cannot fold 142 calls into one. The bill has two parts:

1. **Call count**: the model stops after each `read`. The persona now asks it to fire `grep` / `glob` / `read` in parallel and not recap after every file.
2. **Prompt size**: `flywheel-trim` bounds each tool result (including `read`) to `maxToolResultChars` *inside* spill, so official DSH does not spill a huge `read` to a file the model then re-reads. Compaction still waits until about 80% of the window for pressure; a topic switch tries `compactIfNeeded('forced')` on step 1, then `'context-overflow'` on the official engine (same threshold bypass). `compactNow` stays idle-only. This stays append-only for prefix cache.
3. **Reasoning passback**: DeepSeek replays each step's `reasoning_content` verbatim on later requests. A High first-thought dump is billed as output once, then as input on every later step. The flywheel cannot truncate it (official passback). The real lever is `off` / `low` reasoning; the persona only asks for the user's language and a short plan before tools.

Levers outside this repo (P0 user config): a thin preset (`coding-search` with `/plan` and gated web), spill `maxInlineBytes: 12000`, compaction `thresholdRatio: 0.5` + `retainTokens: 16384`, and not using High reasoning to wander the tree. Switching the Host search backend to Exa/Perplexity remains a later Host change.

## Retrieval protocol (the only hot-path algorithm, §4.3)

Inverted `search(query, { k: ftsK })` (active, current project) → optional vector RRF (off by default) → exactly 1 hop (edges PRODUCED/DESCRIBES/CITES/SUPERSEDES/CONTINUES/PART_OF) → expand ≤ `hopExtra` → drop still-active SUPERSEDES dsts → other-session nodes keep only title+summary (≤200 chars) → render ≤ `maxChars` → `digest = sha256(sorted ids + query + lexicalBackend)`, unchanged when equal. Zero LLM end to end.

## Same-session end-to-end

Open a new session on "编码检索". Fix simple bugs directly. For hard work, `/plan` first and write `docs/changes/<slug>.md` before approval; when the user says to start implementing, step 1 of that turn tries to compact older history and injects the plan card. `web_search` is in the catalog from the first turn, but repo facts use grep first — search only for current external docs. Switch topics with "另外…".

## Develop

```sh
pnpm install
pnpm -r test        # core (fake index swaps sqlite and still passes) + lexical-sqlite (real in-memory FTS5) + claim-flash parsing
pnpm -r typecheck
pnpm -r build
```

## Not implemented in v1 (interfaces reserved; P6/P7 deferred)

- Elasticsearch `LexicalIndex` provider (`packages/lexical-elasticsearch/`)
- Cloud vector `VectorIndex` provider + query-time embedding (`packages/vector-cloud/`)
- Cursor hooks / CLI (`packages/cli/`, `packages/cursor-hooks/`)
- Domain extractors `java-symbols` / `office-names` / `media-caption` (`packages/extractors/`)

## Acceptance vs. the plan (§14 Definition of Done)

1. One `.dsh/flywheel/index.sqlite` readable by CLI / DSH / Cursor hooks — core is sqlite-free; `lexical-sqlite` is the only reader/writer.
2. After a topic switch the working-set cards change and no superseded card reappears — `core/retrieve.ts` + `flywheel-window`.
3. "Generate a Q3 budget PPT" is FTS-findable from a new session after the file/purpose lands — `flywheel-index`.
4. Other sessions' raw text never auto-injects; `session_search` finds their titles — `retrieve` foreign-session truncation + `tool-flywheel`.
5. Start with `coding-search` (bash + search + `/plan` + gated web) + 12k spill; topic-switch tries step-1 `forced` then `context-overflow`, and `compactNow` stays idle-only — preset at `~/.dsh/.agent-presets/coding-search/`.
6. Finance / HR work with zero extra extractors — `generic` is built in.
7. The settings left nav shows the "Session flywheel" section; changing "injection char cap" applies next turn — `dsh-bundle` client + store.
8. Saving an unmounted ES / cloud vector fails; sqlite retrieval stays intact — store `validate`.
