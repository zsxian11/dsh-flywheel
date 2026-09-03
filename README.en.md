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
| `tool-flywheel` | `@dsh-flywheel/dsh-bundle/tools` | `project_search` / `session_search` / `session_read` |
| (browser) | `@dsh-flywheel/dsh-bundle/client` | Settings page "Session flywheel" card (zh/en dictionaries) |

The service surface stays small: `ctx.flywheel.retrieve / ingest / queueClaimExtract / config()`.

## Install (local dev instance, offline)

`@dsh-flywheel/*` is not published yet, and the three packages reference each other through `link:` relative dependencies, so **offline installs must use directory links** (tarball-to-tarball transitive deps cannot resolve offline without a registry — verified). To install into a running dsh (profile `web` in this example):

```sh
cd /Users/zhaoshuxian/Desktop/myproject/dsh-flywheel

# 1) Build lib/ (the loader imports lib/*.js directly; a link install does not compile)
pnpm --filter @dsh-flywheel/core build
pnpm --filter @dsh-flywheel/lexical-sqlite build
pnpm --filter @dsh-flywheel/dsh-bundle build

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
- This package's settings card (`./client`, the Web client half) requires a separate client-bundle build; v1 does not ship it yet — the host half (inject / index / tools / window) works first, the card comes later.
- Once published to npm you can install with one command, `dsh plugin --profile web add dsh-flywheel-dsh-bundle`; revert the three packages' `link:` deps to version ranges at that point.

After install:

- **Settings → Plugin configuration** shows a card titled "Session flywheel" (not Flywheel / the package name).
- The first-step real user message injects ≤ `ftsK` node cards + 1 hop ≤ `hopExtra`; an unchanged digest does not re-inject.
- Tool loops / subagents never re-retrieve; written pptx/pdf/xlsx/… get a `PRODUCED` edge.
- A user correction (`不对|不是|改成|作废…`, any case, Chinese/English) marks the last 3 active claim/change nodes `superseded`.
- After a rule hit, `summarizationModel` (default `deepseek-v4-flash`) rewrites the purpose sentence in the background to a ≤80-char purpose + bound path; an 8s timeout or any failure keeps the rule excerpt, and this never awaits in pre-step (§7.3 claim flash).

## Configuration (schema = settings page = CLI JSON, no hardcoded K)

Field names and defaults live in `packages/core/src/config.ts` (`DEFAULT_CONFIG`); the DSH-side schemastery mirror is `packages/dsh-bundle/src/config.ts`. Key constraints:

- `ftsK` / `hopExtra` / `vectorK` positive integers; `hop` must be `1` (v1 does not open multi-hop).
- `maxChars` 500–8000.
- `lexicalBackend` must be mounted; v1 mounts only `sqlite-fts`. Selecting `elasticsearch` without its provider rejects the save (fail loud); sqlite retrieval is unaffected.
- `vectorBackend: off` (default) means zero embeddings on the hot path; v1 does not implement ES / cloud vector — interfaces and card fields are reserved (P6/P7).
- Secrets use `role('secret')` and never appear in settings read responses.

## Retrieval protocol (the only hot-path algorithm, §4.3)

Inverted `search(query, { k: ftsK })` (active, current project) → optional vector RRF (off by default) → exactly 1 hop (edges PRODUCED/DESCRIBES/CITES/SUPERSEDES/CONTINUES/PART_OF) → expand ≤ `hopExtra` → drop still-active SUPERSEDES dsts → other-session nodes keep only title+summary (≤200 chars) → render ≤ `maxChars` → `digest = sha256(sorted ids + query + lexicalBackend)`, unchanged when equal. Zero LLM end to end.

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
5. Coding-search + 12k spill at start; compact only when idle — P0 user config, outside this repo.
6. Finance / HR work with zero extra extractors — `generic` is built in.
7. The settings page shows the "Session flywheel" card; changing "injection char cap" applies next turn — `dsh-bundle` client + store.
8. Saving an unmounted ES / cloud vector fails; sqlite retrieval stays intact — store `validate`.
