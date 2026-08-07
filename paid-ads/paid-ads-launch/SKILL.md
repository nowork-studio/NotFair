---
name: paid-ads-launch
description: Plan and prepare a new paid-media campaign or cross-channel test before it can spend. Use when asked to create, launch, start, set up, or allocate budget to an advertising campaign on any supported platform.
argument-hint: "<business goal, budget, and target platform>"
---

# Paid Ads Launch

Read `../shared/operating-contract.md` and `../shared/measurement-framework.md`.

## Gate the launch

Do not build or recommend a spend plan until these are known: primary conversion and verification method, target CPA/ROAS or customer economics, daily and monthly budget, destination URL, geography, approved offer and claims, and the user who can approve spend. Diagnose tracking before optimizing toward it.

Choose the narrowest viable test. Search demand generally merits Google Search; visual discovery can suit Meta; B2B job/company targeting can suit LinkedIn; marketplace product demand can suit Amazon. A small budget split across several channels is usually an underpowered experiment: explain the tradeoff and set a review date if the user chooses it anyway.

## Produce a preflight brief

Mark the following artifact `ready_for_review`:

| Field | Required content |
|---|---|
| Objective and measurement | Conversion, source of truth, attribution window, baseline, target, and review date |
| Channel and structure | Platform, campaign/ad-set or ad-group structure, audience/query intent, and exclusions |
| Budget | Currency, daily cap, implied monthly maximum, allocation, and pacing guardrail |
| Message chain | Audience motivation, approved claim source, ad concept, CTA, and matching landing URL |
| Experiment | Single primary variable, success metric, guardrail, minimum observation window, and stop condition |
| Readiness | Tracking, policy/rights, creative, access, and dependencies marked complete or blocked |

## Execute only on verified surfaces

For Google Ads, hand the approved brief to `/notfair:google-ads`, then create paused and read it back. For Meta, use `/notfair:meta-ads` for supported operations and route unavailable creation steps to Ads Manager. For all other platforms, provide an operator-ready brief unless the current session exposes a verified NotFair connector with the needed capability. Never resume a campaign without a separate explicit approval.
