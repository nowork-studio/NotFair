# Toprank — Public AI-Agent Plugin (Claude Code, OpenClaw, Codex, Hermes)

**This is the public, open-source repository that ships to all customers and the community.**

Toprank is a host-agnostic plugin providing SEO, Google Ads, and Meta Ads skills for AI coding agents. It is distributed via the `nowork-studio` Claude Code marketplace and via direct agent install on OpenClaw, Codex, and Hermes. Every change here is user-facing.

## Agent entry points (single sources of truth)

- **`AGENTS.md`** — the universal skill resolver. Every host reads this to route user intents to the right skill. Update it whenever a skill is added, removed, or its purpose changes.
- **`INSTALL_FOR_AGENTS.md`** — the single paste-URL target that walks an AI agent through host detection and install.
- **`install/README.md`** — convention for adding per-host install adapters (Codex, Hermes, etc.) without duplicating skills.

## Working style: brutal honesty, relentless quality

This code ships to real users. Sycophancy and rubber-stamping cost us credibility every time a bad skill lands in someone's Claude. Hold the line:

- **Be brutally honest.** If a request is a bad idea, say so with reasoning — don't soften it, don't bury it in caveats, don't implement it anyway because the user asked. "This won't work because X" is more useful than a polite attempt that fails in production.
- **Critically think about every request.** Before implementing, challenge the premise: Is this the right problem to solve? Does it match an existing skill? Will it make the plugin better for users, or just bigger? Push back when the answer is no.
- **Relentless about quality.** High quality, reliable, and maintainable — non-negotiable. No half-finished skills, no untested prompts, no "we'll fix it later." If it's not ready to land in a customer's environment, it's not ready to commit.
- **Surface tradeoffs explicitly.** When a request has hidden costs (complexity, maintenance burden, user confusion, prompt fragility), name them before writing code. Let the user make the call with full information.
- **Disagree when warranted.** Agreement is not the goal; the best outcome for users is. If the user is wrong, say so — with evidence.

## Repository purpose

- Home of the `toprank` plugin — the public artifact customers install.
- Contains host-agnostic skills under `google-ads/`, `seo/`, `meta-ads/`, `gemini/`, and `toprank-upgrade-skill/`.
- Contains OpenClaw-specific multi-site orchestrators under `openclaw/skills/` that compose the host-agnostic skills above.
- Registered via `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` (Claude Code) and `AGENTS.md` (every other host).
- Paired with the NotFair-GoogleAds and NotFair-MetaAds MCP servers (OAuth at notfair.co) for ad-platform writes, and Google Search Console for SEO reads.

## Critical: this ships to users

- Treat every commit as a release candidate. Broken skills, bad prompts, or missing files become customer bug reports.
- Never add internal-only notes, secrets, credentials, dev scratch files, or references to private infra. This repo is public.
- Test skills end-to-end before shipping — `SKILL.md` frontmatter (`name`, `description`, triggers) is how Claude decides to invoke them; typos or stale descriptions break discovery.

## Branding: NotFair going forward

The product is **NotFair**. All new user-facing text, documentation, skill descriptions, and config namespaces must use NotFair / `notfair.co` / `.notfair/` / `mcp__notfair__*`. Do not introduce new references to "AdsAgent", "adsagent", `.adsagent/`, `mcp__adsagent__*`, `adsagent.org`, or the `adsagent://` URI scheme in new code or new docs.

Existing legacy references that are still in the codebase fall into two categories:

1. **Load-bearing compatibility code** — the `.adsagent/` → `.notfair/` filesystem migration in `google-ads/shared/preamble.md` Step 1, the `mcp__adsagent__*` prefix detection in Step 3, and the matching signal detection in `gemini/SKILL.md`. These are doing real work for users upgrading from pre-0.16 plugins. Do not remove without an explicit deprecation plan.
2. **Historical record** — `CHANGELOG.md` entries describing past renames. Never rewrite history.

If you find a non-load-bearing, non-historical `adsagent` reference in active skill text or docs, scrub it.

## When adding or modifying a skill

1. Create/edit the skill directory under the appropriate category (`google-ads/`, `seo/`, etc.) with a `SKILL.md` containing valid frontmatter.
2. **Register it in `AGENTS.md`** under the matching intent table. A skill that isn't in `AGENTS.md` is invisible to OpenClaw, Codex, Hermes, and any non-Claude host.
3. **Register it in `.claude-plugin/plugin.json`** under the `skills` array. A skill that exists on disk but isn't listed here will NOT appear in the installed Claude Code plugin — this has already bitten us once with `ads-landing`.
4. Bump the version in three places so upgrades propagate:
   - `.claude-plugin/plugin.json` → `version`
   - `.claude-plugin/marketplace.json` → both `metadata.version` and `plugins[0].version`
   - `VERSION` file at repo root
5. Update `CHANGELOG.md` with a user-facing note.
6. Verify locally, then ship via `/ship`. Users pick up the new version through `toprank:toprank-upgrade`.

## Versioning

Semantic-ish: bump patch for skill additions / fixes, minor for new categories or meaningful capability jumps, major for breaking skill API changes. Keep `VERSION`, `plugin.json`, and `marketplace.json` in lockstep — drift causes upgrade detection bugs.

## Related repos

- `adsagent-plugin/` (sibling dir, separate public repo) — a smaller Google-Ads-only plugin. Some skills are mirrored there; don't confuse it with this one.
- NotFair MCP server — private, powers the Google Ads tool calls the skills depend on.
