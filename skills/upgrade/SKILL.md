---
name: upgrade
argument-hint: "<or just run '/notfair:upgrade'>"
description: >
  Upgrade the NotFair plugin to the latest version. Updates the marketplace repo,
  installs the new version to the plugin cache, and updates installed_plugins.json.
  Use when asked to "upgrade notfair", "update notfair", or "get latest version".
  Also handles inline upgrade prompts when a skill detects UPGRADE_AVAILABLE at startup.
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Canonical NotFair workflow

Read [`../../notfair-upgrade-skill/SKILL.md`](../../notfair-upgrade-skill/SKILL.md) completely, then follow it as the active workflow. Resolve every relative reference from that file against `../../notfair-upgrade-skill/`.
