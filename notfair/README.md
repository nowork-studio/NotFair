# NotFair

> Goal-driven, loop-powered marketing on your machine, on top of Claude Code or Codex. State an ambition — "cut CAC to $30", "keep wasted spend at $0" — and a dedicated agent turns it into a measured metric and runs a disciplined loop against it. Goals are the only thing you name, see, and manage; the agents behind them are invisible plumbing.

Open source. Runs entirely on your machine. Bring your own LLM credentials (via the harness CLI you already authenticate to) and your own ad-platform OAuth.

## What it gives you

- **Goals are the identity.** Type the ambition, and you land in a chat where the goal's agent is already working: it sharpens the ask, labels the goal ("Wasted X spend → $0"), authors + tests a metric query against your connected platforms, and the platform *re-runs the query server-side* — only a reproducible number with a measured baseline goes on the books. You agree the target in chat; the loop starts only when you press **START** (and the first tick runs immediately). Two modes: **achieve** (reach the number, done) and **maintain** (hold it there forever — a watchdog).
- **Platform-focused onboarding.** Connect the data sources a goal needs, choose the relevant account or property, and tag the goal with its platform focus. The focus guides the intake conversation and metric design; every project connection is still wired to every goal agent.
- **The tick loop.** On the cadence you agree, the platform measures the metric mechanically (the agent never self-reports the number it's judged on) and wakes the agent: it scores past moves against their predicted effects, then the protocol allows at most **one** new move and requires a log entry with a falsifiable expected effect and observation window. Future goal turns use those records to avoid gated resources until review. The agent's page is the diary: sparkline vs. target, tick-by-tick log, open actions, accumulated memory.
- **Fully autonomous, visibly so.** No approval inbox — agents are instructed to act inside the spend envelope you set, with observation-window discipline, a pause button for scheduled work, and their recorded moves visible in the app. These are workflow controls for a trusted harness, not a sandbox against arbitrary local commands.
- **Code changes through pull requests.** Attach a GitHub-backed codebase and an agent can work in its own branch, commit and push the change, then register the pull request with NotFair. The app tracks the PR, while its goal protocol instructs the agent to leave merge decisions to you and keep one code mutation in flight at a time. Those rules are prompt-level guardrails, not mechanically enforced permissions.
- **Shared context + private memory.** `PROJECT.md` is the workspace brief every agent carries (any agent can update it via `set_shared_context`); each agent also keeps its own learnings ledger and workspace files. All connected MCPs are shared by every agent.
- **One screen per goal.** The conversation and the loop's state live together: chat on the left (where the goal is defined and steered), a status rail on the right — the progress chart, the plan, every check with its full log, open actions with review dates, and the agent's memory. No tabs, no thread management, nothing else to learn.
- **Progress you can see.** A time-true chart with the target line, every agent action as a marker on the moment it happened (hover: what it did, what it predicted, what actually happened), observation windows shaded, and history backfilled at setup from the platform's own date-segmented stats — context from day one. Maintain goals get a streak ("held at target for 12 days") with a per-check strip; the workspace index shows a mini sparkline + 7-day delta per goal.
- **Project-scoped MCP connections** — one-click PKCE OAuth brings third-party tools (Google Ads via NotFair's hosted MCP) into the agents' toolbox. Connection records are stored in local SQLite and wired into the chosen harness automatically; Codex receives bearer tokens through per-server environment variables at process launch.

## Pick your harness

At onboarding you pick which local AI coding agent runs the work:

| Harness | Status | Notes |
|---|---|---|
| **Codex** | Recommended | Uses your existing `codex` login. Per-server env-var bearers. The sidebar reports the authenticated account's plan and usage, and model selectors show the configured model name. The adapter launches Codex with `--dangerously-bypass-approvals-and-sandbox`; that process inherits the parent environment and can access files available to your local user. Treat goal agents as trusted local automation. |
| **Claude Code** | Supported | Uses your existing `claude` login. Per-agent `.mcp.json` for isolation. |

Different projects can run on different harnesses; the choice persists on the project row.

## Prerequisites

- **Apple Silicon Mac.** The published npm package currently declares `darwin`/`arm64` support only.
- **Node 20+** (Node 24 recommended for native-module prebuilds).
- **At least one harness installed and authenticated**:
  - [Claude Code](https://docs.claude.com/en/docs/agents-and-tools/claude-code/overview), or
  - [Codex CLI](https://github.com/openai/codex)

Run `notfair doctor` to check Node, both harness binaries, the data directory, and the port. The current command exits non-zero when either Claude Code or Codex is missing, even though the app itself only needs the harness selected for the project.

## Install + run

```bash
# One-shot, no install:
npx notfair@latest doctor      # verify env
npx notfair@latest             # launch UI on http://127.0.0.1:3327

# Or install globally:
npm install -g notfair
notfair
```

The UI opens in your browser. Sidebar is project-scoped; create one to start.

## CLI

```
notfair                 Launch local server + open UI (default)
notfair start           Same as above
notfair doctor          Run preflight checks (see below)
notfair --version
notfair --help
```

Options on `start`: `--port <n>` (default 3327), `--no-open`, `--data-dir <path>`.
Options on `doctor`: `--port <n>`, `--data-dir <path>`.

`doctor` checks Node ≥ 20 (24 recommended), Claude Code on PATH, Codex on PATH, at least one harness ready, a writable data directory, and a free preferred port. It exits 0 if every check is passing and 1 otherwise, with a `Fix:` line under each failure naming the exact command to run.

## What happens when you create a goal

1. You type a goal statement and can select its platform focus. NotFair creates the goal row (status `intake`), provisions an anonymous goal agent, and creates its workspace at `~/.notfair/agents/<agent-id>/`. The goal protocol is mirrored into the harness's native config (`CLAUDE.md` / `AGENTS.md`, `.mcp.json` for Claude Code, sections in `~/.codex/config.toml` for Codex), with the project's connected MCPs wired in.
2. You chat while the agent records the ambition (`define_goal`), authors and tests a metric query, submits it (`propose_goal_metric` — the platform re-runs it server-side and stores the measured baseline), then proposes the measured target (`propose_target`). The loop does not activate itself: you press **START**, and the first tick runs immediately.
3. The heartbeat rides a `setInterval` in the Next.js process polling every 30 seconds. Due goals get a tick: the metric is measured, a brief is composed from the database, one adapter turn runs, and the diary row is written. A completed check opens as a static log instead of remaining in a streaming state.

## Code changes through pull requests

Attach a local Git repository to the project in **Settings → Codebase**. When a goal requires source changes, the agent works in a dedicated worktree and branch, commits and pushes its changes, opens a GitHub pull request, and registers it with NotFair. Pull-request state is synchronized back into the goal. The goal protocol tells the agent not to merge its own PR or begin a second code mutation before the first is resolved, but the unsandboxed harness can technically run those commands; review the branch and PR as you would any other trusted local automation.

## Connecting MCP servers (for live ad-platform data)

The Connections page lists the MCP servers in our catalog (NotFair Google Ads, Meta Ads, Google Search Console, Google Analytics, X Ads — plus browseable extras like Stripe and Supabase, or any custom MCP URL). Click **Connect** to start a one-click PKCE OAuth flow — no environment variables to set, no Google Cloud project of your own to register.

Connections that expose multiple accounts or properties let you choose and later switch the active selection from the Connections page. Goals use that project-scoped selection when querying the platform.

OAuth credentials are persisted in the project-scoped `mcp_tokens` table and the catalog MCP is automatically registered with every agent in the project via the chosen harness's config. New agents provisioned later get the same wiring. The credentials are not yet encrypted at the application layer, so protect access to `~/.notfair/db.sqlite` and your local user account.

## Live transcript

Chat events (deltas, tool calls, lifecycle) are persisted to `transcript_events` and **also** pushed through an in-process `EventEmitter` keyed by session id. Open tabs subscribe via SSE; new events land in milliseconds. Re-attach to a streaming thread (open the URL in a second tab while the agent is mid-turn) is race-free: the server backfills from cursor=0 before attaching the live subscription, with dedup-by-seq.

## Data location

- App state: `~/.notfair/db.sqlite` (override with `--data-dir` or `NOTFAIR_DATA_DIR`)
- Agent workspaces: `~/.notfair/agents/<agent-id>/`
- Harness configs: `~/.claude/` for Claude Code; `~/.codex/config.toml` for Codex (managed by the respective CLI)
- Orchestration MCP secret: `~/.notfair/mcp-server-secret` (0600 perms)

## What V1 is and isn't

**Is:** the goal loop — conversational goal intake with server-verified metrics, heartbeat ticks with measurement discipline, per-agent memory, shared workspace context — plus goal chat, PR-governed code changes, and an MCP connection hub. Runs on Claude Code or Codex, no proprietary agent runtime.

**Isn't (yet):** cross-goal coordination (resource leases between agents touching the same campaigns), per-LLM-call cost tracking, or a hosted mode. Those land as the loop earns trust in the field.

See `ARCHITECTURE.md` for the design and `CONTRIBUTING.md` for development setup.

## License

MIT — see LICENSE.
