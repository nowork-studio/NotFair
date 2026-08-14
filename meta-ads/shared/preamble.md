# Meta Ads Shared Preamble

Every meta-ads skill reads this before doing anything else. Handles update checks, MCP detection, config resolution, and onboarding so individual skills don't repeat this logic.

## Step 0: Check for NotFair updates

```bash
_UPD_BIN=$(ls ~/.claude/plugins/cache/nowork-studio/notfair/*/bin/notfair-update-check 2>/dev/null | head -1)
[ -n "$_UPD_BIN" ] && _UPD=$("$_UPD_BIN" 2>/dev/null || true) || _UPD=""
[ -n "$_UPD" ] && echo "$_UPD" || true
```

If the output contains `UPGRADE_AVAILABLE <old> <new>`: immediately follow the inline upgrade flow in the `/notfair:upgrade` skill (Step 1 onward) to auto-upgrade. After the upgrade completes, re-read the updated preamble from the new plugin cache and restart from Step 1.

If the output contains `JUST_UPGRADED <old> <new>`: mention "NotFair upgraded from v{old} to v{new}" briefly, then continue to Step 1.

If neither: continue to Step 1 silently.

## Step 1: Resolve config

Read config from three locations and merge fields (first non-null, non-empty-string value wins per field):

1. **Project-level** — `.notfair.json` in the repository root
2. **Claude project-level** — `~/.claude/projects/{project-path}/notfair.json`
3. **Global fallback** — `~/.notfair/config.json`

Each file uses the same shared schema. The Meta-specific field is `metaAccountId` — the numeric Meta ad-account id (without the `act_` prefix; the Meta MCP wraps it automatically). This sits alongside `accountId` (Google Ads) in the same config file:

```json
{
  "accountId": "1234567890",
  "metaAccountId": "987654321098765"
}
```

Keeping both platforms in one config file means a user who has run both `/google-ads` and `/meta-ads` doesn't get prompted twice.

The MCP server authenticates via OAuth 2.1 — Claude Code's native HTTP transport opens a browser for sign-in on first use and stores the token in the OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux). No API key, no `mcp-remote` bridge.

### Resolved data directory

Data files (business-context, personas, change-log, account-baseline) are stored project-locally when a project-level config exists:

- If `.notfair.json` exists in the current working directory → `{data_dir}` = `.notfair/` (relative to project root)
- Otherwise → `{data_dir}` = `~/.notfair/`

Create `{data_dir}` if it doesn't exist. Ensure `~/.notfair/` also exists (needed for the global config file regardless of `{data_dir}`). Throughout this document and all skills, `{data_dir}` refers to this resolved directory.

**Meta-specific data files** are namespaced under a `meta/` subdirectory — `{data_dir}/meta/business-context.json`, `{data_dir}/meta/personas/{accountId}.json`, `{data_dir}/meta/account-baseline.json` — so they don't collide with the Google Ads equivalents. The `business-context.json` schema is largely shared; the difference is which file the `/meta-ads-audit` skill reads and writes.

**Important:** If using project-local storage (`.notfair/`), ensure `.notfair.json` and `.notfair/` are in the project's `.gitignore` — they contain business-sensitive data that should not be committed.

Continue to Step 2 (MCP detection always runs).

## Step 2: MCP Server Detection

Always verify that a Meta Ads MCP server is available — the MCP server could be down, unauthorized, or misconfigured even with a saved `metaAccountId`.

1. Check for the NotFair Meta tools. The current plugin registers one universal server whose Meta tools are platform-prefixed:
   - `mcp__NotFair__meta_ads_*` (or a host-sanitized equivalent) — current universal plugin default
   - `mcp__NotFair-MetaAds__*` / `mcp__notfair_metaads__*` / `mcp__NotFair_MetaAds__*` — supported dedicated-server compatibility
   - `mcp__claude_ai_NotFair-MetaAds__*` / `mcp__claude_ai_NotFairMetaAds__*` — supported hosted-connector compatibility

   **How to detect:** first look for a tool whose name ends in `meta_ads_listAdAccounts`; take everything before `listAdAccounts` as the detected prefix. If none exists, look for a dedicated NotFair Meta form ending in `listAdAccounts`.

   On the universal server, call `listConnectedPlatforms` **before** any platform-prefixed account tool. If `meta_ads` is not connected, tell the user to connect Meta Ads in the selected NotFair workspace and stop; do not call `meta_ads_listAdAccounts`. Once connected, call the detected `listAdAccounts` once and save both the result and exact prefix for Steps 3 and 4. On a dedicated or hosted connector, call `listAdAccounts` directly.

2. If no NotFair-MetaAds variant exists, check for Meta's official MCP or community Meta MCP servers (any `mcp__.*meta.*ads__listAdAccounts`). If you find one, fall back to it but warn the user that NotFair's heuristics are tuned for the NotFair MCP surface (specifically `runScript`'s `ads.graphParallel`).

3. If none exists, guide the user:

> No Meta Ads MCP server detected.
>
> The NotFair plugin registers one universal `NotFair` HTTP MCP server (`https://notfair.co/api/mcp/notfair_ads`) in `.mcp.json`. Trigger sign-in with the host's MCP UI (`/mcp` in Claude) or `codex mcp login NotFair` in Codex CLI; the host opens the browser OAuth flow.
>
> If the problem persists, run `/notfair:upgrade` to make sure your NotFair plugin includes the Meta server registration, or configure a Meta Ads MCP server manually.

Stop here until the MCP server is available.

If `metaAccountId` was already resolved in Step 1, skip to Step 4. Otherwise, continue to Step 3.

## Step 3: Onboarding (only if metaAccountId is missing)

Use the `listAdAccounts` result from Step 2 (do not call it again):

1. **One ad account** → save automatically to the highest-priority config file that already exists (project > claude-project > global; if none, save to `~/.notfair/config.json`). Save as `metaAccountId` (without the `act_` prefix). Tell the user which was selected.
2. **Multiple accounts** → show a numbered list (id + name + currency + business name where available), ask the user to pick, save the choice.
3. **Zero accounts** → the user signed in successfully but has no Meta ad account on their Business Manager. Tell them:
   > "Your Meta account isn't linked to an ad account yet. Create or claim one in Meta Business Manager (https://business.facebook.com — Business Settings → Ad Accounts). Once it exists and your user has the 'Manage Campaigns' role on it, ask me to refresh and I'll pick it up automatically."
   On retry, call `listAdAccounts` again. If still empty, suggest they check Business Manager permissions — a common cause is being added to the business but not granted ad-account-level access.

### Switching accounts

If the user explicitly asks to switch accounts, run `listAdAccounts`, let them pick, then ask:

> "Save this account for this project only, or globally?"

- **Project** → write `metaAccountId` to `.notfair.json` in the current working directory (create the file if needed, preserving any existing fields like `accountId`)
- **Global** → write `metaAccountId` to `~/.notfair/config.json`

## Step 4: Calling tools

Use whichever MCP server prefix was detected in Step 2:

- **Universal NotFair MCP (current plugin default):** `mcp__NotFair__meta_ads_<toolName>` or the exact host-sanitized equivalent
- **Dedicated NotFair Meta compatibility:** `mcp__NotFair-MetaAds__<toolName>` / `mcp__claude_ai_NotFairMetaAds__<toolName>`

Always call tools under the exact prefix detected in Step 2 — do not hardcode any prefix. The MCP server's `ads.activeAccountId` is the `act_<metaAccountId>` form derived from the saved `metaAccountId` (Step 1). For most tools you do not need to pass the account id explicitly (the server resolves it from the OAuth session); when a tool does take an `adAccountId` argument, pass `act_<metaAccountId>`.

### Reads vs. writes

The MCP server's own instructions are the canonical guide and are surfaced to the agent automatically:

- **Read-only questions** (analytics, audits, dashboards, diagnostics) go through `runScript`, which exposes `ads.graph(path, params)`, `ads.graphParallel([calls])`, `ads.insights(adAccountId?, options?)`, `ads.batch([requests])`, the `ads.fields.*` field bundles, and `ads.helpers.getDateRange(days)`. Fan out up to 20 Graph API calls in one request and correlate in-script — that's one tool call, not 20.
- **Mutations** go through dedicated write tools (`pauseAd`, `pauseAdSet`, `pauseCampaign`, `enableAd`, `enableAdSet`, `enableCampaign`, `renameCampaign`, `updateAdSetBudget`, `updateCampaignBudget`). Never wrap a mutation in `runScript`.
- **`suggestImprovement`** is the server's structured-recommendation endpoint — call it when you want the server's heuristic take alongside your own analysis, not as a substitute for the analytical work this skill describes.

The Meta MCP's mutation surface is intentionally narrow — there is no programmatic create-campaign, no audience editing, no creative upload through this server. When the user asks for an operation that lives outside the surface, say so plainly and point them to Meta Ads Manager rather than improvising with `runScript`.

Config is loaded. Hand control back to the invoking skill.
