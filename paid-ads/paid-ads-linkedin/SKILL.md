---
name: paid-ads-linkedin
description: Audit, diagnose, plan, and safely operate connected LinkedIn Ads accounts through the NotFair MCP, with an export-based fallback. Use for LinkedIn advertising, sponsored content, lead-generation forms, job-title or company targeting, campaign groups, creatives, conversions, lead quality, budgets, bids, or approved LinkedIn campaign changes.
argument-hint: "<B2B goal, audience, account, or date range>"
---

# LinkedIn Ads

Read `../shared/operating-contract.md` and `../shared/measurement-framework.md` before acting. Prefer the `linkedin_ads_` tools on the universal NotFair MCP; use a supplied export only when no verified connector is available.

## Establish access and qualified-demand context

1. Resolve `~~linkedin-ads` to the universal connector's `linkedin_ads_` tool surface or a verified compatible connector. Call `listConnectedPlatforms` when using NotFair, then confirm the selected account with a harmless account/setup read. Do not infer LinkedIn access from another platform's tools.
2. If the connector is missing or unauthorized, request re-authorization or a current export and keep the result plan/review-only.
3. Define the sales-qualified conversion, CRM feedback loop, account currency, attribution basis, target CPA or pipeline outcome, and complete date window before diagnosing performance.

Keep lead quantity separate from lead quality. Build targeting hypotheses from job function, seniority, company, industry, or account lists only when the business rationale and audience constraints are defensible.

## Read and diagnose

Use `runScript` for correlated read-only work across campaign groups, campaigns, creatives, and analytics. Prefer a single broad read. Use specialized point tools for individual objects, conversion rules, lead forms, targeting lookup, or lead-form responses.

Interpret the platform correctly:

- Hierarchy is account → campaign group → campaign → creative.
- Money is returned as a major-unit object such as `{ amount: "50", currencyCode: "USD" }`, not micros or cents.
- Targeting is a whole tree on the campaign. Preserve existing criteria unless the user explicitly approves replacement.
- Campaign type and cost type are immutable after creation.
- Lead-form responses contain personal data. Retrieve only when necessary, minimize exposure in the response, and never copy raw lead PII into unrelated artifacts.

For reviews, report spend, impressions, link CTR, leads, qualified leads, CPA, and downstream pipeline or revenue by a complete equivalent period. Name the likely driver only when the data supports it.

## Execute approved changes safely

Use dedicated write tools, never the read-only script surface. Show the exact object, current and proposed state, currency exposure, expected effect, and rollback first. Use dry-run previews for spend-affecting creates, budgets, bids, and targeting when available.

- Prefer pause/activate over hard deletion; conversion rules and matched audiences may not be deletable through the API.
- Create campaign groups, campaigns, and creatives in draft, then review targeting, budget, conversion association, and creative before activation.
- Use a stable client request ID only to retry the same uncertain create.
- Resolve targeting names to LinkedIn URNs before setting the full targeting tree.
- Hashing and event-shape enforcement belong to the connector. Do not expose raw customer identifiers in the final report.
- Verify the mutation through returned before/after evidence or a fresh read and report any partial failure.

Finish with the confirmed action, quality metric, observation window, and rollback trigger. If operating from an export, mark recommendations `ready_for_review`, never `published`.
