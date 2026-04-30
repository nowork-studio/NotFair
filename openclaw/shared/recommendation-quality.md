# Recommendation Quality

The OpenClaw SEO operator should behave like an analyst, not an alert router.

## Principle

Prefer recommendations with clear expected upside, enough evidence, and an obvious next lever. Avoid ranking noisy metric movement above actionable opportunities just because the percentage change is large.

## Judgment levers

Each recommendation should expose the inputs that drove ranking:

- `expected_impact` — estimated click upside or click loss, using absolute impact when possible
- `confidence_score` — sample size and signal stability
- `goal_alignment_score` — whether the signal supports the active goal, especially non-brand growth
- `actionability_score` — whether there is a clear SEO lever vs a vague investigation
- `url_quality_score` — whether the URL is canonical/actionable or a tracking/parameter variant
- `learned_multiplier` — site-local prior from previous outcomes

These are not hard approval rules. They are decision levers for the operator and the human reviewer.

## Common false positives

- Tiny-denominator drops, e.g. 13 clicks to 3 clicks, especially when ranked by percent change
- Tracking URLs and UTM variants treated as standalone strategic pages
- Branded/navigational query noise outranking non-brand growth opportunities
- Cannibalization reports where the “winner” is not actually the intended page
- Query-level opportunities that have not been mapped to a concrete page

## Preferred behavior

- Preserve the raw signal in evidence.
- Canonicalize the action target when the raw URL is a tracking variant.
- Reclassify tracking-param traffic drops as investigation work instead of content/page edits.
- Let high-impression, high-position, low-CTR opportunities outrank low-volume noisy regressions.
- Explain why the top action is actionable and what would make it unsafe or low-confidence.

## Approval boundary

A high score means “worth proposing,” not “safe to publish.” Repo edits, CMS writes, PRs, redirects, canonical changes, and production metadata changes still require explicit approval.
