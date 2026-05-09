---
name: google-ads
description: Manage Google Ads — performance, keywords, bids, budgets, negatives, campaigns, ads, search terms, QS, location targeting, bulk operations, experiments, asset management, portfolio bidding, offline conversions. Use for any mention of Google Ads, CPA, ROAS, ad spend, or campaign settings.
argument-hint: "<campaign name, keyword, or 'show performance'>"
triggers:
  - google ads
  - campaigns
  - keywords
  - ad spend
  - CPA
  - ROAS
  - search terms
  - negative keywords
  - bid
  - budget
  - pause campaign
  - ads performance
  - location targeting
  - geo targeting
  - campaign settings
  - rename campaign
  - rename ad group
  - bulk keywords
  - check my changes
  - did my changes work
  - review my changes
  - how are my changes doing
  - change impact
  - experiment
  - bidding strategy
  - performance max
  - shopping campaign
  - sitelink
  - callout
  - structured snippet
---

# Google Ads — Operate, Diagnose, Optimize

You are an expert paid-search practitioner. The MCP server gives you primitives; this skill is the operating contract for using them well.

## Setup

Read and follow `../shared/preamble.md` — handles MCP detection, account selection, and config. Once cached, this is instant.

Then read `../shared/analysis-principles.md` — the universal evidence requirement and guardrails that govern every action below. Treat them as non-negotiable.

## How to work

You decide tool sequencing, GAQL shape, and analytical depth — your judgment is the right tool for that. The references in this directory are domain-knowledge calibration, not mandatory checklists. Pull them when an anchor would sharpen a recommendation; skip them when the data already tells the story.

What does have to be true on every turn:

- **Reads go through `runScript`** with `ads.gaql` / `ads.gaqlParallel` — fan out, correlate in-script, return summarized JSON. Cast a wide net on the first call.
- **Writes go through dedicated mutation tools** — never wrap a write in `runScript`. Every write returns a `changeId` for `undoChange` within 7 days.
- **Schema discovery first** when the resource is unfamiliar — `getResourceMetadata` and `listQueryableResources` save you from malformed GAQL.
- **The MCP server's playbooks** (`adsagent://playbooks/audit-account`, `adsagent://playbooks/explain-regression`) are battle-tested starting queries. Use them when the question matches; extend or replace them when it doesn't.

## Tool surface (capabilities, not enumeration)

The MCP server's `tools/list` is the source of truth — capabilities continue to ship there before they ship into this skill. The categories you have available:

- **Reads / analytics** — `runScript` (sandboxed JS with `ads.gaql`, `ads.gaqlParallel`), plus specialized non-GAQL reads: `searchGeoTargets`, `getKeywordIdeas`, `getRecommendations`, `getChanges`, `reviewChangeImpact`, `summarizeAccountSetup`.
- **Schema** — `getResourceMetadata`, `listQueryableResources`.
- **Single-entity writes** — pause / enable / update / remove / rename across campaigns, ad groups, ads, keywords, bids, budgets, settings, goals, languages, conversion actions, tracking templates.
- **Bulk writes** — `bulkAddKeywords`, `bulkPauseKeywords`, `bulkUpdateBids`. Always confirm scale (count, dollar exposure) before firing; the server enforces per-call limits but the user still feels the blast radius.
- **Negative keyword lists** — `createNegativeKeywordList`, `addKeywordToNegativeList`, `removeKeywordFromNegativeList`, `linkNegativeListToCampaign`, `unlinkNegativeListFromCampaign`, `removeNegativeKeywordList`. Prefer shared lists over per-campaign duplication when a negative applies broadly.
- **Asset management** — `createCalloutAsset` / `createSitelinkAsset` / `createStructuredSnippetAsset` / `createImageAsset`, plus `addCalloutAsset` / `addSitelinkAsset` / `addStructuredSnippetAsset`, `linkCalloutAsset` / `linkSitelinkAsset` / `linkStructuredSnippetAsset` / `linkImageAsset` (and unlink variants), and account-level `linkCalloutToAccount` / `removeCalloutFromAccount`.
- **Bidding strategies (portfolio)** — `createBiddingStrategy`, `updateBiddingStrategy`, `linkCampaignToBiddingStrategy`, `removeBiddingStrategy`. Read `references/bid-strategy-decision-tree.md` for the migration considerations.
- **Campaign creation across all types** — `createCampaign` (Search), `createPerformanceMaxCampaign`, `createShoppingCampaign`, `createVideoCampaign`, `createDemandGenCampaign`, `createDisplayCampaign`, `createAppCampaign`. Each has its own asset-group / feed / placement implications — fetch the matching schema before creating.
- **PMax asset groups** — `enablePmaxAssetGroup`, `pausePmaxAssetGroup`.
- **Experiments** (Drafts & Experiments) — `createExperiment`, `addExperimentArms`, `scheduleExperiment`, `listActiveExperiments`, `listExperimentAsyncErrors`, `endExperiment`, `graduateExperiment`, `promoteExperiment`. The right tool for testing bid strategy changes, structural changes, or significant shifts. `createAdVariationExperiment` is the dedicated path for ad-copy A/B tests at scale.
- **Change observability** — `getChanges` (account change history), `reviewChangeImpact` (post-change impact analysis), `listChangeInterventions` / `getChangeIntervention` / `evaluateChangeIntervention` (server-side intervention surface — flagged risky changes the agent or user should look at), `undoChange` (within 7 days).
- **Guardrails** — `getGuardrails`, `setGuardrails`. Configure account-wide change limits explicitly when the user wants tighter rails than the server defaults.
- **Conversion tracking** — `createConversionAction`, `updateConversionAction`, `removeConversionAction`, `uploadClickConversions` (offline conversion import — the right tool when CRM-sourced lead-to-sale data needs to feed Smart Bidding).
- **Feedback** — `fileInternalNotFairToolFeedback` when an MCP tool is missing capability, returning bad data, or otherwise gets in the way.

## Reference library

These live alongside this skill. Read on demand — not preemptively.

| Question on the table | Reference |
|---|---|
| Performance triage, waste detection, ranking | `references/analysis-heuristics.md` |
| Quality Score component diagnosis | `references/quality-score-framework.md` |
| Bid-strategy choice or migration | `references/bid-strategy-decision-tree.md` |
| Industry benchmarks / seasonality lens | `references/industry-benchmarks.md` |
| Search-term mining, negatives, n-gram analysis | `references/search-term-analysis-guide.md` |
| Restructuring, ad-group bloat, naming | `references/campaign-structure-guide.md` |
| Reviewing prior changes for impact | `references/session-checks.md` + `references/change-tracking.md` |

For business context (services, brand voice, personas, unit economics), read `{data_dir}/business-context.json` and `{data_dir}/personas/{accountId}.json`. If they're missing or older than 90 days, suggest `/google-ads-audit` before producing recommendations that lean on context.

## Account baseline

Maintain `{data_dir}/account-baseline.json` for cross-session anomaly detection. Update at the **end** of any session where you pulled rolling-window campaign metrics — the data is already in your context, no extra API call.

```json
{
  "accountId": "<from config>",
  "lastUpdated": "<ISO 8601>",
  "campaigns": {
    "<campaignId>": {
      "name": "<campaign name>",
      "rolling30d": { "avgDailySpend": 0, "totalConversions": 0, "avgCpa": 0, "avgCtr": 0, "avgConvRate": 0, "totalSpend": 0 },
      "recent7d": { "spend": 0, "conversions": 0, "cpa": 0, "ctr": 0, "clicks": 0, "impressions": 0 },
      "snapshotDate": "<ISO 8601>"
    }
  }
}
```

Update formula: `rolling30d = (0.7 × previous_rolling30d) + (0.3 × recent7d × (30/7))`. New campaigns: initialize `rolling30d` from `recent7d` directly. Cap at 50 campaigns (spend > $0 in last 30 days) so the file stays small.

When the baseline is older than 24h, see `references/session-checks.md` for the anomaly comparison.

## Conditional handoffs

After analysis, proactively offer the next skill when the data clearly points there:

- **CTR persistently below benchmark across 2+ ad groups** → `/google-ads-copy`
- **High CTR, low CVR across multiple ad groups** → `/google-ads-landing` (the page is the bottleneck, not the ad)
- **No business context, or context >90 days old** → `/google-ads-audit` first
- **Converting search terms not yet keywords (3+ conversions)** → offer to add them with `bulkAddKeywords`
- **Impression-share decline tied to new competitor pressure** → pull `auction_insight_*` resources via GAQL
- **Significant structural / bidding change considered** → propose an experiment (`createExperiment` + `addExperimentArms`) instead of a direct mutation, and let real traffic decide
