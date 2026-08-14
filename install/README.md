# Per-host install adapters

This directory is the home for **thin install adapters** that wire NotFair into a specific AI agent host. Each adapter registers the *same* host-agnostic skills (under `seo/`, `google-ads/`, `meta-ads/`, `gemini/` at the repo root) into the host's expected layout.

## Why this exists

NotFair ships one source of truth for skills. Different agent hosts expect skills in different places:

- **Claude Code** — reads `.claude-plugin/plugin.json` directly from the repo. No adapter needed; the manifest at the repo root *is* the adapter.
- **Codex** — installs the repository directly as `notfair@nowork-studio`. `.codex-plugin/plugin.json` loads the universal MCP configuration and a portable `skills/` wrapper index that forwards to the same host-agnostic skill sources; no separate copied adapter is needed.
- **Hermes** — reads `AGENTS.md` at the workspace root. Same shape as Codex.

## Adding a new host adapter

1. Create `install/<host>/install.sh` (or `.py`, or whatever the host prefers).
2. The adapter should:
   - Read skills from their canonical location (`seo/`, `google-ads/`, etc.) — do not copy them into per-host directories unless the host's loader requires it.
   - If the host requires copying, copy the minimum needed and link the rest.
   - Write any host-specific configuration with **managed-block fences** (see below).
3. Add a "host = `<host>`" branch to `../INSTALL_FOR_AGENTS.md` describing how the agent should invoke the adapter.
4. Update `../AGENTS.md` if the host introduces new orchestrator skills (most hosts will not — they will route to the same canonical skills).

## Managed-block fence convention

If your adapter writes into a file the user also edits (their workspace `AGENTS.md`, `CLAUDE.md`, host config, etc.), wrap inserted content like this:

```
<!-- notfair:managed -->
... auto-generated rows ...
<!-- /notfair:managed -->
```

Re-running the installer rewrites only inside the fence. Anything the user wrote outside is preserved. This is what makes `/notfair:upgrade` safe across hosts where users have hand-customized their config.

## What not to put here

- **Skill source code.** Skills belong in `seo/`, `google-ads/`, `meta-ads/`, `gemini/`. Adapters point at them; adapters do not own them.
- **Runtime state.** Use `~/.toprank/<host>/` (path retained from the toprank → notfair rename; see CHANGELOG 0.24.0) or the host's standard runtime directory.
