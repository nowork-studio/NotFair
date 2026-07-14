# CLAUDE.md

Project conventions and notes for AI assistants working on NotFair.

## What NotFair is

A local, single-user, goal-driven agent runner. The user states a goal; NotFair
provisions an anonymous agent for it (agent = goal, 1:1), the agent defines a
platform-verifiable metric + target in chat, the user clicks START, and a
heartbeat loop ("checks") measures the metric and lets the agent act — with
observation windows, a spend envelope, and per-goal memory as the controls.
No approvals, no tasks, no orchestration layer: goals are the only unit.

## Verification

This repo carries no migrations or legacy/compat code. Verification is:

1. `pnpm typecheck` — must be clean.
2. `pnpm test` — vitest; must be clean. Tests live next to the code they
   cover (`src/lib/foo.ts` → `src/lib/foo.test.ts`). Default environment is
   node; component tests opt into a DOM with a leading
   `// @vitest-environment jsdom` pragma and use `@testing-library/react`.
   Mock at the server-action / db-module boundary (`vi.mock`), not deeper.
   Test pure logic and user-visible component behavior — don't unit-test
   Next.js pages or route handlers; the live smoke covers those.
   SQLite tests use the real better-sqlite3 against a tmpdir — and the
   `NOTFAIR_DATA_DIR` override MUST be set inside `vi.hoisted(...)`:
   static imports evaluate before module-level statements, so a plain
   assignment points the suite at the developer's live `~/.notfair`.
3. `pnpm build` — must be clean.
4. Live smoke: `pnpm dev` (port 3326), then walk the affected flow in the
   browser (goal index → goal page → chat / START / checks).

Prompt-affecting changes (`src/server/goals/identity.ts`, tick briefs in
`src/server/goals/tick.ts`, tool descriptions in
`src/server/mcp-server/tools.ts`) must be validated by running a real goal
loop end-to-end and reading the agent's actual behavior in the transcript.

## Project structure conventions

- **Database**: SQLite via `better-sqlite3` at `~/.notfair/db.sqlite`
  (overridable via `NOTFAIR_DATA_DIR`). The entire schema lives in
  `src/server/db/schema.ts` and is applied idempotently on boot — there is
  no migration system. Schema changes edit that file; dev databases are
  recreated, not migrated.
- **Agent state**: agent workspaces live at `~/.notfair/agents/<agent-id>/`.
  NotFair owns the workspace; the chosen harness adapter writes whatever
  files it expects (CLAUDE.md for Claude Code, AGENTS.md for Codex, plus the
  shared IDENTITY.md / SKILL.md / PROJECT.md NotFair writes).
- **Sessions / transcripts**: stored in SQLite (`sessions`,
  `transcript_events`). The chat route persists every adapter event; the UI
  replays them on attach. Tick sessions are labeled `tick-<n>`; the intake
  chat is `main`.
- **Goals**: agent = goal. `goals` + `goal_actions` + `goal_metric_snapshots`
  + `goal_learnings` + `goal_ticks` tables; db module `src/server/db/goals.ts`;
  loop runtime under `src/server/goals/` (intake, tick, metric, provision,
  identity). The 30s scheduler in `src/server/scheduler/tick.ts` sweeps
  `goals.next_tick_at`.
- **MCP**: NotFair exposes two internal MCP servers as Next routes —
  `notfair-goals` (`/api/mcp/goals`, the goal tools) and `notfair-browser`
  (`/api/mcp/browser`). External catalog tokens are project-scoped in
  `mcp_tokens`; every agent in a project gets every connected server.
- **Memory**: shared workspace context is `~/.notfair/projects/<slug>/PROJECT.md`
  (synced into every agent identity; written via the `set_shared_context`
  tool). Per-agent memory is the `goal_learnings` ledger + the agent's own
  workspace files.

## Architectural tenets

- **Harness-agnostic.** NotFair runs on top of any local AI coding agent that
  conforms to the `HarnessAdapter` contract under `src/server/adapters/`.
  Today: Claude Code (`claude-code-local`) and Codex (`codex-local`).
- **NotFair owns the runtime services.** Goal scheduling, MCP token storage,
  agent provisioning, session/transcript persistence — all in SQLite + Node.
  Adapters only handle: (1) spawning the harness to stream a turn, (2) writing
  harness-specific workspace config, (3) registering MCP servers for the
  harness to find.
- **Single-user local CLI.** A local Next.js process launched via the
  `notfair` bin. No multi-tenant code paths, no auth, no multi-process state
  coordination.
- **No legacy code.** No migration shims, no backward-compat branches, no
  dead flags. When a concept is removed, every trace of it goes — code,
  schema, comments, and on-disk state.
- **Don't rebuild the wheels.** Before proposing any new abstraction,
  identify whether an existing tool already solves the sub-problem. Prefer
  thin glue layers over custom infrastructure.

## Commit style

Conventional commits with type-scope-description: `feat(goals): backfill
metric history at intake`, `fix(tick): clamp smart sleep to deadline`.

Co-author trailer when AI-assisted:
```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```
