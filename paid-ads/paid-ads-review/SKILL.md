---
name: paid-ads-review
description: Produce a read-only, evidence-based paid-media performance review across connected platforms or supplied exports. Use for weekly or monthly reports, scorecards, performance, CPA, ROAS, CTR, spend trends, pacing, or conversion-tracking health.
argument-hint: "<date range, platform, or 'weekly review'>"
---

# Paid Ads Review

Read `../shared/operating-contract.md` and `../shared/measurement-framework.md`. This is read-only.

## Assemble comparable evidence

Check which sources are actually connected, request the missing export rather than reporting a failed call, and use the most recent complete equivalent window. For every source, keep currency, conversion definition, attribution window, and reporting lag visible. Verify tracking before treating CPA, ROAS, or revenue as a decision-grade metric.

For live Google and Meta accounts, hand data collection and platform-specific diagnostics to `/notfair:google-ads` and `/notfair:meta-ads`. Keep LinkedIn, TikTok, Amazon, and ChatGPT Ads review grounded in a verified connector or supplied platform export.

## Report the decision, not a dashboard transcription

Lead with the strongest contributor, the largest risk, and one recommended next action. Include a platform scorecard with spend, qualified conversions, CPA, attributable revenue/ROAS where available, link CTR, and pace against the declared budget. Compare each row to the preceding equivalent period and name the likely driver only when data supports it.

Do not present an unqualified blended CPA or ROAS. If a cross-channel aggregate is useful, label the consistent conversion definition, attribution source, spend-weighted formula, and included channels. Separate confirmed facts from inference and mark absent tracking or data as a blocking limitation.

End with `hold`, `investigate`, or one proposed action; route mutations to `/notfair:paid-ads-optimize` or the relevant platform operator skill.
