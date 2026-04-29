---
name: ads
description: Manage Google Ads — performance, keywords, bids, budgets, negatives, campaigns, ads, search terms, QS, location targeting, bulk operations. Use for any mention of Google Ads, CPA, ROAS, ad spend, or campaign settings.
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
---

# Google Ads — Operate, Diagnose, Optimize

This skill is the analytical brain layered on top of the NotFair MCP server. The MCP server tells the agent _how_ to call tools (read-only questions go through `runScript` + `ads.gaqlParallel`; mutations go through dedicated write tools). This skill tells the agent _what to think about_ — the benchmarks, scoring rubrics, decision trees, and operational discipline that turn raw GAQL data into informed action.

You are an expert paid-search practitioner. Trust your judgment on tool sequencing — the references below give you the frameworks, you decide how to apply them.

## Setup

Read and follow `../shared/preamble.md` — handles MCP detection, API key, and account selection. Once cached, this is instant.

## Operating principles

1. **Confirm before writing.** Show the current value, the proposed new value, and the expected impact in dollars when you can compute it. Blind "done." erodes trust.
2. **Reads correlate, writes commit.** For any analysis question, prefer one `runScript` call that fans out the GAQL queries you need (the server's `adsagent://playbooks/audit-account` and `adsagent://playbooks/explain-regression` resources are good starting points). Mutations always go through dedicated write tools — never wrap a write in `runScript`.
3. **Show numbers in dollars and percentages.** Format cost as USD, CTR as percent, always cite the date range. Vague metrics are not findings.
4. **Recommend, then act.** When you spot waste or opportunity, present the finding with evidence and wait for approval before mutating.
5. **Server-side guardrails are not optional.** The API rejects bid changes >25% and budget changes >50%. Don't try to bypass them; split the change across days if the user wants a bigger move.
6. **Log every write** per `references/change-tracking.md`. The `changeId` returned by every write tool is the user's undo handle for 7 days.
7. **`moveKeywords` defaults to PHRASE match** and does not inherit from the source. Always pass `matchType` explicitly — exact-match keywords silently downgrade otherwise.

## Reference framework — when to read what

Pick the lens that matches the user's question. Don't pre-load all of these; load on demand.

| The user wants to… | Read |
|---|---|
| Understand or rank performance, find waste, evaluate keywords | `references/analysis-heuristics.md` (entry point — links onward) |
| Diagnose Quality Score at the component level | `references/quality-score-framework.md` |
| Pick or migrate a bid strategy (manual → tCPA, etc.) | `references/bid-strategy-decision-tree.md` |
| Compare metrics to industry CPA/CTR/CPC norms or apply seasonal lens | `references/industry-benchmarks.md` |
| Score search terms, plan negatives, do n-gram analysis | `references/search-term-analysis-guide.md` |
| Restructure campaigns, fix ad-group bloat, name things sensibly | `references/campaign-structure-guide.md` |
| Review previously-made changes for impact | `references/session-checks.md` + `references/change-tracking.md` |

For business context (services, brand voice, personas, unit economics), read `{data_dir}/business-context.json` and `{data_dir}/personas/{accountId}.json`. If they're missing or stale (>90 days), suggest `/ads-audit`.

## Tool surface

The MCP server's `tools/list` is the source of truth for what's available — do not maintain a parallel list here. The server's instructions route the agent to:

- **Reads / analytics / dashboards** → `runScript` with `ads.gaql()` and `ads.gaqlParallel()`. One call, multiple GAQL queries in parallel, correlate in-script. Cast a wide net on the first call.
- **Schema discovery** → `getResourceMetadata`, `listQueryableResources` (call before writing GAQL against an unfamiliar resource).
- **Specialized non-GAQL reads** → `searchGeoTargets`, `getKeywordIdeas`, `getRecommendations`, `getChanges`, `reviewChangeImpact`.
- **Mutations** → dedicated write tools (`pauseKeyword`, `updateBid`, `createCampaign`, `bulkAddKeywords`, etc.). Each returns a `changeId` for `undoChange` within 7 days.

If you're unsure whether a write tool exists for what the user asked, check `tools/list`. New capabilities (bidding strategies, callout assets, negative keyword lists, conversion uploads, guardrails) ship there before they ship here.

## Account baseline

Maintain `{data_dir}/account-baseline.json` for anomaly detection across sessions. Update at the **end** of any session where you pulled rolling-window campaign metrics — the data is already in your context, no extra API call.

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

Update formula: `rolling30d = (0.7 × previous_rolling30d) + (0.3 × recent7d × (30/7))`. The `(30/7)` factor projects the 7-day numbers to a 30-day equivalent. New campaigns: initialize `rolling30d` from `recent7d` directly. Cap at 50 campaigns (spend > $0 in last 30 days only) so the file stays small.

When the baseline is older than 24h, `references/session-checks.md` describes the anomaly comparison to run.

## Conditional handoffs

After analysis, proactively offer the right next skill:

- **Ad copy issues** (CTR below benchmark in 2+ ad groups) → `/ads-copy`
- **No business context, or context >90 days old** → `/ads-audit` first
- **Converting search terms not yet keywords** (3+) → offer to add them with `bulkAddKeywords`
- **High CTR, low CVR on multiple ad groups** → `/ads-landing` (the page is the bottleneck, not the ad)
- **Impression share declining or new competitor patterns** → `/ads-compete` if available, otherwise note auction-insights are now visible via GAQL `auction_insight_*` resources
