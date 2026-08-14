---
name: paid-ads-setup
description: Connect NotFair paid-ad accounts and establish reusable campaign context. Use when setting up paid media in a new workspace, connecting Google, Meta, X, or LinkedIn Ads, refreshing brand context, or preparing an agent to work on ads safely.
argument-hint: "<connect accounts, workspace, or brand>"
---

# Paid Ads Setup

Read `../shared/operating-contract.md`. Do not alter campaigns during setup.

## Establish access

1. Detect the requested platform on the universal NotFair MCP. Call `listConnectedPlatforms`, then use the existing shared preambles for Google Ads and Meta Ads or the `x_ads_` and `linkedin_ads_` tool surfaces. If the requested platform is missing, direct the user to connect it in NotFair and stop before claiming access.
2. List only accounts actually returned by the connected surface. Let the user select the intended account when more than one is available; never infer it from an account name.
3. For TikTok, Amazon, and ChatGPT Ads, check the available tools before proposing a connection. If no verified connector exists, request a current export or describe the plan-only boundary.

## Capture decision-quality context

Read project documents that are clearly marketing-relevant, then ask only for gaps that data cannot establish:

- product, offer, geography, and primary conversion;
- unit economics: target CPA or break-even ROAS, margin, and customer value;
- approved claims, differentiators, exclusions, and brand voice;
- monthly budget, launch constraints, seasonality, and competitors;
- landing-page URLs and analytics/tracking owner.

Use the Google and Meta audit skills to persist account-specific business context where supported. For X and LinkedIn, report the selected account and context without inventing a persistence surface. Do not overwrite an existing `AGENTS.md`, `CLAUDE.md`, or project instructions as a side effect of setup. Offer a clearly marked paid-media context file only after the user approves the exact location and content.

## Finish with a gap register

Report connected platforms, selected accounts, verified conversion signals, available date range, and the smallest next action. State missing tracking, economics, claim proof, or platform access explicitly. Hand off to `/notfair:paid-ads-review` for a baseline, `/notfair:paid-ads-launch` for a new campaign, or the platform audit for a deeper diagnosis.
