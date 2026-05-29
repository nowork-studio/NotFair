---
name: google-ads-audit
description: Google Ads account audit and business context setup. Run this first — it gathers business information, analyzes account health, and saves context that all other ads skills reuse. Trigger on "audit my ads", "ads audit", "set up my ads", "onboard", "account overview", "how's my account", "ads health check", "what should I fix in my ads", or when the user is new to NotFair and hasn't run an audit before. Also trigger proactively when other ads skills detect that business-context.json is missing.
argument-hint: "<account name or 'audit my ads'>"
---

# Google Ads Audit

Diagnose account health and persist business context for downstream skills (`/google-ads`, `/google-ads-copy`, `/google-ads-landing`). **Read-only** — never mutates the account. The user runs `/google-ads` to execute fixes you recommend.

## Setup

Follow `../shared/preamble.md` (MCP detection, account selection) and `../shared/analysis-principles.md` (evidence requirement, guardrails). Both apply throughout this skill.

## Filesystem contract (must persist)

| Artifact | Path | When |
|---|---|---|
| Business context | `{data_dir}/business-context.json` | First full audit, or refresh when `audit_date` is >90 days old. Skip on scoped audits if file is fresh. |
| Personas | `{data_dir}/personas/{accountId}.json` | Every full audit. |

These are the handoff to every other ads skill — write them even if the report is short. Otherwise `/google-ads-copy` and `/google-ads-landing` operate without business context and produce generic output.

**business-context.json schema:** `business_name, industry, website, services[], locations[], target_audience, brand_voice{tone, words_to_use[], words_to_avoid[]}, differentiators[], competitors[], seasonality{peak_months[], slow_months[], seasonal_hooks[]}, keyword_landscape{high_intent_terms[], competitive_terms[], long_tail_opportunities[]}, social_proof[], offers_or_promotions[], landing_pages{}, unit_economics{aov_usd, profit_margin, source}, notes, audit_date, account_id`.

**personas JSON schema:** `{account_id, saved_at, personas: [{name, demographics, primary_goal, pain_points[], search_terms[], decision_trigger, value}]}`. See `references/persona-discovery.md`.

## Policy freshness check (run first)

Read `../shared/policy-registry.json`. For each entry where `last_verified + stale_after_days < today`:
- **High-volatility** → WebSearch the `area` for recent Google Ads changes; compare to `assumption`. If drift, banner the report and suggest registry update.
- **Moderate-volatility** → one-line "may warrant a check" note.
- **Stable** → skip silently.

## Phase 1 — Pull the audit dataset

Use a single `runScript` call with `ads.gaqlParallel` to fan out the queries an audit needs. The server's `notfair://playbooks/audit-account` resource has a battle-tested baseline; extend it with what your specific question needs.

You decide the exact GAQL shape, but a defensible audit needs to see, at minimum:

- Account-level rollups (`customer`)
- Campaign performance with bidding strategy, network, and impression-share metrics (`campaign`, 90-day cap for impression-share data)
- Ad-group performance (`ad_group`)
- Keyword performance with Quality Score and components (`keyword_view`)
- Search terms (`search_term_view`)
- Negative keywords and shared lists (`campaign_criterion` + shared sets)
- Conversion actions (`conversion_action`) — including counting type, attribution model, primary/secondary
- Network segmentation (`segments.ad_network_type`) when diagnosing CPA/CVR shifts or Search Partners
- RSA assets (`ad_group_ad`)
- Geo targeting (`campaign_criterion` LOCATION + PROXIMITY)
- Recent change events (`change_event`, last 30 days) — for explaining regressions

Aggregate inside the script. Return summarized JSON, not raw rows. The agent narrates; the script does the math.

`getRecommendations` and `summarizeAccountSetup` are useful cross-checks against Google's own and the server's structural views — call them as a separate tool turn after the runScript pass when comparison would sharpen the report.

If a critical query errors out (auth, schema), surface the error and stop — don't fall back to a degraded audit.

**Skip scoring entirely if** `totalSpend == 0` or `activeCampaigns == 0`. Go straight to business context.

## Phase 2 — Scope handling

If the user narrows the audit ("focus on one campaign", "campaign X", "just check waste"):

- Match campaign names by case-insensitive substring. If no match, list available campaigns and ask.
- Filter the in-memory dataset before analysis — no extra API calls.
- Account-level dimensions (conversion tracking, account guardrails) stay account-wide. Note "Scoped to: X" in the report.
- Skip Phase 4 (business context refresh) on scoped audits if `business-context.json` is fresh.

## Phase 3 — Diagnose

The audit's headline output is **three pulse metrics** — Waste ($/mo), Demand captured (%), CPA ($) — each annotated with its top contributor and a pointer to the fix. Read `references/account-health-scoring.md` for the formula, annotation rules, signal-failure overrides, and `audit-history.json` schema. The pulse metric IS the verdict; you don't add a letter grade or 0–5 score on top.

To compute and back the pulse metrics, you'll need to look across these seven areas. They are diagnostic surface area, not graded dimensions:

1. **Signal Quality** *(account-level)* — measurement integrity. If broken, **STOP** here and recommend pausing spend until it's fixed. Pulse metrics are meaningless without measurement (apply the signal-failure override on the Waste line per the reference).
2. **Campaign Structure** — keywords per ad group, brand vs. non-brand separation, channel mixing, naming, budget logic.
3. **Keyword Health** — Quality Score weighted by spend, zombie keywords, match-type discipline.
4. **Search-Term Quality** — wasted spend, brand-leakage, negative coverage, conversion-worthy terms not yet keywords.
5. **Ad Copy & Creative** — RSA coverage, asset variety, sitelink/callout/structured-snippet completeness, PMax asset-group health.
6. **Impression Share** — read rank-lost vs budget-lost together (see the 2×2 matrix in `account-health-scoring.md`); they're different problems with different fixes.
7. **Spend Efficiency** — waste vs. headroom, brand vs. non-brand split, concentration risk.

For Signal Quality and network-mix questions, read `references/conversion-network-audit.md`. It adds the prerequisite checks for conversion-action integrity, Search Partners, Display leakage in Search campaigns, and regression decomposition.

Per-area findings only show up in the report when the area surfaced something material. Cite specific entities, dollars, and time windows. "Some keywords are underperforming" is not a finding; "Campaign X has $1,840 in last-30-day spend on 12 keywords with 0 conversions and QS ≤ 4" is.

For unit-economics-aware framing: if `business-context.json.unit_economics.aov_usd` and `profit_margin` exist, frame waste and headroom in dollars saved / captured per month, not "above account average". See `../shared/ppc-math.md`.

## Phase 4 — Business context

Derive what you can from data already pulled:

| Field | Source |
|---|---|
| `business_name` | `customer.descriptive_name` |
| `services` | Campaign + ad-group names, top converting keywords |
| `locations` | `campaign_criterion` LOCATION + PROXIMITY |
| `brand_voice` | Top-performing RSA headlines / descriptions |
| `keyword_landscape.high_intent_terms` | Converting keywords with strong CVR |
| `keyword_landscape.competitive_terms` | Keywords in campaigns with high rank-lost-IS |
| `keyword_landscape.long_tail_opportunities` | Converting search terms not yet promoted to keywords |
| `website` | Apex domain from ad final URLs |

Then crawl the website (homepage + about + services + top 3 ad landing pages, parallel `WebFetch`) and merge into the schema. See `references/business-context.md`.

Ask the user — it's faster than guessing — for: differentiators, competitors, seasonality, unit economics (AOV, margin). Ask for everything else only if the data + crawl can't answer it.

## Phase 5 — Personas

Discover 2–3 personas from search terms, top keywords, ad-group themes, landing pages, geo, and device split — all from the dataset already in memory. Persist to `{data_dir}/personas/{accountId}.json`. Each persona must be grounded in **5+ actual search terms**; if not, drop it. See `references/persona-discovery.md`.

## Phase 6 — Report

Structure: pulse metrics (3 lines, each with number + top contributor + fix pointer) → per-area findings (only those that surfaced something material) → Quick Wins section (per the rules in `references/account-health-scoring.md`). Cap at ~80 lines. Every claim cites a specific entity, number, and window.

End with a single closing line after the handoff to `/google-ads`:

> *Your audit history is saved to your NotFair account — view it at https://notfair.co.*

## Guardrails

1. **Read-only skill.** Diagnose; don't mutate. Every fix routes through `/google-ads` (or `/google-ads-copy`, `/google-ads-landing`). End the report with one handoff tied to the #1 action.
2. **STOP condition.** If conversion tracking is broken, recommend pausing spend until it's fixed before recommending anything else.
3. **Always persist** `business-context.json` and `personas/{accountId}.json` even if the report is short — downstream skills depend on them.
4. **Name names.** Every finding cites specific campaigns, keywords, search terms, and dollar amounts. No generic verdicts.
5. **Show the data, not the score.** The pulse metrics are the verdict — three numbers with named contributors and pointers to the fix. No letter grades, no 0–5 ratings hiding the reasoning behind a label.
