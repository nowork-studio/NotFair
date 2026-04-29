---
name: ads-audit
description: Google Ads account audit and business context setup. Run this first — it gathers business information, analyzes account health, and saves context that all other ads skills reuse. Trigger on "audit my ads", "ads audit", "set up my ads", "onboard", "account overview", "how's my account", "ads health check", "what should I fix in my ads", or when the user is new to NotFair and hasn't run an audit before. Also trigger proactively when other ads skills detect that business-context.json is missing.
argument-hint: "<account name or 'audit my ads'>"
---

# Google Ads Audit

Diagnose account health and persist business context for downstream skills (`/ads`, `/ads-copy`, `/ads-landing`). **Read-only** — never mutates the account. The user runs `/ads` to execute fixes you recommend.

## Setup

Follow `../shared/preamble.md` — MCP detection, API key, account selection.

## Filesystem contract (MUST persist)

| Artifact | Path | When |
|---|---|---|
| Business context | `{data_dir}/business-context.json` | First full audit, or refresh when `audit_date` is >90 days old. Skip on scoped audits if file is fresh. |
| Personas | `{data_dir}/personas/{accountId}.json` | Every full audit. |

These are the handoff to every other ads skill — write them even if the report itself is short. Otherwise `/ads-copy` and `/ads-landing` operate without business context and produce generic output.

**business-context.json schema:** `business_name, industry, website, services[], locations[], target_audience, brand_voice{tone, words_to_use[], words_to_avoid[]}, differentiators[], competitors[], seasonality{peak_months[], slow_months[], seasonal_hooks[]}, keyword_landscape{high_intent_terms[], competitive_terms[], long_tail_opportunities[]}, social_proof[], offers_or_promotions[], landing_pages{}, notes, audit_date, account_id`.

**personas JSON schema:** `{account_id, saved_at, personas: [{name, demographics, primary_goal, pain_points[], search_terms[], decision_trigger, value}]}`. See `references/persona-discovery.md`.

## Policy freshness check (run first)

Read `../shared/policy-registry.json`. For each entry where `last_verified + stale_after_days < today`:
- **High-volatility** → WebSearch the `area` for recent Google Ads changes; compare to `assumption`. If drift, banner the report and suggest registry update.
- **Moderate-volatility** → one-line "may warrant a check" note.
- **Stable** → skip silently.

## Phase 1 — Pull the audit dataset

Use a single `runScript` call with `ads.gaqlParallel` to fan out the queries an audit needs. The server's `adsagent://playbooks/audit-account` resource has a battle-tested baseline; extend it with what this rubric needs that isn't already there.

A complete audit needs at minimum:

- **Account / customer-level metrics** (`customer` resource) — totalSpend, conversions, conv-value, clicks, impressions for the audit window.
- **Campaign-level performance** (`campaign`) — id, name, status, advertising_channel_type, bidding_strategy_type, network settings, search/top/abs-top impression share, budget-lost-IS, rank-lost-IS, status-rich metrics. Cap window at 90 days (impression-share data limit).
- **Ad-group performance** (`ad_group`) — to attach top-line metrics under each campaign.
- **Keyword performance with QS** (`keyword_view`) — text, match type, status, quality score (and components if needed), cost, clicks, conversions. Surfaces zombie keywords (0 impressions 30d), low-QS-with-spend, zero-converters.
- **Search terms** (`search_term_view`) — for waste detection (clicks > 10, conv = 0) and brand-leakage detection (brand terms triggered by non-brand campaigns).
- **Negative keywords** (`campaign_criterion` where `type='KEYWORD'` and `negative=TRUE`) — for negative-conflict detection and coverage.
- **Conversion actions** (`conversion_action`) — count, status, primary-vs-secondary, counting type. STOP-condition input.
- **Ad assets** (`ad_group_ad`) — RSA headlines/descriptions for asset-coverage scoring and topAds extraction.
- **Geo targeting** (`campaign_criterion` where `type IN ('LOCATION','PROXIMITY')`) — for multi-location structure scoring. `radius_units`: 0=meters, 1=km, 2=miles.
- **Recent change events** (`change_event`, max 30 days) — to flag recent edits that might explain regressions.

Compute aggregates **in the script**, return summarized JSON. Don't return all rows — rank, slice, summarize. The agent narrates the result, the script does the math.

`getRecommendations` is a useful cross-check for Google's own recommendation surface — call it as a separate tool after the runScript pass if you want to compare your findings to Google's.

If a critical query errors out (auth, schema), surface the error and stop — don't fall back to a degraded audit.

**Skip scoring entirely if** `totalSpend == 0` or `activeCampaigns == 0`. Go straight to business context.

## Phase 2 — Scope handling

If the user narrows the audit ("focus on grooming", "campaign X", "just check waste"):

- Match campaign names by case-insensitive substring. If no match, list available campaigns and ask.
- Filter the in-memory dataset before scoring — no extra API calls.
- Account-level dimensions (conversion tracking) stay account-wide. Note "Scoped to: X" in the report.
- Skip Phase 4 (business context refresh) on scoped audits if `business-context.json` is fresh.

## Phase 3 — Score

Score each of the 7 dimensions 0–5 using `references/account-health-scoring.md`. Overall = `round(sum × 100 / 35)`.

| Score | Label | Meaning |
|---|---|---|
| 0 | Critical | Broken or missing — actively losing money |
| 1 | Poor | Major waste or missed opportunity |
| 2 | Needs Work | Several clear issues |
| 3 | Acceptable | Functional, room to improve |
| 4 | Good | Well-managed, minor opportunities |
| 5 | Excellent | Best-practice |

Scope-aware: campaign-level dimensions reflect in-scope data; account-level dimensions (conversion tracking) score account-wide with a note on scope impact.

### Encoded heuristics — apply these, they aren't obvious

- **Weighted QS by spend, not by keyword count.** A QS-3 keyword burning $2,000/mo matters infinitely more than ten QS-3 keywords burning $5/mo combined.
- **Brand-leakage premium.** When brand campaigns are paused or starved, brand traffic leaks to non-brand at 5–10× higher CPA. Always check whether brand terms appear in non-brand campaigns' search-term reports.
- **Waste formula.** Keyword waste = clicks > 10 AND conversions = 0 AND cost > 0. Search-term waste = same, applied to actual queries. Sum them — that's the recoverable spend.
- **Display + Search mixed in one campaign** is structurally broken — Display dilutes Search metrics and burns budget on unintended placements. Flag any campaign where `network_settings.target_content_network = TRUE` for a SEARCH channel campaign.
- **Zombie keywords** (0 impressions for 30+ days) clutter reporting and confuse Google's ML — recommend pause.
- **Counting type matters.** Lead-gen should use `ONE` per click; e-commerce should use `EVERY`. Wrong setting silently inflates or deflates conversions.
- **STOP condition.** If conversion tracking scores 0–1, recommend pausing spend until tracking is fixed. Everything downstream of measurement is unreliable.

### Impression Share Interpretation Matrix

| | Rank-Lost < 30% | Rank-Lost 30–50% | Rank-Lost > 50% |
|---|---|---|---|
| **Budget-Lost < 20%** | Healthy | QS / bid problem | Quality crisis |
| **Budget-Lost 20–40%** | Budget problem | Mixed (fix quality first) | Structural — too-competitive keywords |
| **Budget-Lost > 40%** | Severe budget gap (highest-ROI fix if CPA is good) | Fix rank first, then add budget | Fundamental misalignment — pause and restructure |

## Phase 4 — Business context

Derive what you can from the data already pulled:

| Field | Source |
|---|---|
| `business_name` | Account name (from `customer.descriptive_name`) |
| `services` | Campaign + ad-group names, top converting keywords |
| `locations` | `campaign_criterion` LOCATION + PROXIMITY |
| `brand_voice` | Top-performing RSA headlines / descriptions |
| `keyword_landscape.high_intent_terms` | Converting keywords with strong CVR |
| `keyword_landscape.competitive_terms` | Keywords in campaigns with high rank-lost-IS |
| `keyword_landscape.long_tail_opportunities` | Converting search terms not yet promoted to keywords |
| `website` | Apex domain from ad final URLs |

Then crawl the website (homepage + about + services + top 3 ad landing pages, parallel `WebFetch`) and merge into the schema. See `references/business-context.md` for the full crawl procedure.

Always ask the user (it's faster than guessing): differentiators, competitors, seasonality. Ask for everything else only if the data + crawl can't answer it.

## Phase 5 — Personas

Discover 2–3 personas from search terms, top keywords, ad-group themes, landing pages, geo, and device split — all from the dataset already in memory. Persist to `{data_dir}/personas/{accountId}.json`. Each persona must be grounded in **5+ actual search terms**; if not, drop it. See `references/persona-discovery.md`.

## Phase 6 — Report

Lead with the verdict, then the top 3 actions (with dollar impact when possible), then the scorecard, then evidence for dimensions scoring 0–2 only. Cite specific campaigns, keywords, and dollar amounts. Cap at ~80 lines.

End with a single closing line after the handoff to `/ads`:

> *Your audit history is saved to your NotFair account — view it at https://notfair.co.*

## Guardrails

1. **Read-only skill.** Diagnose; don't mutate. Every fix routes through `/ads` (or `/ads-copy`, `/ads-landing`). End the report with one handoff tied to the #1 action.
2. **STOP condition** — if conversion tracking scores 0–1, recommend pausing spend until it's fixed before recommending anything else. Everything downstream is meaningless without measurement.
3. **Always persist** `business-context.json` and `personas/{accountId}.json` even if the report itself is short — downstream skills depend on them.
4. **Name names.** Every finding cites specific campaigns, keywords, search terms, and dollar amounts. "Some keywords are underperforming" is not a finding.
