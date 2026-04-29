# Google Ads Shared Preamble

Every google-ads skill reads this before doing anything else. It handles updates, legacy-path migration, MCP detection, config resolution, and onboarding in one place — so individual skills don't repeat this logic.

## Step 0: Check for toprank updates

```bash
_UPD_BIN=$(ls ~/.claude/plugins/cache/nowork-studio/toprank/*/bin/toprank-update-check 2>/dev/null | head -1)
[ -n "$_UPD_BIN" ] && _UPD=$("$_UPD_BIN" 2>/dev/null || true) || _UPD=""
[ -n "$_UPD" ] && echo "$_UPD" || true
```

If the output contains `UPGRADE_AVAILABLE <old> <new>`: immediately follow the inline upgrade flow in the `/toprank-upgrade` skill (Step 1 onward) to auto-upgrade. After the upgrade completes, re-read the updated preamble from the new plugin cache and restart from Step 1 (the upgrade check itself doesn't need to run again).

If the output contains `JUST_UPGRADED <old> <new>`: mention "toprank upgraded from v{old} to v{new}" briefly, then continue to Step 1.

If neither: continue to Step 1 silently.

## Step 1: Migrate legacy `.adsagent` paths (one-time, silent)

The MCP server moved from AdsAgent to NotFair. Existing users may have config and data under `.adsagent`-named paths from before the rename — move it to the new `.notfair` namespace before reading config so all subsequent steps see consistent state. If the new path already exists, **do not overwrite** — flag the conflict and stop.

Run this as a single bash block (atomic `mv`, refuses to overwrite, no-op when nothing to migrate):

```bash
_NF_MIGRATED=()
_NF_CONFLICTS=()

_nf_move() {
  local src="$1" dst="$2"
  if [ -e "$src" ] || [ -L "$src" ]; then
    if [ -e "$dst" ] || [ -L "$dst" ]; then
      _NF_CONFLICTS+=("$src → $dst (target already exists)")
    else
      mv "$src" "$dst" && _NF_MIGRATED+=("$src → $dst")
    fi
  fi
}

# Global config + data directory
_nf_move "$HOME/.adsagent" "$HOME/.notfair"

# Project-level config + data directory (in the current working directory)
_nf_move "$(pwd)/.adsagent.json" "$(pwd)/.notfair.json"
_nf_move "$(pwd)/.adsagent"      "$(pwd)/.notfair"

# Claude-project-level config (slug = CWD with '/' replaced by '-')
_NF_SLUG=$(pwd | sed 's|/|-|g')
_nf_move "$HOME/.claude/projects/$_NF_SLUG/adsagent.json" \
         "$HOME/.claude/projects/$_NF_SLUG/notfair.json"

if [ ${#_NF_MIGRATED[@]} -gt 0 ]; then
  echo "MIGRATED:"
  for m in "${_NF_MIGRATED[@]}"; do echo "  - $m"; done
fi
if [ ${#_NF_CONFLICTS[@]} -gt 0 ]; then
  echo "CONFLICTS:"
  for c in "${_NF_CONFLICTS[@]}"; do echo "  - $c"; done
fi
```

- **Output contains `MIGRATED:`** — briefly tell the user "Migrated your AdsAgent config to the new NotFair location (`.adsagent` → `.notfair`)", then continue to Step 2.
- **Output contains `CONFLICTS:`** — both the legacy and new paths exist for at least one item; the user has partial state from a previous migration attempt. Show the conflicts and tell the user to manually reconcile (typically: inspect both, keep the newer `.notfair` copy, delete the stale `.adsagent` copy). **Stop here** until they resolve it — running with split state will silently lose writes.
- **Empty output** — nothing to migrate; continue to Step 2 silently.

## Step 2: Resolve config

Read config from three locations and merge fields (first non-null, non-empty-string value wins per field):

1. **Project-level** — `.notfair.json` in the repository root (Claude Code's working directory)
2. **Claude project-level** — `~/.claude/projects/{project-path}/notfair.json` (where `{project-path}` is the CWD-based path Claude Code uses for project memory, e.g. `-Users-alice-repos-petshop`)
3. **Global fallback** — `~/.notfair/config.json`

Each file uses the same schema: `{ "accountId": "..." }`. Fields merge up the chain — a project file with only `accountId` inherits from global.

The MCP server authenticates via OAuth 2.1 — Claude Code's native HTTP transport opens a browser for sign-in on first use and stores the token in the OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux). No API key, no `mcp-remote` bridge, no env vars to manage.

### Resolved data directory

Data files (business-context, personas, change-log, account-baseline) are stored project-locally when a project-level config exists:

- If `.notfair.json` exists in the current working directory → `{data_dir}` = `.notfair/` (relative to project root)
- Otherwise → `{data_dir}` = `~/.notfair/` (the Claude project-level config alone doesn't trigger project-local data — only a `.notfair.json` in the repo does)

Create `{data_dir}` if it doesn't exist. Ensure `~/.notfair/` also exists (needed for the global config file regardless of `{data_dir}`). Throughout this document and all skills, `{data_dir}` refers to this resolved directory.

**Important:** If using project-local storage (`.notfair/`), ensure `.notfair.json` and `.notfair/` are in the project's `.gitignore` — they contain business-sensitive data that should not be committed.

Continue to Step 3 (MCP detection always runs).

## Step 3: MCP Server Detection

Always verify that a Google Ads MCP server is available — the MCP server could be down, unauthorized, or misconfigured even with a saved accountId.

1. Check for NotFair tools. The MCP server may be exposed under several different tool-name prefixes depending on the host (and during the AdsAgent → NotFair rename, both old and new prefixes may briefly coexist):
   - `mcp__notfair__*` — Claude Code CLI (toprank plugin default, current)
   - `mcp__claude_ai_NotFair__*` — Claude Desktop / claude.ai plugin connector (current)
   - `mcp__adsagent__*` — Claude Code CLI (legacy, pre-rename plugin)
   - `mcp__claude_ai_AdsAgent__*` — Claude Desktop / claude.ai (legacy connector name)
   - any other prefix matching `mcp__.*([Nn]ot[Ff]air|[Aa]ds[Aa]gent)__` (future hosts)

   **How to detect:** scan your available tool list for any tool whose name ends in `listConnectedAccounts`. Take everything before `listConnectedAccounts` as the detected prefix. If multiple candidates exist, prefer them in this order: `mcp__notfair__` > `mcp__claude_ai_NotFair__` > `mcp__adsagent__` > `mcp__claude_ai_AdsAgent__` > any other match. Call `listConnectedAccounts` using that detected prefix, and save both the result and the prefix itself for reuse in Steps 4 and 5.

   **Legacy-prefix migration nudge:** if the chosen prefix is `mcp__adsagent__` or `mcp__claude_ai_AdsAgent__` (i.e. a legacy AdsAgent variant) and no current `mcp__notfair__*` / `mcp__claude_ai_NotFair__*` tools are visible, briefly tell the user once:

   > Detected the legacy AdsAgent MCP server. The plugin has been renamed to NotFair — please **restart Claude Code** to pick up the new server registration (`mcp__notfair__*`). Continuing with the legacy server for this session.

   Then proceed normally — the legacy server still works (it points at the new notfair.co URL after the recent endpoint update); only the tool-name prefix is stale.

2. If no NotFair/AdsAgent variant exists, check for Google's official MCP: look for tools matching `mcp__google_ads_mcp__*`.
3. If none exists, guide the user:

> No Google Ads MCP server detected.
>
> The MCP server may not have connected, or the OAuth sign-in didn't complete. Try restarting Claude Code — the toprank plugin's .mcp.json registers the `notfair` HTTP MCP server, and Claude Code will open a browser tab for OAuth sign-in to NotFair on first connection. You can also trigger sign-in manually with `/mcp`.
>
> If the problem persists, check your MCP server settings or configure a Google Ads MCP server manually.

Stop here until the MCP server is available.

If `accountId` was already resolved in Step 2, skip to Step 5. Otherwise, continue to Step 4.

## Step 4: Onboarding (only if accountId is missing)

Use the `listConnectedAccounts` result from Step 3 (do not call it again):

1. **One account** → save automatically to the highest-priority config file that already exists (project > claude-project > global; if none exist yet, save to `~/.notfair/config.json`), tell the user which was selected
2. **Multiple accounts** → show numbered list, ask user to pick, save choice to the same location
3. **Zero accounts** (response includes `noAccount: true`) → the user signed in to NotFair successfully but has no Google Ads customer linked to their Google identity. Tell them:
   > "Your Google account isn't linked to a Google Ads customer yet. Create one at https://ads.google.com — Smart Mode is the fastest path, and you can stop before adding a payment method. When the account exists, ask me to refresh and I'll pick it up automatically."
   When they confirm the account is created, call `refreshAccounts` (no args). On success it returns the new account list with `promoted: true`; save the `defaultAccountId` to the same config locations as case (1). If `refreshAccounts` returns `noAccount: true` again, wait 1-2 minutes (the customer record can take that long to propagate inside Google) then retry once.

### Switching accounts

If the user explicitly asks to switch accounts, run `listConnectedAccounts`, let them pick, then ask:

> "Save this account for this project only, or globally?"

- **Project** → write `accountId` to `.notfair.json` in the current working directory (create the file if needed)
- **Global** → write `accountId` to `~/.notfair/config.json`

## Step 5: Calling tools

Use whichever MCP server prefix was detected in Step 3:

- **NotFair MCP via Claude Code CLI (current):** `mcp__notfair__<toolName>`
- **NotFair MCP via Claude Desktop / claude.ai plugin (current):** `mcp__claude_ai_NotFair__<toolName>`
- **Legacy AdsAgent MCP via Claude Code CLI (pre-rename):** `mcp__adsagent__<toolName>`
- **Legacy AdsAgent MCP via Claude Desktop / claude.ai plugin:** `mcp__claude_ai_AdsAgent__<toolName>`
- **Google's official MCP:** `mcp__google_ads_mcp__<toolName>`

Always call tools under the exact prefix detected in Step 3 — do not hardcode `mcp__notfair__` or `mcp__adsagent__`. Pass `accountId` from the resolved config (Step 2) to every tool call (except `listConnectedAccounts`).

### Reads vs. writes

The MCP server's own instructions are the canonical guide and are surfaced to the agent automatically:

- **Read-only questions** (analytics, audits, dashboards, diagnostics) go through `runScript`, which exposes `ads.gaql(query)` and `ads.gaqlParallel([queries])`. Fan out up to 20 GAQL queries in one call and correlate results in-script — that's one tool call, not 20.
- **Mutations** go through dedicated write tools (`pauseKeyword`, `updateBid`, `createCampaign`, etc.). Never wrap a mutation in `runScript`.
- **Schema discovery** (`getResourceMetadata`, `listQueryableResources`) is the right call before writing GAQL against an unfamiliar resource.

The server also publishes ready-to-use playbooks as MCP resources — `adsagent://playbooks/audit-account` and `adsagent://playbooks/explain-regression`. Fetch them when the user asks the matching question rather than rediscovering the query shape.

Config is loaded. Hand control back to the invoking skill.
