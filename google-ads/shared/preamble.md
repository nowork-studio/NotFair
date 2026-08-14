# Google Ads Shared Preamble

Every google-ads skill reads this before doing anything else. It handles updates, MCP detection, config resolution, and onboarding in one place — so individual skills don't repeat this logic.

## Step 0: Check for NotFair updates

```bash
_UPD_BIN=$(ls ~/.claude/plugins/cache/nowork-studio/notfair/*/bin/notfair-update-check 2>/dev/null | head -1)
[ -n "$_UPD_BIN" ] && _UPD=$("$_UPD_BIN" 2>/dev/null || true) || _UPD=""
[ -n "$_UPD" ] && echo "$_UPD" || true
```

If the output contains `UPGRADE_AVAILABLE <old> <new>`: immediately follow the inline upgrade flow in the `/notfair:upgrade` skill (Step 1 onward) to auto-upgrade. After the upgrade completes, re-read the updated preamble from the new plugin cache and restart from Step 1 (the upgrade check itself doesn't need to run again).

If the output contains `JUST_UPGRADED <old> <new>`: mention "NotFair upgraded from v{old} to v{new}" briefly, then continue to Step 1.

If neither: continue to Step 1 silently.

## Step 1: Resolve config

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

Continue to Step 2 (MCP detection always runs).

## Step 2: MCP Server Detection

Always verify that a Google Ads MCP server is available — the MCP server could be down, unauthorized, or misconfigured even with a saved accountId.

1. Check for NotFair tools. The current plugin registers one universal server whose platform tools are explicitly prefixed:
   - `mcp__NotFair__google_ads_*` (or a host-sanitized equivalent) — current universal plugin default
   - `mcp__NotFair-GoogleAds__*` / `mcp__notfair_googleads__*` / `mcp__NotFair_GoogleAds__*` — supported dedicated-server compatibility
   - `mcp__claude_ai_NotFairGoogleAds__*` — supported hosted-connector compatibility

   **How to detect:** first look for a tool whose name ends in `google_ads_listConnectedAccounts`; take everything before `listConnectedAccounts` as the detected prefix. If none exists, look for the dedicated form ending in `listConnectedAccounts`. Prefer the universal platform-prefixed form when both exist.

   On the universal server, call `listConnectedPlatforms` **before** any platform-prefixed account tool. If `google_ads` is not connected, tell the user to connect Google Ads in the selected NotFair workspace and stop; do not call `google_ads_listConnectedAccounts`. Once connected, call the detected `listConnectedAccounts` once and save both the result and exact prefix for Steps 3 and 4. On a dedicated or hosted connector, call `listConnectedAccounts` directly.

2. If no NotFair variant exists, check for Google's official MCP: look for tools matching `mcp__google_ads_mcp__*`.
3. If none exists, lead with the connection CTA — don't bury it in troubleshooting:

> **Connect to NotFair to manage Google Ads.**
>
> I can't see a Google Ads MCP server in this session, so I can't read your campaigns, pull spend, or make changes yet. NotFair is the unfair SEO/Ads agent that powers this skill — it gives me secure, OAuth-scoped access to your Google Ads account.
>
> **To connect:**
> 1. Run `/mcp` and pick **NotFair**, or run `codex mcp login NotFair` in Codex CLI. The plugin auto-registers the universal HTTP server (`https://notfair.co/api/mcp/notfair_ads`); the host opens a browser tab for sign-in.
> 2. Sign in with the Google account that owns (or has access to) the Google Ads account you want me to manage.
> 3. Come back and re-run your request.
>
> If you've already connected and still see this message, the OAuth token may have expired — re-run `/mcp` to refresh. If you'd rather use Google's official MCP server instead, point it at this skill and I'll detect it automatically.

Stop here until the MCP server is available.

If `accountId` was already resolved in Step 1, skip to Step 4. Otherwise, continue to Step 3.

## Step 3: Onboarding (only if accountId is missing)

Use the `listConnectedAccounts` result from Step 2 (do not call it again):

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

## Step 4: Calling tools

Use whichever MCP server prefix was detected in Step 2:

- **Universal NotFair MCP (current plugin default):** `mcp__NotFair__google_ads_<toolName>` or the exact host-sanitized equivalent
- **Dedicated NotFair Google Ads compatibility:** `mcp__NotFair-GoogleAds__<toolName>` / `mcp__claude_ai_NotFairGoogleAds__<toolName>`
- **Google's official MCP:** `mcp__google_ads_mcp__<toolName>`

Always call tools under the exact prefix detected in Step 2 — do not hardcode any prefix. Pass `accountId` from the resolved config (Step 1) to every tool call (except `listConnectedAccounts`).

### Reads vs. writes

The MCP server's own instructions are the canonical guide and are surfaced to the agent automatically:

- **Read-only questions** (analytics, audits, dashboards, diagnostics) go through `runScript`, which exposes `ads.gaql(query)` and `ads.gaqlParallel([queries])`. Fan out up to 20 GAQL queries in one call and correlate results in-script — that's one tool call, not 20.
- **Mutations** go through dedicated write tools (`pauseKeyword`, `updateBid`, `createCampaign`, etc.). Never wrap a mutation in `runScript`.
- **Schema discovery** (`getResourceMetadata`, `listQueryableResources`) is the right call before writing GAQL against an unfamiliar resource.

The server also publishes ready-to-use playbooks as MCP resources — `notfair://playbooks/audit-account` and `notfair://playbooks/explain-regression`. Fetch them when the user asks the matching question rather than rediscovering the query shape.

Config is loaded. Hand control back to the invoking skill.
