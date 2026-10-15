# AGENTS.md

## Commands

- Dev run (no build): `node src/cli.ts <args>`
- Build: `npm run build` (outputs `dist/`, bin `dist/src/cli.js`)
- Typecheck / lint: `npm run typecheck` (tsc --noEmit) — **must pass** before finishing any change
- Tests: `npm test` (`node --test tests/*.test.ts`)
- Smoke after build: `node dist/src/cli.js --help`

## Conventions

- ESM + TypeScript strict. Import specifiers use `.ts` extensions (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions` on emit). No runtime dependencies — `node:` builtins only; devDeps are typescript + @types/node only.
- All persisted data is JSON under the project directory (see `docs/ARCHITECTURE.md`). All writes go through `Store.saveJSON` (atomic tmp+rename) so the scheduler daemon is resume-safe after crashes.
- Business logic lives in `src/core/*` and must be importable without the CLI. CLI files under `src/cli/` only parse args, print, and call core functions.
- Use `import type` for type-only imports (`verbatimModuleSyntax`).
- IDs are short, stable, prefixed by kind: `chr_`, `loc_`, `fac_`, `rule_`, `ev_`, `les_`, `find_`.

## Architecture (quick)

- `core/types.ts` — shared domain types.
- `core/store.ts` — project layout + atomic JSON persistence.
- `core/llm.ts` — provider interface; `mock` (offline deterministic), `anthropic`, `openai-compatible`.
- `core/prompts.ts` — prompt builders; every chapter prompt includes the relevant bible slice, style guide, lessons ("mistakes to avoid"), and the previous chapter's tail.
- `core/creator.ts` — idea → premise → world/characters → outline pipeline.
- `core/writer.ts` — chapter write pipeline with check-and-fix loop.
- `core/critic.ts` — deterministic continuity/style checks + LLM self-review.
- `core/lessons.ts` — self-learning journal derived from findings/user feedback.
- `core/scheduler.ts` — burst + daily pace production loop (daemon/tick/cron), resume-safe via `state.json`.
- `core/export.ts`, `core/zip.ts` — manuscript export (md/txt/json/EPUB) and publish adapters.
