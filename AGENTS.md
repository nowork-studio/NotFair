# Toprank — Skill Resolver for AI Agents

**This file is the universal entry point.** Any AI coding agent (Claude Code, OpenClaw, Codex, Hermes, Cursor, etc.) reads this to know which Toprank skill to run for which user intent.

If you are an agent and a user mentions Google Ads, Meta Ads, SEO, GEO, or anything in the tables below, route to the named skill.

---

## How to use this file

1. **Match the user's intent** against the rows below.
2. **Read the named skill's `SKILL.md`** from the path shown.
3. **Follow the procedure** in that SKILL.md exactly.

Skills under `seo/`, `google-ads/`, `meta-ads/`, `gemini/`, and `toprank-upgrade-skill/` are **host-agnostic** — they work the same on every agent host. The skills under `openclaw/skills/` are **OpenClaw-only orchestrators** that compose the host-agnostic skills into multi-site adaptive workflows; only invoke them inside an OpenClaw workspace.

---

## SEO

| Intent | Skill | Path |
|---|---|---|
| Full-site SEO audit, traffic drop, GSC analysis, Core Web Vitals | `seo-analysis` | `seo/seo-analysis/SKILL.md` |
| Single-page deep audit (URL-specific) | `seo-page` | `seo/seo-page/SKILL.md` |
| Write or improve content (blog, landing, service page) | `content-writer` | `seo/content-writer/SKILL.md` |
| Keyword discovery, topic clusters, content calendar | `keyword-research` | `seo/keyword-research/SKILL.md` |
| Title tags, meta descriptions, Open Graph, CTR | `meta-tags-optimizer` | `seo/meta-tags-optimizer/SKILL.md` |
| JSON-LD / structured data (FAQ, Product, HowTo, etc.) | `schema-markup-generator` | `seo/schema-markup-generator/SKILL.md` |
| Broken-link / 404 / site-health crawl | `broken-link-checker` | `seo/broken-link-checker/SKILL.md` |
| Rank in ChatGPT / Perplexity / AI Overviews (GEO / AEO) | `geo-optimizer` | `seo/geo-optimizer/SKILL.md` |
| Connect WordPress, Strapi, Contentful, or Ghost | `setup-cms` | `seo/setup-cms/SKILL.md` |

## Google Ads

| Intent | Skill | Path |
|---|---|---|
| First-time setup or account health check | `google-ads-audit` | `google-ads/audit/SKILL.md` |
| Performance, keywords, bids, budgets, negatives, experiments, bulk ops | `google-ads` | `google-ads/manage/SKILL.md` |
| Write ad copy, RSA headlines/descriptions, A/B variants | `google-ads-copy` | `google-ads/copy/SKILL.md` |
| Landing-page quality, ad-to-page match, LPX diagnosis | `google-ads-landing` | `google-ads/landing/SKILL.md` |

## Meta Ads

| Intent | Skill | Path |
|---|---|---|
| First-time Meta setup or account health check | `meta-ads-audit` | `meta-ads/audit/SKILL.md` |
| Facebook/Instagram performance, ROAS, CPM, creative fatigue, audience overlap | `meta-ads` | `meta-ads/manage/SKILL.md` |

## Cross-model review

| Intent | Skill | Path |
|---|---|---|
| Second opinion / review / challenge / consult via Google Gemini | `gemini` | `gemini/SKILL.md` |

## Plugin maintenance

| Intent | Skill | Path |
|---|---|---|
| Upgrade Toprank to the latest version | `toprank-upgrade` | `toprank-upgrade-skill/SKILL.md` |

---

## OpenClaw multi-site orchestrators

These skills only apply inside an OpenClaw workspace that has been initialized via `./openclaw/install/install.sh`. They compose the host-agnostic SEO skills above into closed-loop, multi-site workflows with persisted artifacts under `~/.toprank/openclaw/`.

| Intent | Skill | Path |
|---|---|---|
| Register a new site in the portfolio | `toprank-site-onboard` | `openclaw/skills/toprank-site-onboard/SKILL.md` |
| Pick which site in the portfolio deserves attention next | `toprank-portfolio-review` | `openclaw/skills/toprank-portfolio-review/SKILL.md` |
| Weekly SEO review for one registered site | `toprank-weekly-review` | `openclaw/skills/toprank-weekly-review/SKILL.md` |
| Improve one URL inside a registered site | `toprank-improve-page` | `openclaw/skills/toprank-improve-page/SKILL.md` |
| Investigate an organic traffic drop on a registered site | `toprank-investigate-drop` | `openclaw/skills/toprank-investigate-drop/SKILL.md` |

If the user mentions multi-site work, portfolio, scheduled follow-ups, or "the next best action across my sites," prefer an OpenClaw orchestrator. For single ad-hoc requests on one site, use the canonical SEO skill directly.

---

## External dependencies

- **Google Search Console** — required for all SEO skills that read live data.
- **Google Ads (NotFair MCP)** — `https://notfair.co/api/mcp/google_ads`, OAuth. Required for Google Ads skills.
- **Meta Marketing API (NotFair MCP)** — required for Meta Ads skills.
- **Google Gemini API key** — required for `gemini`.

Skills check for missing credentials at startup and walk the user through setup. Do not invent credentials or skip skills silently — surface the gap.

---

## Conventions for installers (managed-block fences)

Any installer that writes into a file the user also edits (e.g., a user's workspace `AGENTS.md`, `CLAUDE.md`, or `~/.openclaw/AGENTS.md`) MUST wrap its inserted content in a fence:

```
<!-- toprank:managed -->
... auto-generated rows ...
<!-- /toprank:managed -->
```

Re-running the installer rewrites only inside the fence. Anything outside is preserved.

---

## Bookkeeping

When a new skill is added or removed in this repo, update:

1. The relevant table above in this file.
2. `.claude-plugin/plugin.json` → `skills` array.
3. `VERSION`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` (version bump).
4. `CHANGELOG.md` (user-facing note).

A skill that exists on disk but is missing from this file or `plugin.json` is invisible to agents.
