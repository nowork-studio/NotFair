# Analysis Heuristics

This file is calibration data and guardrails. It is **not** a step-by-step checklist — your judgment decides how to apply what's here. Whatever you recommend has to be backed by data from this account (per `../../shared/analysis-principles.md`).

## Framing — margin-aware vs. account-average

Before reasoning about "good" or "bad" performance, check `{data_dir}/business-context.json.unit_economics`:

- **If `aov_usd` and `profit_margin` exist** — frame everything in dollars (waste = spend on entities with `CPA > Break-Even CPA = AOV × margin`; scaling = positive headroom AND budget-lost-IS > 20%). Read `../../shared/ppc-math.md` for the formulas. Express findings as "saves $X/mo" or "captures $Y/mo headroom" — not "above account average". If `unit_economics.source == "inferred_from_template"`, append a disclaimer noting industry defaults are in use.
- **Otherwise** — fall back to account-average comparisons. Pick one framing and stay consistent within a report.

Industry calibration lives in `../../shared/industry-templates.json` (read once per audit, cache in memory). Use `business-context.json.industry_template_key` to select the template; otherwise use the account-average fallback.

## Guardrail: keyword tier classification (do not skip)

Before evaluating any keyword's performance, classify it. This prevents pausing core business keywords during a short run of poor metrics — the most common AI-agent failure mode.

| Tier | Definition | Implication |
|------|-----------|-------------|
| **Tier 1 (Core)** | Keyword directly describes what the business sells | **Never pause on short-window data.** Diagnose root cause and optimize. |
| **Tier 2 (Adjacent)** | Related to the business but not a primary service | Standard heuristics apply after the significance gate below. |
| **Tier 3 (Irrelevant)** | Wrong intent, wrong service, unrelated | Aggressive negativization is appropriate. |

Classification signals (without business context): campaign name, ad group name, ad headlines, landing page URL. Matches 2+ signals = Tier 1. Matches 1 = Tier 2. Matches none = Tier 3. With business context, services and high-intent terms in `business-context.json` are the authoritative signal.

When a Tier 1 keyword underperforms, the diagnosis sequence is roughly: enough sample to draw a conclusion → siblings in the same campaign converting → match-type / search-term hygiene → QS subcomponent issue → impression-share / rank context. Recommend optimization, not removal.

## Guardrail: statistical significance gate

Before any conversion-based decision (pause, bid down, "non-converter" label):

1. Compute `expected_conversions = keyword_clicks × account_average_conversion_rate`.
2. If expected conversions < 3, the sample is **insufficient**. Label the entity "Insufficient data" and skip the conversion-based decision. Do not pause.
3. Apply conversion heuristics only when expected conversions ≥ 3 and observed conversions are still 0 or significantly below expected.

## Domain facts worth remembering

These are non-obvious enough that the agent benefits from having them surfaced — they are evidence the AI uses, not rules to apply blindly:

- **Weighted QS by spend, not by keyword count.** A QS-3 keyword burning $2,000/mo matters infinitely more than ten QS-3 keywords burning $5/mo combined.
- **Brand-leakage premium.** When brand campaigns are paused or starved, brand traffic leaks to non-brand campaigns at 5–10× higher CPA. Always check whether brand terms appear in non-brand campaigns' search-term reports.
- **Wasted spend definition.** Spend on Tier 2/3 keywords with 0 conversions and clicks > the significance threshold, plus spend on search terms with low relevance, plus spend on Display Network impressions inside Search-channel campaigns. Tier 1 keywords are optimization opportunities, not waste.
- **Display + Search in one campaign** is structurally broken — Display dilutes Search metrics and burns budget on unintended placements. Flag any Search campaign with `network_settings.target_content_network = TRUE`.
- **Zombie keywords** (0 impressions for 30+ days) clutter reporting and confuse Google's ML — recommend pause.
- **Counting type matters.** Lead-gen should use `ONE` per click; e-commerce should use `EVERY`. Wrong setting silently inflates or deflates conversions.
- **STOP condition.** If conversion tracking is broken, every downstream optimization is built on lies. Recommend pausing spend until tracking is fixed before any other recommendation.

## Impression Share — interpretive matrix

Rank-lost-IS and budget-lost-IS together tell a story. They're two different problems with two different fixes:

| | Rank-Lost < 30% | Rank-Lost 30–50% | Rank-Lost > 50% |
|---|---|---|---|
| **Budget-Lost < 20%** | Healthy | QS / bid problem | Quality crisis |
| **Budget-Lost 20–40%** | Budget problem | Mixed (fix quality first) | Structural — too-competitive keywords |
| **Budget-Lost > 40%** | Severe budget gap (high-ROI fix if CPA is good) | Fix rank first, then add budget | Fundamental misalignment — pause and restructure |

This is interpretive context, not a prescription — the right move depends on margin, intent, competitive set, and what the search-term and QS data show. Use the matrix to orient your diagnosis, not to skip it.
