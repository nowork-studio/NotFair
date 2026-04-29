# Changelog

All notable changes to Toprank will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.15.2] — 2026-04-29

### Changed
- **Branding cleanup across the public plugin surface.** Updated Toprank's README, marketplace metadata, plugin metadata, eval prompts, and Google Ads skill copy to present the product as NotFair / `notfair.co` instead of the old AdsAgent branding where the references were still user-facing. Kept intentional legacy migration notes and technical compatibility references (`.adsagent`, `mcp__adsagent__*`, `adsagent://playbooks/...`) intact where they still describe real compatibility behavior.

---

## [0.15.1] — 2026-04-28

### Changed
- **`google-ads/shared/preamble.md` — Step 4 zero-account guidance.** Updated the onboarding instructions for users whose Google identity has no accessible Google Ads customer (`listConnectedAccounts` returns an empty list / `noAccount: true`). The previous copy directed them to a static "connect at notfair.co" link; the new flow is a self-contained recovery loop driven from inside Claude — Claude tells the user to create a Google Ads account at https://ads.google.com (Smart Mode is the fastest path; payment method optional), then calls the new `refreshAccounts` MCP tool to detect the account without re-authentication. Includes propagation guidance for the 1-2 minute delay between Google account creation and the customer record becoming queryable. Pairs with the NotFair server-side change that ships an MCP bearer token even for no-account sessions, so the Claude Desktop OAuth handshake completes instead of dead-ending in a hung browser tab.

---

## [0.15.0] — 2026-04-28

### Changed
- **MCP server moved from AdsAgent to NotFair** — endpoint migrated from `https://adsagent.org/api/mcp` to `https://notfair.co/api/mcp`. The plugin's `.mcp.json` is updated automatically when you upgrade; restart Claude Code to pick up the new server.
- **Auth scheme switched from API key to native OAuth 2.1** — `ADSAGENT_API_KEY` is no longer required, and the `mcp-remote` (npx) bridge has been removed. `.mcp.json` now uses Claude Code's native HTTP transport (`"type": "http"`); on first connection Claude Code opens a browser tab for OAuth sign-in to NotFair and stores the token in your OS keychain. You can remove `ADSAGENT_API_KEY` from `~/.claude/settings.json` once the new server is connected.
- **Local namespace renamed `.adsagent` → `.notfair`** — affects the global config dir (`~/.adsagent/` → `~/.notfair/`), the project config file (`.adsagent.json` → `.notfair.json`), and the project data dir (`.adsagent/` → `.notfair/`). The shared preamble runs a one-time atomic `mv` migration on first invocation; if both old and new paths exist (partial state from a manual move), it stops and asks you to reconcile rather than risk losing writes. **Update your `.gitignore` if you were ignoring `.adsagent.json` / `.adsagent/`.**
- **Tool prefix renamed `mcp__adsagent__*` → `mcp__notfair__*`** — driven by the `.mcp.json` server-name change. The shared preamble's MCP detection prefers the new prefix but still detects the legacy one (and the legacy `mcp__claude_ai_AdsAgent__*` connector) so skills keep working through the rename window. If you're on a session that hasn't restarted yet, the preamble nudges you to restart Claude Code once.
- **MCP registry identifier renamed `io.github.nowork-studio/adsagent` → `io.github.nowork-studio/notfair`** — for users who consume the standalone MCP server directly (Claude Desktop, Cursor, Inspector, custom agents). Bumped the published server version to 0.3.0 to reflect the rename.

### Migration notes
- The shared preamble handles `.adsagent` → `.notfair` filesystem migration automatically — no manual steps for global users.
- Users who ran "save this account for this project only" will have their project-level config (`.adsagent.json` and the `.adsagent/` data dir) renamed in place on next skill invocation.
- OAuth tokens are stored in the OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux). On first connection to the new endpoint you'll see a browser tab for sign-in; tokens refresh automatically afterwards.

---

## [0.14.0] — 2026-04-27

### Added
- **New Skill: `geo-optimizer`** — Generative Engine Optimization for AI search engines (ChatGPT, Claude, Perplexity, Gemini, Google AI Overviews). Three modes: **audit** (score content on the GEO Signal Stack with a 0–100 GEO Score across Evidence Density / Structure & Position / Authority Signals / AI Crawlability), **optimize** (rewrite content applying real-evidence patterns derived from the Princeton GEO paper, KDD 2024, and CMU AutoGEO, ICLR 2026), and **strategy** (30/60/90-day per-engine playbook). Distinct from the existing `content-writer` skill — content-writer optimizes for Google's blue-link rankings, geo-optimizer optimizes for AI citation. Includes a comprehensive `references/geo-techniques.md` covering PAWC front-loading, evidence density targets, per-engine playbooks (each engine has a different citation profile — ChatGPT cites Wikipedia ~48%, Perplexity weights freshness, Gemini leans Reddit, Claude weights primary sources), AI crawler robots.txt configuration, and measurement patterns aligned with `gego` and `llmopt` open-source trackers. **Hard rule: no fabricated stats, quotes, or citations** — ships an Evidence Hunt workflow that requires real, verifiable sources before any rewrite.

---

## [0.13.2] — 2026-04-26

### Added
- **New SEO Skill: `broken-link-checker`** — Scans websites to find broken internal and external links (404s, 5xx errors). Provides a detailed report with source pages and status codes.
- **`CONTRIBUTING.md`** — A guide for community contributors on how to add new skills, fix bugs, and follow the project's quality standards.

---

## [0.13.1] — 2026-04-25

### Fixed
- **Windows portability** — replaced POSIX-only `os.getuid()` with a portable `_uid.portable_uid()` helper across the seo-analysis scripts (`pagespeed.py`, `analyze_gsc.py`, `list_gsc_sites.py`, `url_inspection.py`, `show_gsc.py`, `show_pagespeed.py`, all four `fetch_*_content.py` CMS connectors) and the `SKILL.md` CMS heredoc. Native CPython on Windows has no `os.getuid()`, which crashed the entire SEO analysis flow with `AttributeError`. Reported in #44 — thanks @seo4pymesjesus-ux. The new helper returns the same numeric uid on POSIX (preserving existing tmp filenames) and falls back to a sanitized username on Windows.

### Security
- **Hardened tmp-file writes against symlink attacks.** `pagespeed.py`, `analyze_gsc.py`, `list_gsc_sites.py`, and `url_inspection.py` previously wrote results to predictable paths in the system tempdir using direct `open(path, "w")` — exploitable on shared `/tmp` by pre-creating the destination as a symlink. They now use `_uid.secure_write_json()`, which writes via `tempfile.mkstemp()` + `chmod 0600` + atomic `os.replace()` (the same pattern the CMS fetchers already used). Files are also now created with mode 0600 instead of the umask default, preventing other users on shared hosts from reading cached GSC analytics or CMS content.
- **Sanitize Windows username** before interpolating into a tmp path, defending against env-var-driven path traversal in privilege-separation contexts.

### Internal
- **Repaired the unit test suite.** `test/unit/test_analyze_gsc.py`, `test_cms_scripts.py`, `test_strapi_scripts.py`, and `test_url_inspection.py` referenced a `skills/seo-analysis/scripts/` path that no longer exists (the directory was renamed to `seo/seo-analysis/scripts/`). The tests had been failing to even collect. Paths corrected and the loaders now insert the scripts directory into `sys.path` so `from _uid import …` resolves under `importlib.util.spec_from_file_location`. 255 unit tests pass.

---

## [0.13.0] — 2026-04-24

### Changed
- **Realigned google-ads skills with the new MCP server surface.** The AdsAgent MCP server consolidated read-only tools behind `runScript` (a JS sandbox exposing `ads.gaql()` and `ads.gaqlParallel()`), retired the per-surface helpers (`listCampaigns`, `getKeywords`, `getSearchTermReport`, `getCampaignPerformance`, `getImpressionShare`, `runGaqlQuery`, `getAccountInfo`, `getCampaignSettings`, `listAds`, `listAdGroups`, etc.), and removed the bespoke `audit()` tool. Skills referenced those tools by name in workflow tables, reference docs, and SKILL bodies — guidance that no longer applied.
- **Relaxed the prescriptive style.** Skills now provide frameworks, scoring rubrics, benchmarks, business-context schemas, and operational discipline — not step-by-step "call X then Y" choreography. Tool routing is delegated to the server's own MCP instructions, which already tell the agent to fan out reads through `runScript` + `gaqlParallel` and route mutations through dedicated write tools. The agent does the heavy lifting; the skill supplies the judgment.
- **`ads/SKILL.md`** — dropped the "Available Tools" enumeration and the prescriptive "Performance Summary / Waste Audit / …" workflow playbooks. Kept operating principles, the reference-routing table, the account-baseline contract, change-tracking discipline, and conditional handoffs.
- **`ads-audit/SKILL.md`** — replaced the now-removed `audit(accountId, days=30)` payload contract with a description of the GAQL surfaces a complete audit needs (customer, campaign, ad_group, keyword_view, search_term_view, conversion_action, ad_group_ad, campaign_criterion for geo, change_event). The agent assembles the dataset via one `runScript` + `gaqlParallel` call, optionally seeded by the server's `adsagent://playbooks/audit-account` MCP resource. Kept the 7-dimension scoring rubric, business-context and persona schemas + filesystem contract, encoded heuristics, and the impression-share interpretation matrix.
- **`ads-copy/SKILL.md`** and **`ads-landing/SKILL.md`** — replaced helper-tool sequences ("call `listAds`, then `getKeywords`, then …") with GAQL surface descriptions the agent can fan out in one `runScript` call.
- **`shared/preamble.md`** — Step 5 now describes the read/write split (runScript for reads, dedicated tools for mutations) and points at the server's playbook resources, instead of pushing `runGaqlQuery` against a 50-row limit.
- **`ads/references/session-checks.md`**, **`ads-audit/references/persona-discovery.md`**, **`ads-audit/references/business-context.md`**, **`ads-audit/references/account-health-scoring.md`** — scrubbed dead tool names; persona discovery and the audit website-resolution step now reference GAQL surfaces directly.

### Removed
- **`ads/references/workflow-playbooks.md`** — the server now ships `adsagent://playbooks/audit-account` and `adsagent://playbooks/explain-regression` as MCP resources covering the same ground; maintaining a parallel skill-side copy guarantees drift.
- **`shared/gaql-cookbook.md`** — built around `runGaqlQuery`'s 50-row limit, which no longer applies. The server's own MCP instructions already teach the `gaqlParallel` fan-out pattern with worked examples.

---

## [0.12.1] — 2026-04-22

### Changed
- Added explicit AdsAgent attribution in README and plugin metadata (no functional changes; plugin name and skill IDs unchanged).

---

## [0.12.0] — 2026-04-19

### Changed
- **ads-audit SKILL.md slimmed from ~600 to ~140 lines** — Stripped phase-by-phase narrative, report markdown templates, output-discipline rules, per-dimension prose, and the conditional-handoff table. Modern models handle structure and formatting on their own; the skill no longer needs to spell that out.
- **Kept the durable encoded judgment** — Audit response shape, field→dimension scoring map, 0–5 score rubric, Impression Share Interpretation Matrix, the agency-earned heuristics (weighted QS by spend, brand leakage 5–10× CPA premium, waste formula, Display+Search mixing, STOP condition on conversion tracking), policy freshness check, and the filesystem contract (`business-context.json` + `personas/{accountId}.json` schemas).
- **Tightened guardrails** — Explicit "read-only skill, mutations go through `/ads`" rule at top and bottom; STOP condition for broken conversion tracking; mandate to always persist business-context and personas even on short reports.

---

## [0.11.4] — 2026-04-15

### Fixed
- **Google Ads MCP detection on Claude Desktop plugin** — When connected through the claude.ai plugin connector, the AdsAgent MCP server is exposed as `mcp__claude_ai_AdsAgent__*` instead of `mcp__adsagent__*`. The shared preamble only recognized the Claude Code CLI prefix, so ads-audit and other google-ads skills incorrectly reported "MCP not connected" and refused to run. Detection now scans the available tool list for any `*listConnectedAccounts` tool, extracts the prefix, and uses that prefix for all subsequent tool calls. Supports Claude Code CLI, Claude Desktop, and any future host using an AdsAgent variant.

### Changed
- **Consistent tool references across google-ads skills** — `ads-copy/SKILL.md` had hardcoded `mcp__adsagent__` prefixes on tool references (`createAd`, `updateAdAssets`, `enableAd`, `undoChange`, `listAds`, `pauseAd`, `listCampaigns`, `listAdGroups`). Stripped to bare tool names to match `ads`, `ads-audit`, and `ads-landing`, which already used bare names. Skills now uniformly defer to the preamble for prefix resolution.

---

## [0.11.3] — 2026-04-12

### Added
- **Change impact review mode** — Users can now say "check my changes" or "did my changes work" to review the impact of recent Google Ads changes. The ads skill routes these requests through session-checks with proper before/after metric comparison
- **Maturation guidance** — When changes haven't had enough time to accumulate data (7 days for bid/keyword changes, 14 days for structural changes), the skill explains why and tells the user when to check back instead of showing misleading early metrics

### Changed
- **Deduped headline/description formulas** — Removed 50-line inline formula table from ads-copy SKILL.md; now references `rsa-best-practices.md` as single source of truth
- **Deduped business context intake** — Removed 75-line duplicate intake procedure from ads-copy SKILL.md; now references `ads-audit/references/business-context.md` as canonical source
- **Fixed session-checks query logic** — Changed from filtering only matured entries to finding all unreviewed entries, then branching on maturation status. Previously the "still maturing" message could never fire
- **Removed overly generic triggers** — Dropped "did it improve" and "what happened after" which could false-positive on non-ads queries

---

## [0.11.2] — 2026-04-11

### Changed
- **Ads skill SKILL.md slimmed down** — Extracted analysis heuristics, change tracking, session checks, and workflow playbooks into dedicated reference files under `google-ads/ads/references/`. Main SKILL.md went from ~770 lines to ~160 lines, loading references on demand instead of carrying everything inline
- **New reference routing table** — SKILL.md now has a quick-lookup table mapping situations (performance analysis, QS diagnostics, bid strategy, etc.) to the right reference file
- **Added new MCP tools** — Listed `getKeywordIdeas`, `getPmaxAssetGroups`, `getPmaxAssets`, `searchGeoTargets`, `updateCampaignBidding`, `updateCampaignGoals`, `removeAd`, `pausePmaxAssetGroup`, `enablePmaxAssetGroup` in the tool catalog
- **Two interaction modes** — SKILL.md now distinguishes direct actions (fast path, no session checks) from analysis requests (full checks and reporting)
- **Dev symlink detection** — `bin/toprank-update-check` and the upgrade skill now detect dev symlinks and skip update checks, preventing upgrade attempts on developer-managed installs

---

## [0.11.1] — 2026-04-11

### Changed
- **Ads audit restructured around 5 analysis layers and 3 actionable passes** — Replaced the 7-dimension scoring model (0-5 per dimension, 0-100 composite) with a layered analysis approach: Signals → Relevance → Efficiency → Scale → Growth. Findings now map to 3 action-oriented passes: Stop Wasting, Capture More, Fix Fundamentals. Tracks 3 objective pulse metrics (waste rate, demand captured, CPA) with trend comparison on re-audits
- **Added PMax campaign support** — Asset group completeness checks, PMax cannibalization detection for brand Search traffic, and PMax-specific bid strategy guidance
- **Added audience signals check** — Flags Search campaigns missing audience segments and PMax asset groups without audience signals, both of which limit Smart Bidding performance
- **Smarter waste calculation** — Keyword waste threshold changed from "clicks > 10" to "spend > 2x account average CPA", which respects Smart Bidding's learning curve. Added de-duplication rules to prevent double-counting between keyword and search term waste
- **On-demand reference loading** — Quality score, search term analysis, industry benchmarks, and campaign structure references now load only when relevant issues are detected, saving ~1,000 lines of context per audit
- **Extracted reference docs** — Persona discovery template and business context crawl procedure moved to dedicated reference files for reuse across skills

---

## [0.11.0] — 2026-04-09

### Added
- **Gemini cross-model review skill** — New `/toprank:gemini` skill that launches Google's Gemini CLI as an independent reviewer. Three modes: review (pass/fail gate), challenge (adversarial stress test), and consult (open Q&A). Unlike code-only review tools, handles Google Ads changes (campaign structure, bid strategies, keywords) and SEO metadata changes (title tags, meta descriptions, schema markup) alongside code diffs. Produces cross-model analysis when Claude has already reviewed the same changes, highlighting overlapping findings, unique catches, and disagreements.

---

## [0.10.0.1] — 2026-04-08

### Changed
- **Consolidated root files** — Merged `CONNECTORS.md` and `CONTRIBUTING.md` into `README.md` to reduce file count without losing content. Connectors section now lives under "## Connectors" and contributing guide under "## Contributing" in the main README.
- **Updated install test** — Test suite now checks for connector content in `README.md` instead of the removed `CONNECTORS.md` file.
- **Added `seo-page` to directory tree** in README to reflect the new single-page analysis skill.

### Removed
- **`CONNECTORS.md`** — Content moved to README.md.
- **`CONTRIBUTING.md`** — Content moved to README.md.
- **`requirements-test.lock`** — Stale lock file that didn't match `requirements-test.txt`.

---

## [0.10.0] — 2026-04-08

### Added
- **PageSpeed Insights API integration** — New `pagespeed.py` script calls the Google PageSpeed Insights API for multiple URLs with concurrent execution. Collects Lighthouse performance scores, Core Web Vitals (LCP, INP, CLS, FCP, TTFB), CrUX field data, optimization opportunities, and diagnostics. Supports both mobile and desktop strategies.
- **PageSpeed display script** — New `show_pagespeed.py` renders PageSpeed results in a terminal-friendly format with scores, metrics, opportunities, and diagnostics.
- **Phase 5.5 in SEO analysis** — PageSpeed analysis runs in parallel alongside URL Inspection and CMS detection during audits. Results feed into the report with a dedicated "PageSpeed & Core Web Vitals" section and are logged in the audit history for tracking performance over time.
- **Preflight PageSpeed checks** — `preflight.py` now auto-enables the PageSpeed Insights API and checks for a `PAGESPEED_API_KEY` in the environment or `~/.toprank/.env`.

---

## [0.9.9] — 2026-04-08

### Changed
- **API key check moved to shared preamble** — Moved the `ADSAGENT_API_KEY` verification from the `/ads` skill into the shared preamble so all google-ads skills (`/ads`, `/ads-audit`, `/ads-copy`) verify the key automatically. The key is saved to `~/.claude/settings.json` under `env` (not config files) since the MCP server reads it from the environment.
- **Preamble rewrite** — Clean step numbering (0–5), fixed MCP detection to always run (was skipped for returning users with saved accountId), eliminated duplicate `listConnectedAccounts` calls, explicit deep-merge instructions for settings.json to avoid clobbering existing env vars.
- **Removed `apiKey` from config schema** — Config files (`.adsagent.json`, `config.json`) now only store `accountId`. API key storage is exclusively in `~/.claude/settings.json`.

---

## [0.9.8.0] — 2026-04-08

### Added
- **API key verification gate** — The `/ads` skill now checks for `ADSAGENT_API_KEY` in `~/.claude/settings.json` before executing any other step. If the key is missing, it prompts the user to obtain one from [adsagent.org](https://adsagent.org), collects the key interactively, and saves it automatically.

---

## [0.9.7] — 2026-04-08

### Changed
- **Plugin-aware auto-upgrade** — Rewrote the upgrade system from the old `~/.claude/skills/` paths to the new `~/.claude/plugins/cache/` plugin model. The upgrade flow now updates the marketplace repo, copies to a versioned cache directory, and updates `installed_plugins.json` directly.
- **Preamble script discovery** — Both `bin/preamble.md` and `google-ads/shared/preamble.md` now find `toprank-update-check` via glob in the plugin cache instead of hardcoded skill paths.

### Removed
- **Legacy skill paths** — Dropped all references to `~/.claude/skills/toprank/`, `~/.claude/skills/stockholm/`, and the `./setup` script that no longer exists in the plugin model.

---

## [0.9.6] — 2026-04-08

### Added
- **Business relevance gate for keyword evaluation** — The `/ads` skill now classifies keywords into Tier 1 (Core), Tier 2 (Adjacent), and Tier 3 (Irrelevant) before applying performance heuristics. Core keywords that directly describe the business are never paused — they get a diagnostic workflow instead.
- **Statistical significance gate** — Conversion-based decisions now require expected conversions >= 3 before acting. Prevents false negatives from small sample sizes.
- **Core Keyword Diagnostic workflow** — 6-step diagnostic for underperforming Tier 1 keywords: statistical significance, sibling comparison, match type analysis, QS subcomponents, position/impression share, and optimization recommendations.

### Changed
- **Wasted spend calculation** excludes Tier 1 (Core) keywords. A core keyword with 0 conversions is an optimization opportunity, not waste.
- **Bid optimization and waste audit workflows** updated to classify keywords by business relevance before applying performance actions.

---

## [0.9.5] — 2026-04-07

### Changed
- **MCP server URL updated** — `adsagent` MCP now points to `https://adsagent.org/api/mcp` (removed `www.` prefix to match the canonical domain).

---

## [0.9.4] — 2026-04-07

### Changed
- **`seo-analysis` report restructured for clarity** — Phase 6 now leads with "Top Priority Actions" (3–5 items, ordered by expected click impact) instead of 12+ equal-weight sections. Each action requires a specific URL, specific metric as evidence, and a copy-paste-ready fix with estimated click impact. Supporting data (indexing issues, cannibalization, gaps, schema, technical) is condensed into reference tables shown only when findings exist.
- **`seo-analysis` audit history tracking** — new Step 0.5 reads `~/.toprank/audit-log/<domain>.json` at startup to surface previously flagged issues and their current resolution status. New Phase 6.5 writes a concise log entry after each audit (date, traffic snapshot, top issues with metrics and expected impact). Future audits show which prior issues are resolved, improved, or still open.

### Fixed
- **`seo-analysis` Phase 3.7** — removed duplicate `$DOMAIN` extraction; now reuses the variable set in Step 0.5 instead of re-deriving it.

---

## [0.9.3] — 2026-04-07

### Added
- **SEO business context** (`seo/shared/business-context.md`) — persistent per-domain business profile for SEO skills. Caches business name, summary, industry, primary goal, target audience, locations, brand terms, competitors, and key topics at `~/.toprank/business-context/<domain>.json`. Fresh for 90 days; auto-refreshes when stale.
- **`seo-analysis` Phase 3.8** — business context generation after GSC data is collected. First run asks 3 targeted questions and infers the rest from GSC + homepage. Subsequent runs are silent (cache load only).
- **`seo-analysis` Phase 2 fast-path** — brand terms are loaded from business context cache when available, skipping the manual question entirely.
- **Phase 6 report Business Profile section** — report now opens with a business context block (name, goal, audience, competitors) so all recommendations read as contextual rather than generic.

---

## [0.9.2] — 2026-04-06

### Changed
- **Config resolution** — replaced single global config (`~/.adsagent/config.json`) with 3-tier chain: project-level (`.adsagent.json`), Claude project-level (`~/.claude/projects/{path}/adsagent.json`), and global fallback. Fields merge up the chain so a project file with only `accountId` inherits `apiKey` from global.
- **Project-scoped data storage** — when a project-level config exists, data files (business-context, personas, change-log, account-baseline) are stored in `.adsagent/` relative to the project root instead of globally
- **Account switching** — now asks whether to save the selection for the current project or globally
- **Security** — preamble instructs LLM to add `.adsagent.json` and `.adsagent/` to `.gitignore` when using project-local storage

---

## [0.9.1] — 2026-04-04

### Added
- **Google Ads Setup section** in README — two-path install guide: Option A (free hosted server via adsagent.org) and Option B (self-hosted MCP server for users with their own Google Ads API access)
- Collapsible manual MCP config block for users who skip the setup script

### Changed
- **`/ads` skill** — MCP is now the only tool-calling method. Removed mcporter CLI fallback and `mcporter.json` config file. The "Calling tools" section now documents the `mcp__adsagent__<toolName>` pattern directly.
- **`setup`** — MCP server config is built inline instead of reading from `mcporter.json`. Ads skill detection uses directory prefix instead of file existence check. Fixed Windows path compatibility for ads skill detection.
- **README hook questions** — rewritten to target real pain points: wasted ad spend, traffic drops, and conversion growth without budget increases

### Removed
- **`google-ads/ads/mcporter.json`** — no longer needed; MCP server config is generated directly by the setup script.
- **`_replace_key()` helper** in setup — was only used for mcporter placeholder substitution.

---

## [0.8.0] — 2026-03-31

### Added
- **`/setup-cms` skill** — interactive wizard to connect WordPress, Strapi, Contentful, or Ghost. Detects existing config, collects credentials, tests the connection, and writes to `.env.local`.
- **WordPress CMS integration** (Phase 3.6) — `preflight_wordpress.py` + `fetch_wordpress_content.py`. REST API with Application Password auth. Extracts SEO fields from Yoast SEO (`yoast_head_json`) or RankMath (`meta.rank_math_title`).
- **Contentful CMS integration** (Phase 3.6) — `preflight_contentful.py` + `fetch_contentful_content.py`. Delivery API with Bearer token auth. Resolves linked SEO component entries (`include=1`), supports pagination up to 1000 entries/page.
- **Ghost CMS integration** (Phase 3.6) — `preflight_ghost.py` + `fetch_ghost_content.py`. Content API with auto-detection between v4+ (`/ghost/api/content/`) and v3 (`/ghost/api/v3/content/`). Uses native `meta_title`/`meta_description` fields.
- **`cms_detect.py`** — lightweight CMS routing script. Checks env vars in priority order (WP_URL → Contentful → Ghost → Strapi), exits 0 with CMS name if found, exits 2 if none configured.
- **56 unit tests** (`test/unit/test_cms_scripts.py`) covering SEO field extraction, entry normalisation, SEO audit aggregation, SSRF protection, and WordPress auth header encoding across all 4 CMSes.

### Changed
- **`seo-analysis` Phase 3.6** — rewritten from Strapi-specific to CMS-agnostic. Now routes through `cms_detect.py` and runs the appropriate preflight + fetch script via `case` statement. All CMSes produce the same normalized JSON format.
- Report template: "Strapi SEO Field Audit" → "CMS SEO Field Audit" (supports WordPress, Strapi, Contentful, Ghost).

### Fixed
- **Ghost/WordPress/Contentful false negatives** — SEO extraction no longer falls back to the content title when no explicit meta title is set. Entries with no SEO plugin / no meta title override are now correctly flagged as `missing_meta_title=True`.
- **Ghost `detect_api_path` sys.exit trap** — replaced `ghost_get()` probe (which calls `sys.exit(1)` on errors) with inline `urllib` probe, allowing the v3 API path fallback to actually run.
- **Ghost `PAGE_SIZE`** — changed from 15 (display default) to 100 (actual API max).

---

## [0.7.1] — 2026-04-01

### Fixed
- **`seo-analysis` — GSC display crash** — added `show_gsc.py` display utility to replace fragile inline Python scripts. Fixes `TypeError: string indices must be integers, not 'str'` that occurred when iterating `comparison` dict fields (which mixes string metadata and list data at the same level). Also fixes CTR being displayed as 474% instead of 4.74% (was being multiplied by 100 twice).

---

## [0.7.0] — 2026-04-01

### Added
- **`seo-analysis` — URL-first flow** — Step 0 now asks for the target website URL before running any preflight or API calls. The URL is stored and used throughout the entire audit for URL Inspection, technical crawl, and metadata fetching.
- **`seo-analysis` — URL Inspection API** (Phase 3.5) — new `url_inspection.py` script calls `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect` for the top pages. Returns per-page indexing status (`INDEXED`, `NOT_INDEXED`, `DUPLICATE_WITHOUT_CANONICAL`, etc.), mobile usability verdict, rich result status, last crawl time, and referring sitemaps. Results surface immediately as critical flags in the report.
- **`seo-analysis` — Keyword Gap Analysis** (Phase 4.5) — finds keyword orphans (queries ranking 4-20 with no dedicated page), builds topic clusters from GSC data with pillar page recommendations, and identifies business-relevant keywords the site should rank for but has no impressions for.
- **`seo-analysis` — Deep Metadata Audit** — for each audited page, fetches the live `<title>` and `<meta description>`, cross-references against top GSC queries for title/query alignment, checks character counts, detects duplicate titles, and audits Open Graph tags. Outputs a structured per-page table.
- **`seo-analysis` — Deep Schema Markup Audit** — detects site type (E-commerce, SaaS, Local Business, etc.), defines expected schema types per site type, audits each page's `<script type="application/ld+json">` blocks, and flags missing high-impact schema and errors in existing schema. Cross-references with URL Inspection rich result findings.
- **`seo-analysis` — Skill Handoffs** (Phase 7) — after delivering the report, surfaces targeted follow-up actions: `/meta-tags-optimizer` for pages with metadata issues, `/schema-markup-generator` for schema gaps, `/keyword-research` with seed terms from the gap analysis.
- **Branded vs non-branded segmentation** (`branded_split`) — pass `--brand-terms "Acme,AcmeCorp"` to split all GSC traffic into branded and non-branded segments. Each segment gets its own clicks, impressions, CTR, average position, query count, and top-20 queries. Non-branded metrics become the true baseline for Quick Wins and content recommendations. Returns `null` if no brand terms provided.
- **Page group clustering** (`page_groups`) — automatically buckets top pages by URL path pattern (/blog/, /products/, /locations/, /services/, /pricing/, /docs/, /about/, /faq/, /lp/, /case-studies/) with per-section aggregate stats. Exposes template-level problems: "all /products/ pages have 0.8% CTR" can be fixed once, not 50 times.
- **Winner/loser scoring for cannibalization** — each `cannibalization` entry now includes `winner_page`, `winner_reason`, `loser_pages`, and `recommended_action` ("consolidate: 301 redirect..." or "monitor: possible SERP domination").
- **`test/unit/test_url_inspection.py`** — 25 unit tests covering `normalize_site_url_for_inspection`, `parse_inspection_result`, and `summarize_findings`.
- **35 new unit tests** covering `classify_branded`, `derive_branded_split`, `cluster_page_groups`, and all new cannibalization fields.
- **Strapi CMS integration** (Phase 3.6) — the `/seo-analysis` skill now cross-references your published Strapi content against GSC data. Three new scripts:
  - **`preflight_strapi.py`** — validates config, tests connectivity, detects Strapi v4 vs v5. Exit code 2 = not configured (non-fatal skip).
  - **`fetch_strapi_content.py`** — paginates all published entries, extracts SEO fields from the official `strapi-community/plugin-seo` component and root-level fallbacks, writes a structured JSON audit.
  - **`push_strapi_seo.py`** — batch write-back with before/after diff preview, stale-write guard, and locale support for v5 localized content.
- **59 new unit tests** for the Strapi scripts — version detection, entry normalisation, SEO audit counting, payload building, stale-write guard logic, and SSRF IP classification.

### Changed
- **`seo-analysis` — `analyze_gsc.py` parallelized** — all 9 GSC API calls now run concurrently via `ThreadPoolExecutor`, cutting wall-clock data collection time by ~70%. Each worker has an exception guard so a single failed call logs an error and continues rather than crashing the script.
- **`url_inspection.py` — parallel URL inspection** — inspections run with `--concurrency 3` (default). `--max-urls` default reduced from 20 to 5 to stay well within the 2000/day API quota. Worker failures are caught and logged without aborting the run.
- **`seo-analysis` — technical crawl capped at 5 pages** — Phase 5 now has a hard cap of 5 pages (homepage first, then top by clicks, then flagged pages) to keep the audit fast without losing insight.
- **`seo-analysis` — broader OAuth scope** — re-auth instructions throughout the skill now include both `webmasters` and `webmasters.readonly` scopes, required for the URL Inspection API.
- **`seo-analysis`** Phase 2 now asks for brand terms before pulling data.
- **`seo-analysis`** Phase 4 adds "Branded vs Non-Branded Split" and "Page Group Performance" sections.
- **`seo-analysis/evals/evals.json`** — 3-scenario test suite covering URL-first behavior, no-GSC technical fallback, and comprehensive GSC+inspection audit.
- Cannibalization `competing_pages` now sorted by position ascending (best first) instead of clicks descending.
- Strapi integration is **opt-in and non-blocking** — if `STRAPI_URL` is not configured, Phase 3.6 skips silently.

---

## [0.6.1] — 2026-03-31

### Added
- **`test/install.test.sh`** — mock-HOME install test suite for `./setup`. 61 assertions across 6 scenarios: Claude Code global install (symlinks, targets, preamble injection), auto-detect via path, idempotency, real-directory protection, Codex install (openai.yaml + SKILL.md symlinks), and invalid `--host` flag handling. Includes a count-guard that fails fast if a new skill is added to the repo without updating the test's SKILLS array.

### Changed
- **`seo-analysis`** — deeper Google Search Console data in every audit. The script now pulls four additional data sets from a single API session:
  - **Cannibalization** (`cannibalization`) — queries where multiple pages compete, with per-page click/impression breakdown. Previously the skill inferred this from single-dimension data; now it uses the real `[query, page]` dimension so every recommendation names specific URLs.
  - **CTR gaps by page** (`ctr_gaps_by_page`) — high-impression, low-CTR pairs at the query+page level. Replaces query-only CTR opportunities so every title/meta rewrite suggestion includes the exact page to fix.
  - **Country split** (`country_split`) — top 20 countries by clicks with CTR and position. Surfaces geo opportunities and region-specific ranking problems.
  - **Search type breakdown** (`search_type_split`) — web, image, video, news, Discover, and Google News traffic shown separately. Many sites have Discover or image traffic they don't know about.
- `device_split` now includes CTR and position alongside clicks and impressions.
- Phase 4 analysis guidance updated to use the new data fields directly.
- New "Segment Analysis" subsection added to Phase 4 for device, country, and search type interpretation.
- Unit tests: 49 → 79 (+30 tests covering all new functions with boundary and edge case coverage).

---

## [0.6.0] — 2026-03-30

### Added
- **`keyword-research`** — new skill for keyword discovery, intent classification, difficulty assessment, opportunity scoring, and topic clustering. Includes reference materials for intent taxonomy, prioritization framework, cluster templates, and example reports.
- **`meta-tags-optimizer`** — new skill for creating and optimizing title tags, meta descriptions, Open Graph, and Twitter Card tags with A/B test variations and CTR analysis. Includes reference materials for tag formulas, CTR benchmarks, and code templates.
- **`schema-markup-generator`** — new skill for generating JSON-LD structured data (FAQ, HowTo, Article, Product, LocalBusiness, etc.) with validation guidance and rich result eligibility checks. Includes reference materials for schema templates, decision tree, and validation guide.
- **`geo-content-optimizer`** — new skill for optimizing content to appear in AI-generated responses (ChatGPT, Perplexity, Google AI Overviews, Claude). Scores GEO readiness and applies citation, authority, and structure optimization techniques. Includes reference materials for AI citation patterns, GEO techniques, and quotable content examples.

### Changed
- **README.md** — updated with documentation for all 4 new skills, expanded install instructions and directory tree

---

## [0.5.1] — 2026-03-27

### Security
- **Predictable /tmp paths** — `analyze_gsc.py` and `list_gsc_sites.py` now use `gsc_analysis_{uid}.json` / `gsc_sites_{uid}.json` via `tempfile.gettempdir()` + `os.getuid()`, preventing cross-user data exposure on multi-user systems
- **`.gstack/` gitignored** — local security audit reports excluded from git history
- **Test dependency lockfile** — added `requirements-test.lock` (pip-compiled) to pin test dependencies and prevent supply-chain drift

---

## [0.5.0] — 2026-03-27

### Added
- **`preflight.py`** — pre-flight check that runs before any GSC operations; detects gcloud with OS-specific install instructions (Homebrew / apt / dnf / curl / winget), auto-triggers `gcloud auth` browser flow if no ADC credentials found
- **`setup.py`** — cross-platform Python equivalent of `./setup` for Windows users who can't run bash; falls back to directory junctions (no admin rights required) when symlinks are unavailable
- **Phase 0 in SKILL.md** — preflight step added before GSC access check; also restores the "skip GSC → Phase 5" escape hatch for technical-only audits

### Changed
- **`seo-analysis/SKILL.md`** — Phase 1 simplified (error cases now handled by preflight); Phase 1 bash block is self-contained (no shell variable leak from Phase 0)

---

## [0.4.2] — 2026-03-27

### Added
- **README demo section** — "See It Work" example conversation showing end-to-end `/seo-analysis` flow for clearer onboarding

### Changed
- **Auto-upgrade on every skill use** — removed the 4-option prompt (Yes / Always / Not now / Never); updates now apply automatically whenever `UPGRADE_AVAILABLE` is detected
- **Update check frequency** — reduced UP_TO_DATE cache TTL from 60 min to 5 min so checks run on nearly every skill invocation
- **Zero-dependency GSC auth** — removed `google-auth` Python package requirement; reverts 0.4.1 approach; scripts now call `gcloud auth application-default print-access-token` directly via subprocess and use stdlib `urllib` for HTTP, eliminating the `pip install` setup step
- **`gsc_auth.py` removed** — auth logic inlined in `list_gsc_sites.py` and `analyze_gsc.py`; simpler, no shared module
- **SKILL.md Phase 1** — GSC setup instructions updated to reflect the simpler auth flow

### Security
- **Predictable /tmp paths** — GSC output files now use `gsc_analysis_{uid}.json` and `gsc_sites_{uid}.json` instead of shared paths, preventing cross-user data exposure on multi-user systems
- **`.gstack/` gitignored** — security audit reports are now excluded from git commits
- **Test dependency lockfile** — added `requirements-test.lock` (pip-compiled) to pin exact versions and prevent supply-chain drift

---

## [0.4.1] — 2026-03-27

### Fixed
- **GSC quota project header** — replaced raw `urllib` HTTP calls with `google-auth` library (`AuthorizedSession`), which automatically sends the `x-goog-user-project` header required for ADC user credentials; this was the root cause of 403 errors during onboarding
- **Auto-detect quota project** — scripts now read `quota_project_id` from ADC credentials and fall back to `gcloud config get-value project` if missing, eliminating the manual `set-quota-project` step

### Changed
- **Shared auth module** — extracted `gsc_auth.py` with `get_credentials()`, `get_session()`, and `_ensure_quota_project()` to eliminate duplicated auth logic between `list_gsc_sites.py` and `analyze_gsc.py`
- **SKILL.md Phase 1** — streamlined GSC setup instructions from ~50 lines to ~25 lines for faster onboarding and lower token usage
- **gsc_setup.md** — updated setup guide to reflect 2-step process (`pip install google-auth` + `gcloud auth application-default login`) and documented new troubleshooting entries

### Added
- **`google-auth` dependency** — new pip requirement for proper Google API authentication
- **4 new unit tests** for `_ensure_quota_project()` covering: already-set, auto-detect from gcloud, gcloud not found, gcloud returns empty

---

## [0.4.0] — 2026-03-27

### Added
- **`content-writer` skill** — standalone SEO content creation, directly invocable without running a full SEO audit
  - Handles three jobs: new blog posts, new landing pages, and improving existing pages
  - 6-step workflow: determine job → gather context → read guidelines → research & plan → write → quality gate
  - Follows Google's E-E-A-T and Helpful Content guidelines via shared reference doc
  - Outputs publication-ready content with SEO metadata, JSON-LD structured data, internal linking plan, and publishing checklist
  - Smart content type detection from user intent (informational → blog, transactional → landing page)
- **`content-writing.md` reference doc** — single source of truth for Google content best practices (E-E-A-T framework, helpful content signals, blog/landing page templates, search intent matching, on-page SEO checklist, anti-patterns including AI content pitfalls)
- **`seo-analysis` Phase 7** — optional content generation after audit; spawns up to 5 content agents in parallel when content gaps are identified, each reading the shared `content-writing.md` guidelines

### Changed
- **CONTRIBUTING.md** — expanded with detailed SKILL.md structure, script requirements, reference file guidelines, and skill ideas table
- **README.md** — added `content-writer` to skills table and updated project description

---

## [0.3.0] — 2026-03-27

### Added
- **Python test suite** — full pytest infrastructure under `test/` replacing the prior TypeScript/Bun approach; no build step required
  - `test/unit/` — 42 fast unit tests (stdlib only, no API calls); covers date math, GSC data processing, report structure, and skill SKILL.md content validation
  - `test/test_skill_e2e.py` — E2E skill tests gated behind `EVALS=1`; uses mock `gcloud` + mock `analyze_gsc.py` fixture to run the full skill workflow without real credentials
  - `test/test_skill_llm_eval.py` — LLM-as-judge quality evals gated behind `EVALS=1`; scores report clarity, actionability, and phase coverage on a 1–5 scale
  - `test/test_skill_routing_e2e.py` — routing evals verify the skill triggers on SEO prompts and stays silent on unrelated requests
  - `test/helpers/` — session runner (spawns `claude -p --output-format stream-json`), LLM judge, eval store, and diff-based test selection
  - `test/fixtures/` — mock gcloud binary, mock analyze_gsc.py, and sample GSC JSON fixture data
  - `conftest.py` — root-level pytest config for import path setup
  - `requirements-test.txt` — minimal test dependencies

### Fixed
- **Routing tests** — added harness failure guard; `should-not-trigger` tests no longer silently pass when the subprocess times out or crashes
- **Env isolation** — test subprocess now strips `ANTHROPIC_*` vars (in addition to `CLAUDE_*`) to prevent `ANTHROPIC_BASE_URL` or `ANTHROPIC_MODEL` from redirecting evals to an unintended endpoint
- **LLM judge retry** — exponential backoff (3 attempts: 1s, 2s, 4s) replaces single-retry on rate limit
- **Mock gcloud** — removed fall-through to real `gcloud` binary that caused infinite recursion when mock was first in PATH
- **`.gitignore`** — restored credential patterns (`credentials.json`, `token.json`, `.env`, etc.) accidentally dropped in initial commit

---

## [0.2.3] — 2026-03-27

### Changed
- Simplified CONTRIBUTING.md — removed skill ideas table and verbose guidelines, kept essentials for getting started

---

## [0.2.2] — 2026-03-27

### Changed
- Rewrote README intro for clarity and power — headline now communicates that Toprank analyzes, recommends, and fixes SEO issues directly in your repo

---

## [0.2.0] — 2026-03-27

### Added
- **Autoupdate system** — skills now check GitHub for new versions on every invocation
  - `bin/toprank-update-check` — fetches `VERSION` from GitHub with 60-min cache; outputs `UPGRADE_AVAILABLE <old> <new>` or nothing
  - `bin/toprank-config` — read/write `~/.toprank/config.yaml`; supports `update_check`, `auto_upgrade` keys
  - `toprank-upgrade/SKILL.md` — upgrade skill with inline and standalone flows, snooze (24h/48h/7d backoff), auto-upgrade mode, changelog diff
  - Preamble in `seo-analysis` and auto-inject via `setup` for all future skills
  - `bin/preamble.md` — single source of truth for the preamble template
- `VERSION` file — tracks current release for update checks

### Fixed
- `toprank-update-check`: validate local VERSION format before writing cache; exit after `JUST_UPGRADED` to prevent dual stdout output; move `mkdir -p` to top of script
- `setup`: atomic SKILL.md writes via temp file + `os.replace()`; add `pipefail` to catch silent Python errors
- `toprank-upgrade`: clear stale `.bak` before vendored upgrade to prevent collision

---

## [0.2.1] — 2026-03-27

### Changed
- **`seo-analysis` Phase 1** — replaced two-step auth check (token print + separate site list) with single `list_gsc_sites.py` call that tests auth, scopes, and GSC access in one shot; added distinct handling for each failure mode (wrong account, wrong scopes, API not enabled, gcloud not installed)
- **`seo-analysis` script paths** — replaced hardcoded `~/.claude/skills/seo-analysis/scripts/` with a `find`-based `SKILL_SCRIPTS` lookup that works for Claude Code, Codex, and custom install paths; added guard for empty result so missing installs fail with a clear error instead of a confusing path error
- **`seo-analysis` property selection** — added explicit rule to prefer domain property (`sc-domain:example.com`) over URL-prefix when both exist for the same site
- **`gsc_setup.md`** — moved "Which Google Account" guidance to top (most common failure cause); replaced broken `oauth_setup.py` Option B with Linux (Debian/Ubuntu, RPM) and Windows install instructions; fixed deprecated `apt-key` with `gpg --dearmor` for Debian 12+/Ubuntu 24.04+; expanded troubleshooting to cover `insufficient_scope` 403s

### Fixed
- **`list_gsc_sites.py`** — unhandled `FileNotFoundError` when gcloud is not installed now shows a clean error message; added `URLError` handling for network failures (DNS, TLS, proxy)
- **`analyze_gsc.py`** — same `FileNotFoundError` and `URLError` fixes
- **`gsc_setup.md`** — removed reference to `oauth_setup.py` which did not exist
- **`seo-analysis` SKILL.md** — corrected error-branch description from "Python traceback" to "ERROR: gcloud not found" to match the actual script output

---

## [0.1.1] — 2026-03-27

### Changed
- **README intro** — rewritten to lead with user outcome ("Finally know what to do about your SEO") and emphasize zero-risk install; blockquote examples now show real questions users would type

---

## [0.1.0] — 2026-03-26

### Added
- **`seo-analysis` skill** — comprehensive SEO audit powered by Google Search Console
  - Phase 1: GSC API setup detection and guided auth via `gcloud` Application Default Credentials
  - Phase 2: Auto-detect site URL from website repo (`package.json`, `next.config.js`, `astro.config.*`, etc.) or prompt for URL
  - Phase 3: Data collection — top queries, top pages, position buckets (1–3, 4–10, 11–20, 21+), CTR opportunities, 28-day period comparison, device split
  - Phase 4a: Search Console analysis — quick wins, content gaps, traffic drops
  - Phase 4b: Technical SEO audit — indexability, meta tags, heading structure, structured data, performance signals
  - Phase 5: Structured report with executive summary, traffic snapshot, and 30-day action plan
- `scripts/list_gsc_sites.py` — list all GSC properties for the authenticated account
- `scripts/analyze_gsc.py` — pull and process GSC data, output structured JSON
- `references/gsc_setup.md` — complete setup guide for gcloud ADC and OAuth fallback
