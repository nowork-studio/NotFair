---
name: meta-ads-creative
description: Create evidence-based Meta ad creative briefs, copy angles, and testable asset concepts for Facebook and Instagram. Use when asked for Meta ad creative, Facebook ads copy, Instagram ad assets, UGC concepts, creative briefs, new ad concepts, or creative refreshes.
argument-hint: "<campaign, audience, or 'build a creative slate'>"
---

# Meta Ads Creative Studio

Create a reviewable creative slate from real customer language and account evidence. This skill produces briefs and copy; it does not imply that the NotFair Meta MCP can upload creatives or create campaigns.

## Setup

Read and follow `../shared/preamble.md`. Read `{data_dir}/meta/business-context.json` and `{data_dir}/meta/personas/{accountId}.json` first. If either is missing or stale, recommend `/meta-ads-audit` before writing. The audit's creative inventory and personas are the baseline; do not invent an audience because a request is underspecified.

Pull current ads and ad-level insights with `runScript` + `ads.graphParallel` when account access exists. Use link CTR, CPA or purchase value, frequency, attribution window, and a named time period. If the user has reviews, sales-call notes, or customer research, treat them as evidence only when the source is identifiable.

## Create a concept slate

Each concept must be a real hypothesis:

`persona × motivation × angle × format × one variable to test`

Start with three distinct concepts, not three cosmetic versions of the same idea. A useful spread is proof, problem/pain, product demonstration, founder/expert explanation, or an approved offer — but select only angles supported by the evidence.

For every concept, include:

| Field | Required content |
|---|---|
| Concept ID and hypothesis | Who it is for, why it should work, and the single variable under test |
| Evidence | Named campaign/ad/customer source, metric and window, or approved business-context field |
| Hook and primary text | First-frame or first-line hook plus placement-adapted copy |
| Visual brief | Subject, setting, action, proof shown on screen, and production notes |
| CTA and destination | CTA plus approved landing page/message-match note |
| Claim ledger | Source and approval status for every rating, result, price, guarantee, quote, or before/after claim |
| Read plan | Primary metric, guardrail, planned duration/exposure, and what would falsify the hypothesis |

An unsupported claim is `needs_substantiation`, not ad copy. Supply a truthful alternative rather than making a vague disclaimer. Do not fabricate UGC testimonials, review counts, customer outcomes, or visual proof.

## Creative refresh and testing

For fatigue, first verify the signal: compare link CTR and CPM week over week, cite frequency, and preserve the attribution window. Frequency rising with a material decline in link CTR is a refresh hypothesis, not a universal rule.

Test one strategic variable at a time: angle, hook, proof, format, audience, or destination. Set the winner metric and guardrail before launch; do not name a winner from an early CTR spike or an unqualified in-platform ROAS number. Keep a short iteration log: concept ID, launch date, audience, spend, results, decision, and next challenger.

## Production and execution boundary

The Meta MCP is intentionally read/operate-focused and does not provide creative upload or campaign-creation tools. Deliver a production-ready brief for the user's approved design or Ads Manager workflow; do not improvise Graph API writes. Before a human publishes, require review of claim evidence, rights/releases, destination, policy-sensitive targeting, and placement-safe crops.

Use `/meta-ads` to diagnose performance or act within its supported mutation surface. Use `/meta-ads-audit` when context, tracking, or creative inventory is missing.
