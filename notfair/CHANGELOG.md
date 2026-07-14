# NotFair

## Unreleased

**Codex account and model state now match the local CLI.** The sidebar reads authentication independently from usage availability, shows the correct ChatGPT Pro label, keeps authenticated users signed in when a rate-limit window is absent, and offers a working manual sign-in button when Codex is actually logged out. The chat model selector now names the configured Codex model instead of showing an opaque “Default” label.

**Completed checks stop looking active.** A harness final event now renders as a static “Turn complete” state with no spinner, heartbeat, shimmer, or increasing timer. Read-only check logs also explain that follow-up belongs in the goal chat instead of implying the agent is still working forever.

**Code changes go through pull requests — and the loop tracks them natively.** Goals whose levers live in your website's code (SEO above all) now have a sanctioned, governed channel: the agent may change code only inside the workspace's **Codebase folder** (new Settings card, validated + editable any time), only on a `notfair/…` branch, and only via a PR it registers with the new `register_pull_request` tool — never a direct push, never merging its own PR. You review and merge on GitHub, exactly like any teammate's PR. The platform syncs PR state through your authenticated `gh` CLI on every check (and when you view the goal), so each tick brief carries the live truth: changes requested → the agent addresses your review comments that tick; awaiting review → your Goal tab and the goals index show a "PR needs your review" badge; merged → the observation window measures from there; closed unmerged → the agent scores the action as rejected and learns. Open PRs also pin the heartbeat to its normal cadence (no smart-sleep past a pending review). Without a codebase folder set, code stays off-limits and agents log recommendations instead.

**Fix: the START button now appears without a manual reload.** The goal page only auto-refreshed during `intake` and `active`, so once the metric verified (→ `proposed`) the page went static — the agent would say "press START" but the button never rendered until you reloaded. `proposed` goals now poll too, so the target recording and the START card surface live.

**Goal creation gets a platform focus — dynamic per workspace.** The goal form (goals index and a new onboarding step 3, "First goal") shows one focus chip per connected platform — Google Ads, Meta Ads, SEO (Search Console), X Ads, Analytics — plus "Other". Picking a focus swaps in platform-appropriate placeholder text and tap-to-fill example statements, and the choice rides along to the agent's intake kickoff so it explores the right platform even when the statement is ambiguous. Connect Search Console and SEO goals are one tap away — without auto-flooding the index with machine-proposed goals (the audited X Ads suggestions remain the only auto-generated ones). Onboarding now ends by minting that first goal instead of dropping you on an empty index; skippable, and the workspace form is identical.

**Pick which account each connection targets — right where you connect.** Multi-account MCPs (Google Ads, Meta Ads, Search Console) now resolve their workspace account/property on the Connections page, not just in onboarding. Finishing OAuth auto-keeps a still-valid selection, silently persists the only reachable account, and otherwise opens a picker dialog listing what the new token can reach. Each card carries one action tracking its setup state — **Connect** → **Choose account/property** → a quiet **Switch account/property** — with the persisted selection shown on the card (`Search Console property: sc-domain:example.com`) and Disconnect / Remove tucked into the ⋯ menu, so switching accounts never requires reconnecting. Selections persist on the workspace row and feed every goal agent's identity, keeping each workspace's agents on exactly one account per platform. Onboarding's connect step now renders the same `McpCard` rows and picker dialog as the Connections page — its bespoke connector tiles and three full-page picker steps are gone, so the Connect → Choose → Switch lifecycle is identical on both surfaces, and the picker's rows use the design system's elevated surfaces instead of borders. The account-selection layer is covered by the repo's first vitest suite (`pnpm test`).

## 0.9.0 — 2026-07-10

**Renamed: notfair-cmo is now just NotFair — and the CMO is gone.** The product pivoted from "a CMO delegating to platform specialists" to **agent = goal**: you mint an agent per goal, define the goal by chatting with it, and it runs a disciplined improvement loop until the number says done. npm package `notfair-cmo` → `notfair` (bin: `notfair`), data dir `~/.notfair-cmo` → `~/.notfair` (auto-migrated on first start, merging safely with any plugin config already there), env vars `NOTFAIR_CMO_*` → `NOTFAIR_*`.

**Conversational goal intake with server-verified metrics.** A fresh agent's goal is empty; the chat defines it: the agent records the ambition (`define_goal`), explores your connected platforms, authors + tests ONE query that returns a single number, and submits it (`propose_goal_metric`) — the platform re-runs the exact call server-side and only a reproducible number, with its measured baseline, moves the goal forward. The loop starts only after you explicitly confirm the target in chat (`activate_goal` rejects targets on the wrong side of the baseline).

**Heartbeat ticks with measurement discipline.** On your cadence, the platform measures the metric mechanically — agents never self-report the number they're judged on — and wakes the agent with a tick brief: current reading, actions due for review vs. still gated, memory, stop-condition flags. Mutations must be logged before execution with a falsifiable expected effect and an observation window that gates their resources until review; expired actions must be scored against their predictions before any new move; "achieved" is rejected by the server unless the measured metric meets the target. One mutation per tick, hard stop.

**Everything legacy is deleted, not deprecated.** The CMO and platform-specialist agents, the task board/kanban, the approvals inbox + policies, the questions system, the activity log, and the delegation machinery are all gone — UI, MCP tools, server modules, and tests. Agents run autonomously inside a spend envelope; your controls are the envelope, the observation-window gate, and pause/close. The MCP surface is now 12 tools: the goal lifecycle + loop bookkeeping, `get_project`, `set_shared_context`, and `schedule_recurring_work`.

**Shared context + private memory.** `PROJECT.md` is the workspace brief every agent carries in its identity (any agent updates it via `set_shared_context`, which re-renders all agent identities); each agent keeps its own learnings ledger (`log_learning` / `search_learnings`) and workspace files. All connected MCPs register to every agent automatically.

**New surfaces.** The project root is the goals index (one row per agent: status, statement, live metric); each agent's page is its goal dashboard — sparkline vs. target, tick diary linking to full transcripts, open actions with review dates, memory — with Chat/Files/Skills/Cron/Settings tabs. Onboarding is two steps (name workspace → connect sources) and drops you at the goals index. Sidebar: Goals + Crons/Connections/Settings.

**Goals are the only identity.** No agent personas: the sidebar and every page label goals by an agent-written `short_label` ("Wasted X spend → $0"); the machinery behind a goal is "this goal's agent", full stop. Routes live under `/goals/…`, creation is statement-first (type the ambition, land inside the already-streaming kickoff thread), and platform-generated briefs render as compact system lines, not fake user bubbles.

**Consent + control are platform-enforced.** The agent can propose everything but start nothing: `propose_target` records the plan, the user's START click begins the loop and fires the first tick immediately. Live goals are amendable in chat (`amend_goal`); per-action spend is logged and totaled against the envelope in every tick brief; other agents' observation-gated resources appear in each brief; idle-gated loops sleep until the earliest review date. Two goal modes: **achieve** (complete at target) and **maintain** (hold the number forever — target met is the steady state, and the loop never self-closes).

**Progress you can see.** Each goal's rail carries a time-true progress chart: the metric line with target/baseline references, every agent mutation as a hoverable marker (predicted vs. observed effect), observation windows shaded, deadline flagged, crosshair tooltips. New `backfill_metric_history` tool lets the agent reconstruct ~30 days of per-day history at setup (platform-verified like the metric), so the chart has context from day one. Maintain goals lead with a streak — "held at target for N days" — plus a per-check strip (held / intervened / drifted); the workspace index gains mini sparklines and 7-day deltas per goal. (Migration 022.)

**One screen per goal, one scheduler.** The goal page unifies chat + status rail (metric, sparkline, checks with full logs, open actions, memory) — the Goal/Chat/Files/Settings tabs, chat-thread management, and the entire Crons surface (page, tool, engine) are gone. The heartbeat is the only recurring thing in the product, and the nav is: your goals, Connections, Settings.

Schema: migrations 017–021 (goal tables; one live goal per agent; per-action spend; short labels; goal mode). Eval suite `goal-tick.eval.ts` locks the loop's three invariants (stop at target, review first, respect the gate).

## 0.8.0 — 2026-07-07

**Slack-style "needs you" badges.** When an agent asks a question or requests an approval, a red badge with the count appears next to that agent in the sidebar — visible from every page — and on the blocked task's row in the task rail. Clicking the agent deep-links straight into the decision space (the blocked task with the question/approval card ready to answer) instead of Chat. Badges ride the existing 2–8 s liveness poll and clear the moment you answer. The green in-flight indicator on agent rows was removed — the red badge is the only signal, by design.

**Task rail simplified.** One flat list (no more Working/Blocked/Done section headers), no "All quiet." status line, no per-row age counters. Each row is now two lines — task id on top, title below clamped to two lines with an ellipsis — with uniform row heights, sidebar-matching spacing (`gap-1`), and the same rounded selection treatment the agent sidebar uses.

**Onboarding connect step reworked.** The "Required for <X> agent" pills are gone; each tile's description now reads "Gives the <X> agent the ability to …" so the MCP→agent dependency is plain language. Google Analytics moved out of the recommended tiles into the "More tools" browse dialog (it powers no specialist agent); a connected GA shows up as an extras row.

**Agents can no longer "restart" terminal tasks into the void.** `submit_task_status` on a cancelled/done/failed task used to be a silent success no-op — an agent asked to "restart the task" would rerun the work, get success back, and narrate progress the DB never recorded. It now returns an instructive error naming the terminal status and pointing the agent at `create_task` for redos.

**Fixes.** Files tab's file list now uses the theme sidebar token instead of a hardcoded near-white, so dark mode renders correctly. Removed the stray divider under the chat thread-selector header row.

## 0.7.1 — 2026-06-06

**Sidebar shows the installed version + a one-click Upgrade button.** The sidebar footer now always displays `NotFair v<x.y.z>`. When the npm registry has a newer release, an `v<x.y.z> available` button appears next to it — click runs `npm i -g notfair@latest` via a new `/api/upgrade` endpoint and surfaces "Restart to apply" on success. Latest-version lookup is cached 1 hour in-process so the sidebar polling doesn't pound `registry.npmjs.org`.

When `npm` isn't discoverable on the user's PATH (rare but real on minimal shells), `/api/upgrade` returns the command string instead and the client copies `npm i -g notfair@latest` to the clipboard so the user can run it themselves.

## 0.7.0 — 2026-06-06

**Browser tools split into their own standalone MCP server.** The 11 `browser_*` tools moved out of `notfair-orchestration` into a new `notfair-browser` MCP at `/api/mcp/browser`. The orchestration surface drops from 32 tools to 21 (task / approval / project / cron only); each MCP server now has one clear job. Codex / Claude Code configs gain a second internal entry automatically on next project visit — no manual reconfig.

**Tool descriptions sharpened to fight plugin collisions.** Real failure observed where a Codex-hosted CMO asked to "launch your browser" found OpenAI's bundled `browser-use` plugin first, then fell back to `open -a "Google Chrome"` (wrong profile, no shared cookies). Following Hermes' convention, every browser tool description now does explicit tool routing: `browser_open` claims the "launch the browser / open a page / go to <URL>" intent up front and names the wrong choices to ignore (browser-use plugin, `open -a`, AppleScript, xdg-open, `start chrome`). The orchestration skill loaded into every agent's IDENTITY/AGENTS.md gains a `CRITICAL: which "browser" tool to use` section enumerating the same anti-fallbacks.

**Multi-agent safety: `browser_shutdown` removed from the agent surface.** With multiple agents sharing one workspace Chrome, any agent calling shutdown would kill the browser mid-task for the others. Browser lifecycle is now user-owned (Settings → Stop) and process-exit-owned only.

**5-minute idle auto-shutdown.** A 30s background tick stops any workspace browser with no activity in the last 5 minutes (override via `NOTFAIR_BROWSER_IDLE_TIMEOUT_MS`). Settings card surfaces the countdown as `auto-stops in 258s if idle` alongside uptime.

**Hidden Codex env-var bug fixed.** The Codex spawn loop only injected the orchestration bearer; for `notfair-browser` (and any future internal MCP), Codex saw the config entry but had no token, so tool discovery silently excluded the tools. Now both internal MCPs share the same machine secret via env injection.

E2E verified: fresh Codex chat turn — Greg (CMO) asked to open https://example.org chose `notfair_notfairco__notfair_browser.browser_open` directly, no shell fallback, no plugin attempts.

## 0.6.0 — 2026-06-05

**Workspace browser tool — agents can drive real Chrome.** One managed Chrome instance per workspace at `~/.notfair/projects/<slug>/browser/user-data/`, shared by every agent in that project via labeled tabs. The user signs into Google / Meta / Search Console once (Settings → Workspace browser → Launch + Open <service>), cookies persist in the workspace profile, and every agent inherits the session on subsequent runs.

The agent surface is 11 small typed MCP tools — `browser_status`, `browser_tabs`, `browser_open`, `browser_close`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_back` — matching the granularity of the rest of the `notfair-orchestration` MCP. `browser_shutdown` is intentionally NOT exposed to agents: with multiple agents sharing one workspace Chrome, any agent calling shutdown would kill the browser mid-task for the others. Browser lifecycle is user-owned (Settings → Stop) and process-exit-owned.

Agents are taught the snapshot-before-act discipline and the `label=<agent_id>` convention via the shared orchestration skill so multi-agent runs at 9am (CMO + Google Ads + Meta + SEO crons firing together) don't race — each agent only acts on its own tab.

**Idle auto-shutdown.** A 30s background tick stops any workspace browser with no agent activity in the last 5 minutes (override via `NOTFAIR_BROWSER_IDLE_TIMEOUT_MS`). Settings card surfaces the countdown as "auto-stops in 258s if idle" alongside uptime.

**Settings → Workspace browser card.** Live status (running / not running, port, uptime, idle countdown), Launch / Stop, sign-in shortcuts for Google / Meta / Search Console, and a list of open tabs. Verified end-to-end in dev: launching from Settings spawns Chrome with the workspace `--user-data-dir`, status flips to running, Stop tears it down cleanly.

Under the hood: Chrome lifecycle (binary discovery, `SingletonLock` cleanup, deterministic CDP port allocation in 19000-19099) borrowed from openclaw; Playwright (CDP-attach mode, via `playwright-core`) for the actual page driving. No bundled browser — uses system Chrome. SSRF/loopback hardening from openclaw was intentionally NOT ported: NotFair is single-user localhost-only, and the MCP server already requires bearer auth.

## 0.5.0 — 2026-06-03

**Multi-MCP onboarding + per-MCP specialist agents.** The connect step in onboarding is now a four-tile picker: Google Ads, Meta Ads, Google Search Console, and a "More" overflow modal. Each recommended tile is OAuth-wired to its own NotFair MCP and, on successful connect, triggers provisioning of the matching specialist agent — `meta_ads` (Mia) and `gsc` (Sasha) join the existing `cmo` (Greg) and `google_ads` (Ana) templates. CMO is the only template that ships unconditionally; specialists are gated on the user actually connecting their MCP.

After each OAuth callback the user lands back on the connect step so they can wire up the next tool. When a connected MCP exposes more than one account/property, the matching account picker (Meta `act_*` ad accounts, GSC `sc-domain:` / URL properties) auto-selects when only one is reachable and otherwise shows a Google-Ads-style picker. Selections persist as `projects.meta_ads_account_id` and `projects.gsc_property_id` (migration 015) so specialists always target the right entity.

Skip → "Done adding MCPs — next step" once at least one MCP is wired. The setup screen still waits for `ensureProjectAgents` (CMO + any specialists provisioned by the connect-time hooks) before routing the user into the CMO task workspace.

Agent pages now render a **"Connect <Platform> MCP"** blocker in place of the chat/tasks UI when a specialist's required MCP token is missing — both before initial connect and after a later disconnect. The predicate is colocated in `src/server/onboarding/agent-mcp-blocker.ts` for unit-test coverage; the card lives at `src/components/agent-mcp-blocker-card.tsx`.

The trusted-connectors registry promotes Meta Ads and Google Search Console to first-class `MCP_CATALOG_PRESETS` so they're always visible on the Connections page even when not yet connected. The "More" modal on the onboarding step hides the recommended trio (they have first-class tiles already) via a new `hideKeys` prop on `BrowseConnectorsDialog`. **Heads-up:** the GSC MCP listing tool is best-guessed as `listSites` (Search Console API's native term); if the deployed MCP uses a different method name, swap the `GSC_LIST_TOOL` constant in `src/server/onboarding/accounts.ts` — the failure surface is a clean "method not found" RPC error.

## 0.4.4 — 2026-06-03

**Cron jobs actually run now.** The Crons calendar was rendering future occurrences from the cron expression and creating `scheduled_jobs` rows, but the tick loop that actually dispatches due jobs was never starting. `ensureSchedulerRunning()` was defined in `src/server/scheduler/tick.ts` and imported from nowhere — no layout, no instrumentation, no CLI. Net effect: clicking a past occurrence on the calendar showed no status badge and the Result section had nothing to render, because `scheduled_job_runs` stayed empty forever.

New `src/instrumentation.ts` registers a `nodejs`-runtime hook that calls `ensureSchedulerRunning()` once per server boot. Verified live: a test cron inserted at 16:45 UTC fired ~25s later, Codex returned a short reply, the green-check badge appeared on the calendar chip, and the detail dialog rendered the captured summary with duration (7.6s).

**Run summaries are captured and shown.** `loadCronRuns()` used to hardcode `summary: ""` even though the Result section in the detail dialog rendered from that field — so every completed run, no matter what the adapter produced, displayed "Run finished with no summary." `dispatchJob` now accumulates the adapter's final-text event (or concatenated delta chunks, capped at 4000 chars) and `finishJobRun` persists it to a new `summary` column on `scheduled_job_runs` (migration 014). The calendar's detail dialog now shows what the agent actually said.

**Failed-run badge fix.** The calendar's status glyph maps "ok" → green check and "error" → red badge, but `loadCronRuns` was returning `"failed"` for failed runs — they rendered as a neutral gray dot. `normalizeRunStatus` now maps `done → ok` and `failed → error` at the read boundary so the destructive badge fires correctly. Same helper applies to `jobToDisplay`'s `last_status` so the per-cron summary row matches.

## 0.4.3 — 2026-06-02

**Humanized tool-call rendering in the chat transcript.** The chat used to show every shell call as the raw command — long `/bin/zsh -lc "rg --files ..."` lines splatted right under the assistant's reasoning, with both the tool group's `name` and `label` rendering the same incantation. Visually noisy and didn't tell the user anything they couldn't infer from the prose above it.

The transcript now leads with the *intent*. A new `humanizeTool` helper unwraps `bash -lc`-style shell wrappers, inspects the leading binary, and maps it to a verb phrase: `rg`/`grep` → "Searched files", `git status` → "Ran git status", `cat`/`head`/`tail` → "Read file", `pwd` → "Checked working directory", and so on. Built-in tools (Read/Write/Edit/fetch) and MCP tool names (`mcp__notfair-googleads__listAdAccounts` → "Called list ad accounts") get the same treatment. The raw command stays in the expandable body for power users; the small mono identifier (`shell`, `runScript`, etc.) lives on the row as a debug tag.

Codex `command_execution` items are also re-tagged from `name: "<first line of command>"` to `name: "shell"`, so icon lookup hits Terminal correctly and the working indicator stops reading "Calling /bin/zsh -lc …".

**MCP tool calls now stream into the transcript at all.** Codex 0.132+ surfaces MCP invocations as a distinct `mcp_tool_call` item type (separate from `command_execution` and `tool_call`), and our parser was only handling the older two. Net effect: every MCP call the CMO and Google Ads agents fired was silently dropped from the chat — the conversation jumped straight from "I'll query the account" to the prose summary with nothing visible in between. Parser now consumes `mcp_tool_call` (and `mcp_call` / `function_call` for completeness) and emits a `<server>.<tool>` name so the catalog matcher can resolve the brand.

**MCP brand favicons next to tool calls.** When a tool name resolves to a known MCP server in the project's catalog — matched via Claude Code's `mcp__<key>__<tool>` namespace, Codex's `notfair_<proj>__<server>__<tool>` namespace, or the `mcp_tool_call` `<namespaced-server>.<tool>` shape (the matcher peels the `notfair_<proj>__` prefix to find the bare server key) — the row renders the server's brand favicon (via `t3.gstatic.com/faviconV2`) instead of the generic Wrench icon. Falls back gracefully to Wrench when the favicon misses or the catalog has no match.

The chat page and the per-agent task workspace both forward the project's catalog to `LiveTranscript`; `agent-task-workspace` gained a `mcpCatalog` prop that passes straight through.

## 0.4.2 — 2026-06-01

**TTL cache on MCP probe results.** Every server render of `/connections` (and the chat thread page's notfair-googleads banner) used to fan out one `initialize` JSON-RPC call per connector to verify liveness. With six connectors that was six round-trips on every page load — fine for one user dogfooding, rude to upstreams as usage grows.

New `mcp/probe-cache.ts` wraps `getMcpStatus` with an in-process TTL cache keyed by `(project_slug, catalog_key)`. State-aware TTLs:
- `connected` → 60 s (access tokens live for hours; staleness within a minute is invisible)
- `unreachable` → 10 s (recover quickly when the provider comes back)
- `stale_token` / `not_configured` / `configured_no_token` → no cache (user-actionable states where instant feedback matters)

Invalidated explicitly in `setMcpBearer` (after fresh OAuth callback) and `disconnectMcp` so reconnects show updated state on the very next render rather than waiting out the TTL. Pinned to `globalThis` so Next.js HMR doesn't drop the cache on every code edit.

Tradeoff: the status badge can be up to 60 s out of date if you revoke an OAuth grant from the provider's dashboard. Acceptable for a local single-user tool.

## 0.4.1 — 2026-06-01

**Silent OAuth refresh for MCP connections.** The Connections page stopped flapping to "token expired" every hour for providers with short-lived access tokens (Stripe, Mixpanel, Supabase, PostHog). The MCP OAuth callback used to discard the `refresh_token`, `expires_in`, and `scope` fields from the token-endpoint response and store only the access token — so when the upstream rotated it (~1h for most providers), the only recovery path was a manual "Reconnect" click.

The callback now captures the full token envelope and persists the token endpoint + DCR-issued `client_id` / `client_secret` alongside it (new migration `013`). A new `mcpRpcAutoRefresh` wrapper proactively swaps an expiring access token (within 60s) and reactively retries once on HTTP 401, rotating the stored pair when the provider issues a new refresh token (RFC 6749 §6).

Existing token rows (created before this release) have no refresh token captured, so they continue to fall through to the existing reconnect-on-401 UX. After one fresh reconnect they pick up silent refresh.

**Probe + tool-list + onboarding's account picker** now route through `mcpRpcAutoRefresh`, so the status badge, the View tools dialog, and Google Ads account selection all stay green across the access-token TTL boundary instead of flashing stale_token between refreshes.

**Stripe (and any AS that gates refresh tokens on client capability) now issues one.** Dynamic client registration now advertises `grant_types: ["authorization_code", "refresh_token"]` per [SEP-2207](https://modelcontextprotocol.io/seps/2207-oidc-refresh-token-guidance). Without it, Stripe's MCP authorization server returned only an access token at consent time — forcing a manual reconnect every ~1h. After this change, reconnecting Stripe captures a refresh token alongside the access token, and silent rotation works the same as it does for Supabase and Mixpanel.

## 0.4.0 — 2026-05-31

Redesigned Connections page + curated "Browse connectors" UX. The catalog now ships with a small directory of trusted MCPs you opt into; clicking a tile adds it to the project and starts OAuth in one step. The page itself was rebuilt as an editorial list with a top-right "Add server" menu.

**Connections page redesign.** Cards became list rows inside a single bordered container; sharper typographic hierarchy (eyebrow + large H1 + mono section labels); status communicated via small colored dot + small-caps mono label instead of pill backgrounds; the "Add server" affordance moved to the header.

**Browse connectors.** New dropdown menu on the header splits "Browse connectors" (curated grid of NotFair Google Ads, NotFair Meta Ads, Stripe, PostHog, Supabase, Mixpanel) and "Add custom connector" (paste-a-URL form). Tile click chains `addUserMcpServerAction` → `startMcpConnect` → browser redirect — no second click. Tiles for connectors already connected in the project render non-clickable with a green "connected" lozenge.

**Preset connectors are now removable.** New migration `012` adds `projects.hidden_mcp_preset_keys_json`. Removing a preset (e.g. NotFair Google Ads) hides it from the project's catalog and clears its token + adapter wiring; re-adding from Browse unhides it.

**OAuth fidelity fixes that shook out during dogfooding:**
- RFC 8414 §3.1 inserted form for AS metadata. Stripe's issuer `https://access.stripe.com/mcp` only resolves via the inserted variant.
- `client_secret_post` fallback when an AS doesn't advertise `none` as a token-endpoint auth method (Supabase). DCR registers as a confidential client; the callback already forwards `client_secret` at token exchange.
- `MCP-Protocol-Version: 2025-06-18` on every JSON-RPC call. Some servers (Supabase) 400 without it.
- Status probe uses spec-mandated `initialize` instead of `tools/list`. Tool count moves to on-demand fetch via the Tools dialog.
- `localhost` → `127.0.0.1` normalization on the redirect URI. RFC 8252 §7.3.
- HTTP-error response body is captured + surfaced in the unreachable message instead of just "HTTP 400".
- AS-metadata candidate-URL probing (RFC 8414 inserted, OIDC inserted, appended fallbacks).

**Idempotent add + URL-based dedup.** `addUserMcpServerAction` now accepts a canonical `key` override (used by Browse so "NotFair Google Ads" hits the preset key `notfair-googleads` instead of slugifying into a different identifier). The action also detects "this same MCP server URL is already in the project" and returns the existing key instead of writing a duplicate.

**Trusted connectors curated.** Vercel and Supabase were each verified end-to-end:
- Stripe, PostHog, Mixpanel: kept after URL corrections (most live at `/mcp`, not `/`).
- Supabase: kept after the `client_secret_post` fallback landed.
- Vercel: omitted. Their DCR endpoint silently returns a single fixed `client_id` and the authorize endpoint rejects every loopback redirect URI — only their first-party integrations work today.

**New components:** `browse-connectors-dialog`, `mcp-icon` (shared brand favicon via Google's faviconV2 service, subdomain-stripped to the registrable domain), `add-mcp-server-card` (now a `AddMcpServerMenu` dropdown trigger; the custom-URL dialog moved inside).

## 0.3.1 — 2026-05-31

User-configurable MCP catalog. The Connections page is no longer limited to the curated preset list — users can register any OAuth-2.0 MCP server (Stripe, Vercel, Supabase, or their own) by pasting a resource URL. The portal probes RFC 9728 protected-resource discovery + RFC 8414 AS metadata before persisting, so only servers that actually support dynamic client registration get past the form.

- New `user_mcp_servers` SQLite table (migration `011`), project-scoped, joined with `MCP_CATALOG_PRESETS` by the new `getMcpCatalog(project_slug)` helper.
- `mcpSpecByKey` is now project-scoped (`(project_slug, key)`); all call sites updated.
- New server actions: `probeMcpDiscovery`, `addUserMcpServerAction`, `removeUserMcpServerAction`.
- New "Add an MCP server" card on the Connections page; user-added cards get a "Remove server" affordance presets don't have.
- `cascadeDeleteProjectArtifacts` cleans up `user_mcp_servers` rows on project deletion and unregisters the adapter rows for both presets and user-added entries.

## 0.3.0 — 2026-06-01

End-to-end wiring + reliability pass on top of the 0.2.0 harness-agnostic rewrite. Every surface in the app is now driven by a real, persisted code path; no more half-finished stubs.

### Agents can actually use the tools they're given

- **`schedule_recurring_work` MCP tool** — agents create real rows in `scheduled_jobs` instead of shelling out to a CLI that no longer exists. Skill prompt rewritten to teach the tool; the dead `openclaw cron add` block is gone.
- **Codex MCP auth fixed** — Codex 0.132+ rejects raw `headers.Authorization` rows as `Auth: Unsupported`. Registration now writes `bearer_token_env_var`; spawn injects one env var per server. Orchestration keeps its dedicated `NOTFAIR_ORCHESTRATION_BEARER` for backward compat.
- **Codex sandbox bypass** — adapter spawns Codex with `--dangerously-bypass-approvals-and-sandbox` so MCP tool calls aren't silently cancelled and loopback to the local orchestration server actually works.
- **External MCPs reach agents on OAuth complete** — `setMcpBearer` now also calls `registerCatalogMcpForProject`, wiring the new bearer into every agent's harness config. New agents provisioned later also inherit existing project tokens.
- **Per-server env var scheme** (`NOTFAIR_MCP_BEARER__<SERVER>`) so multiple MCPs can coexist with different bearers in the same Codex spawn.

### Live transcript: paperclip-style pub/sub

- In-process `EventEmitter` keyed by `session_id`. `appendTranscriptEvent` publishes after every INSERT.
- SSE bridge (`/api/agents/.../live`) subscribes instead of polling. Sub-millisecond push latency for chat / tool / lifecycle events.
- Reattach is race-free: backfill from `cursor=0` runs *after* the subscription is attached, with events buffered during the backfill and dedup-by-seq on flush.
- Verified end-to-end via curl SSE alongside the chat composer: each new event arrives in its own SSE frame, in order.

### Recover from agent silence

- New "abandoned task" state surfaced when the harness turn ends cleanly but the agent forgot to call `submit_task_status`. Previously this stranded the task in `working` with an infinite "Wrapping up" spinner.
- Recovery card with three explicit actions:
  - **Resume** — flip back to `proposed` and re-fire the kickoff (transcript preserved).
  - **Mark done** — close the task manually.
  - **Cancel** — terminate.
- New `resumeBlockedTaskAction` and `markTaskDoneAction` server actions.
- Working indicator gets a `mood: "ended"` palette so the spinner doesn't lie during the parked state.

### Sidebar no longer flickers

- Replaced `router.refresh()`-driven badge updates with a client `LiveCountsProvider` polling `/api/in-flight-counts` and pushing fresh numbers through React Context.
- Sidebar's server-rendered structure never reconciles between polls — only the badge nodes flip. Zero flicker across multiple polling cycles.
- `GlobalLivenessPoller` removed entirely; superseded by the context provider.
- `startTransition` wraps remaining `router.refresh()` calls in the task workspace + start-all flows.

### Bug fixes

- **Project delete FK violation** — `deleteProjectRow` and `changeProjectSlug` were missing `questions`, `mcp_tokens`, `scheduled_jobs`, `sessions` in their child-table lists. Added; regression test now seeds every FK-bearing table.
- **Reattach session-mismatch** — chat composer sends `sessionId` matching the URL UUID, but the chat route read `body.thread` and fell back to `"main"`. Now honors both fields with `sessionId` as the canonical thread label.
- **Project isolation: agent-prefix collision** — `listProjectAgents` matched dirs by string prefix; project "acme" leaked agents from "acme-q4". Now filtered by the sidecar's `project_slug` field. Test asserts the cross-leak no longer happens.
- **Session lookup scoped to project** — `findSessionBySessionId` now requires `project_slug` to close the same prefix-collision class of bugs.
- **Files tab dedup** — `PROJECT.md` was appearing twice from a legacy augment step. Removed; field shape on `AgentFileEntry` aligned to UI expectations.

### Removed user-visible "OpenClaw" copy

- Home page, agents page, crons header / error, agent cron header / error, skills header / error, mcp-card, schedule-cron-dialog, create-agent-dialog, danger-zone, agent-danger-zone — all rewritten to describe what's actually running (workspace dirs, scheduled jobs, harness adapters).

### Internal

- `NotFair doctor` drops the OpenClaw / gateway / LLM-config probes; now checks Claude Code + Codex per adapter, requires at least one.
- `agents/files.ts` simplified — fs reader returns every workspace file in one pass.
- 870 tests, 73 test files. Adapter parsers, MCP config writers (Claude Code + Codex), pub/sub emitter, scheduler tool, project delete cascade, sidebar live-counts context, abandoned-task UI flows all covered.

### Migrating from 0.2.0

No DB migration required (the schema landed in 0.2.0). The OAuth callback now auto-registers the catalog MCP with every agent — if you previously connected an MCP that wasn't visible to your agents, just **disconnect and reconnect** from `/<project>/connections` and Greg / Ana will pick it up.

## 0.2.0 — 2026-05-31

### Harness-agnostic rewrite

NotFair is no longer coupled to OpenClaw. Agents run through pluggable
harness adapters — Claude Code (default) and Codex ship as the first two
supported options, and the architecture is open for more.

**Architecture**

- `HarnessAdapter` interface + adapter registry + UI display registry under
  `src/server/adapters/`. Mirrors paperclip's adapter pattern.
- Two adapters fully implemented:
  - `claude-code-local` — spawns `claude --output-format stream-json`,
    parses events, writes workspace `IDENTITY.md`/`CLAUDE.md`, and registers
    MCP servers via `.mcp.json`.
  - `codex-local` — spawns `codex exec --json`, writes workspace
    `IDENTITY.md`/`AGENTS.md`, registers MCP servers in
    `~/.codex/config.toml`.
- Migration `010_harness_adapter.sql` adds `projects.harness_adapter` plus
  five new tables (`mcp_tokens`, `scheduled_jobs`, `scheduled_job_runs`,
  `sessions`, `transcript_events`).
- Native runtime services replace every OpenClaw dependency:
  - **Sessions / transcripts**: `src/server/sessions/` — SQLite rows backed
    by `transcript_events`, plus `view.ts` for the thread dropdown and
    `transcript-tail.ts` for the live SSE bridge.
  - **Scheduler**: `src/server/scheduler/` — cron-parser tick loop, schedule
    rows in `scheduled_jobs`, runs in `scheduled_job_runs`. The tick loop
    dispatches due jobs through the project's adapter.
  - **MCP token storage**: `src/server/mcp/tokens.ts` — project-scoped tokens
    in SQLite, surfaced via `mcp/state.ts` (`getMcpStatus`, `setMcpBearer`,
    `disconnectMcp`).
  - **Agent provisioning**: `src/server/agents/{provisioning,clone,
    cascade-delete,files,skills}.ts` — workspace ownership and
    create / clone / delete entirely in fs + SQLite.

**Routes + UI rewired**

- `/api/chat` dispatches through the project's harness adapter and persists
  every event to `transcript_events`.
- `/api/agents/.../threads/.../live` polls `transcript_events` at 500 ms and
  streams new rows as SSE — no shadow JSONL anymore.
- `/api/agents/.../threads/.../transcript` reads the same table by `seq`
  cursor for paged tail.
- `/api/mcp-oauth/callback` writes tokens straight into `mcp_tokens`.
- Onboarding flow shows a recommended-harnesses picker (Claude Code default,
  Codex available) with paperclip-style "Recommended" badges. Choice persists
  on the project row.
- `agent-templates.ts` provisions every agent through the chosen adapter and
  registers the notfair-orchestration MCP per-agent at provision time.
- Orchestration wake-ups (`run-task.ts`, `approval-wakeup.ts`,
  `question-wakeup.ts`) all dispatch via adapter + persist to
  `transcript_events`.

**bin/cli.mjs**

- `NotFair doctor` checks Claude Code and Codex separately, requires at
  least one of them on PATH, and drops every former `openclaw --version` /
  gateway / LLM-config probe.

**Deleted**

- `src/server/openclaw/` — entire directory (24 files) including
  `cli.ts`, `gateway-client.ts`, `gateway-rpc.ts`, `crons.ts`,
  `cron-schedule.ts`, `sessions.ts`, `transcript-tail.ts`,
  `shadow-transcript.ts`, `thread-origins.ts`, `clone-agent.ts`,
  `project-delete.ts`, `agent-turn.ts`.
- `src/server/mcp-state.ts` (replaced by `src/server/mcp/state.ts`).
- `src/components/paired-openclaw-pill.tsx` and the sidebar footer that hosted it.
- Legacy tests that mocked the removed modules (8 test files removed; will
  be re-added with adapter-aware coverage as the new surfaces stabilise).

**Tests**

- 852 tests passing across 69 files.
- New adapter parsers (`claude-code-local/parse`, `codex-local/parse`)
  have dedicated coverage.
- Full test suite + dev server boot verified after every migration step.

## 0.1.0

Initial OpenClaw-coupled release.
