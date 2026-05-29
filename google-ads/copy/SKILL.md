---
name: google-ads-copy
description: Generate and A/B test Google Ads copy. Use when asked to write ad copy, headlines, descriptions, create ad variants, test ad messaging, improve CTR, or generate RSA (Responsive Search Ad) components. Trigger on "ad copy", "write ads", "headlines", "descriptions", "RSA", "responsive search ad", "ad text", "ad creative", "improve CTR", "ad A/B test", "ad variants", "write me an ad", "ad variation experiment", or when the user wants to improve click-through rate on existing ads.
argument-hint: "<ad group name, keyword theme, or 'write new ads'>"
---

# Ad Copy Generator + A/B Tester

Write Google Ads RSA copy and run structured tests to find winning messaging.

## Setup

Read and follow `../shared/preamble.md` (MCP detection, account selection) and `../shared/analysis-principles.md` (evidence requirement, guardrails). Both apply throughout.

## Reference

Read on demand:

- `references/rsa-best-practices.md` — character limits, headline formulas, pinning, A/B mechanics, common mistakes. The source of truth for what to write.
- `references/rsa-testing-lab.md` — how to choose RSA test metrics, diagnose ad-group intent bloat, decide pinning, and avoid chasing Ad Strength over business outcomes.
- `../manage/references/industry-benchmarks.md` — industry CTR/CVR benchmarks for sanity-checking targets.
- `../manage/references/quality-score-framework.md` — only when QS improvement is the explicit goal.

## Business context — non-negotiable input

Every copy decision is grounded in business context. Read `{data_dir}/business-context.json` and `{data_dir}/personas/{accountId}.json` first.

- If either file is missing or empty, recommend `/google-ads-audit` before writing — generic copy that ignores positioning is wasted ad inventory. The full intake procedure (website crawl, schema, bootstrapping) lives in `../audit/references/business-context.md`.
- If the user volunteers new info (new service, changed positioning, seasonal update), merge it in.

How context shapes copy: services map to headline categories; locations earn local-specific headlines (with QS upside); brand voice sets tone and forbidden words; differentiators ARE the value-prop headlines; competitors sharpen positioning (without naming them); seasonality decides urgency vs. evergreen framing; offers feed time-sensitive variants; landing-page content must match (or conversions drop). Personas drive language: their own search-term phrasing in headlines, their pain points in descriptions, their decision-trigger as the CTA angle.

## Ad-strength vs. real performance

Ad strength optimizes for Google's diversity goals, not your conversion rate. The hierarchy: **conversion rate > CTR > CPA > ad strength.** Don't break a high-CTR ad to chase "Excellent". Do treat low ad strength as a useful diversity signal — eight distinct headlines, one per category, no repeats in description bank.

## Pulling what to write from

Copy must be grounded in what already converts. One `runScript` with `ads.gaqlParallel` covers almost any copy job — fan out:

- `ad_group_ad` — current headlines, descriptions, ad-strength, per-ad clicks/CTR/conversions (the baseline to beat)
- `keyword_view` — what's converting and which QS components are weak
- `search_term_view` — the actual phrases customers are typing (the single best language source)
- `campaign` — the CTR/CVR benchmark each variant has to clear

For brand-wide rewrites, correlate everything in one pass. For a single ad group, scope each query with `WHERE ad_group.id = …`. Layer in seasonality and keyword-landscape context from `business-context.json`.

If the user has a CRM or lead-outcome database with the language customers actually use, mine that — customer language beats marketing language every time.

## Competitive copy rules

- **Never** name a competitor in ad copy (policy risk + you do their brand awareness for free).
- **Never** use "best" / "#1" without verifiable substantiation. Google requires it; the Trademark team enforces it.
- **Do** use specific features competitors lack ("Same-Day Service" beats "Better Service"), trust signals ("4.9★ Google · 500+ Reviews"), guarantees, transparent pricing, and location specificity. Verifiable specificity outperforms superlatives.

## RSA mechanics

Google RSA: up to **15 headlines (30 chars max)** and **4 descriptions (90 chars max)**. A single character over = rejected. Always count.

`references/rsa-best-practices.md` is the source of truth for headline formulas, description ordering, and pinning strategy. The compact rule of thumb: pin one Service+Location headline to position 1, one CTA to position 3, leave position 2 unpinned for Google to test value-prop / trust / differentiator headlines, and never pin more than 3 total.

## A/B testing — use the experiments framework

When the user wants to test, use the MCP server's experiment tooling rather than the old "deploy two paused ads side by side" pattern:

- **Ad-copy A/B** — `createAdVariationExperiment` is the dedicated tool for variation testing at the ad level. It manages the split, the lift comparison, and the read-back.
- **Larger creative shifts** (different angle, different persona target, different LP destination) — `createExperiment` + `addExperimentArms` + `scheduleExperiment`. Monitor with `listActiveExperiments` and `listExperimentAsyncErrors`. Decide endgame with `endExperiment`, `graduateExperiment`, or `promoteExperiment`.
- **Single ad-group, two variants, no traffic split** — paused-then-enabled twin ads in the same ad group is still acceptable for low-stakes copy iteration, but it has no statistical engine behind it. Prefer the experiment path when the decision matters.

Each variant must test a **meaningfully different angle** — not word swaps. "Trust & Expertise" vs. "Speed & Convenience" vs. "Price & Value" is a real test; "Call Today" vs. "Call Now" is noise.

Before writing variants, read `references/rsa-testing-lab.md` when the request mentions testing, pinning, Ad Strength, low CTR/CVR, or mixed-intent ad groups. It encodes the generalized pattern that many RSA problems are really ad-group/query-theme problems.

When calling a winner, the underlying question is the same regardless of mechanism: did the variant win on conversion rate (or CPA), backed by enough sample to trust the difference? Less than ~100 clicks per variant is too early. ≥20% relative CTR or CVR delta is meaningful. 2× CVR gap is decisive immediately. The experiments framework's own significance signals are the cleanest input — defer to them when present.

After a winner: pause the loser, then iterate against the winner. Never stop testing.

## Operating principles

1. **Business context is non-negotiable.** No `business-context.json` / `personas` → recommend `/google-ads-audit` before writing.
2. **Confirm before deploying.** Show the exact copy, character counts per asset, and pin positions. Get a yes, then push.
3. **Every write is undoable for 7 days** via `undoChange` (assuming the entity hasn't been modified since).
4. **Differentiate, don't imitate.** Generic copy that could belong to any competitor is a wasted ad slot.
5. **Defer to `/google-ads`** for bid / budget / keyword work — this skill writes copy and runs creative experiments only.
