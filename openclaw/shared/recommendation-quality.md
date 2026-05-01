# Recommendation Quality

The OpenClaw SEO operator should behave like an analyst, not an alert router.

## Principle

Prefer recommendations with clear expected upside, enough evidence, and an obvious next lever. Avoid ranking noisy metric movement above actionable opportunities just because the percentage change is large.

Use `seo/shared/seo-best-practices.md` as the durable reference. Every top recommendation should map to exactly one primary MECE best-practice lane so the operator knows whether the right next action is eligibility/indexing, intent targeting, content usefulness, SERP packaging, technical UX, authority, local presence, or measurement.

## Judgment levers

Each recommendation should expose the inputs that drove ranking:

- `expected_impact` — estimated click upside or click loss, using absolute impact when possible
- `confidence_score` — sample size and signal stability
- `goal_alignment_score` — whether the signal supports the active goal, especially non-brand growth
- `actionability_score` — whether there is a clear SEO lever vs a vague investigation
- `business_intent_score` — whether the query likely maps to revenue, not just informational visits
- `business_context_goal_score` — whether the opportunity matches the site-specific business goal, e.g. local qualified outcomes over national informational traffic
- `url_quality_score` — whether the URL is canonical/actionable or a tracking/parameter variant
- `learned_multiplier` — site-local prior from previous outcomes
- `best_practice_alignment` — the primary SEO best-practice lane, source references, and why the action belongs there

These are not hard approval rules. They are decision levers for the operator and the human reviewer.

## Common false positives

- Tiny-denominator drops, e.g. 13 clicks to 3 clicks, especially when ranked by percent change
- Tracking URLs and UTM variants treated as standalone strategic pages
- Branded/navigational query noise outranking non-brand growth opportunities
- Cannibalization reports where the “winner” is not actually the intended page
- Query-level opportunities that have not been mapped to a concrete page
- Treating high-impression informational/price queries as metadata-only wins without checking zero-click SERP behavior

## Preferred behavior

- Preserve the raw signal in evidence.
- Canonicalize the action target when the raw URL is a tracking variant.
- Reclassify tracking-param traffic drops as investigation work instead of content/page edits.
- Let high-impression, high-position, low-CTR opportunities outrank low-volume noisy regressions only when business intent, site-specific business context, and actionability are also strong.
- For informational price queries, classify the action as snippet/content packaging or query-intent mapping unless a SERP diagnosis proves metadata is the main lever.
- Explain why the top action is actionable and what would make it unsafe or low-confidence.
- Attach `best_practice_alignment` to proposals and action-plan entries. If an action cannot be mapped to one primary best-practice lane, downgrade it to investigation/manual review.
- Before proposing an edit for CTR/snippet/content opportunities, automatically run a deep-dive diagnostic: SERP snapshot, current title/meta/H1, above-the-fold content packaging, CTA/price-answer check, and zero-click risk classification.
- If business context deprioritizes a traffic class, reframe the recommendation instead of chasing raw clicks. Example: for a local service business that only values local qualified outcomes, broad national cost-query CTR should become a local intent ownership / consolidation proposal, not a national blog CTR optimization.
- If business-impact context is incomplete, create an explicit `business_context_request` queue item and surface the questions in the runner result instead of burying them in verification warnings. Missing business context blocks approval/editing, but should not block the diagnostic deep dive.

## Approval boundary

A high score means “worth proposing,” not “safe to publish.” Repo edits, CMS writes, PRs, redirects, canonical changes, and production metadata changes still require explicit approval.
