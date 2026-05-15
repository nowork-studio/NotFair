# Per-host install adapters

This directory is the home for **thin install adapters** that wire Toprank into a specific AI agent host. Each adapter registers the *same* host-agnostic skills (under `seo/`, `google-ads/`, `meta-ads/`, `gemini/` at the repo root) into the host's expected layout.

## Why this exists

Toprank ships one source of truth for skills. Different agent hosts expect skills in different places:

- **Claude Code** — reads `.claude-plugin/plugin.json` directly from the repo. No adapter needed; the manifest at the repo root *is* the adapter.
- **OpenClaw** — expects skills under `~/.openclaw/skills/`. The adapter lives at `../openclaw/install/install.sh` (kept there for back-compat). Future relocations will preserve a stub here.
- **Codex** — reads `AGENTS.md` at the workspace root. No filesystem install yet; workspace-local usage is the supported path. A future `install/codex/` adapter can register skills into Codex's global skill directory.
- **Hermes** — reads `AGENTS.md` at the workspace root. Same shape as Codex.

## Adding a new host adapter

1. Create `install/<host>/install.sh` (or `.py`, or whatever the host prefers).
2. The adapter should:
   - Read skills from their canonical location (`seo/`, `google-ads/`, etc.) — do not copy them into per-host directories unless the host's loader requires it.
   - If the host requires copying (e.g., OpenClaw rejects symlinks that escape its skill root), copy the minimum needed and link the rest.
   - Write any host-specific configuration with **managed-block fences** (see below).
3. Add a "host = `<host>`" branch to `../INSTALL_FOR_AGENTS.md` describing how the agent should invoke the adapter.
4. Update `../AGENTS.md` if the host introduces new orchestrator skills (most hosts will not — they will route to the same canonical skills).

## Managed-block fence convention

If your adapter writes into a file the user also edits (their workspace `AGENTS.md`, `CLAUDE.md`, host config, etc.), wrap inserted content like this:

```
<!-- toprank:managed -->
... auto-generated rows ...
<!-- /toprank:managed -->
```

Re-running the installer rewrites only inside the fence. Anything the user wrote outside is preserved. This is what makes `toprank-upgrade` safe across hosts where users have hand-customized their config.

## What not to put here

- **Skill source code.** Skills belong in `seo/`, `google-ads/`, `meta-ads/`, `gemini/`. Adapters point at them; adapters do not own them.
- **Host-specific orchestrators.** Those go alongside the host (e.g., `openclaw/skills/`), not under `install/`.
- **Runtime state.** Use `~/.toprank/<host>/` or the host's standard runtime directory.
