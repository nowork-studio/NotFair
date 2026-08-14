---
name: paid-ads-x
description: Audit, diagnose, and safely operate connected X Ads (Twitter Ads) accounts through the NotFair MCP. Use for X Ads performance, campaign or line-item analysis, spend, conversions, targeting, promoted posts, audiences, budgets, bids, creative, campaign setup, or approved X Ads changes.
argument-hint: "<account, campaign, date range, or X Ads goal>"
---

# X Ads

Read `../shared/operating-contract.md` and `../shared/measurement-framework.md` before acting. Use the `x_ads_` tools on the universal NotFair MCP as the source of truth.

## Establish the live scope

1. Resolve `~~x-ads` to the universal connector's `x_ads_` tool surface or a verified compatible connector. On the universal connector, call `listConnectedPlatforms` and require X Ads to be connected; do not infer X access from another platform's tools.
2. Confirm the selected account with a harmless account/setup read. If the connector is missing or unauthorized, direct the user to connect or re-authorize X Ads and stop before claiming live access.
3. Record the account currency, timezone, objective, conversion definition, attribution basis, and requested date window. Treat tracking gaps as limitations, not zero performance.

## Diagnose with one broad read

Use the connector's `runScript` analytics surface for audits and correlated reads. Pull campaigns, line items, funding/configuration, and performance in one pass when possible; use specialized point reads only for one narrow object or for capabilities outside the script sandbox.

Interpret the platform correctly:

- Hierarchy is account → funding instrument → campaign → line item → promoted post/account.
- Money fields ending in `*_local_micro` are local-currency major units multiplied by 1,000,000. Divide by 1,000,000 before displaying or comparing them.
- A line item's `primary_web_event_tag` describes its optimization configuration. It does not prove that attributed conversions are zero; read conversion metrics from performance data.
- Synchronous stats are suited to short, unsegmented windows. Use the connector's long-window performance read when the requested window or breakdown exceeds the script surface's current limits.
- Compare complete equivalent periods and name spend, impressions, engagement/link CTR, conversions, CPA or ROAS only when the returned fields support them.

Lead with the business decision: strongest contributor, largest material risk, likely cause supported by data, and the smallest useful next action. Separate measured facts from inference.

## Execute approved changes safely

Use dedicated mutation tools, never the read-only script surface. Show the exact account, entity, current value, proposed value, spend exposure, risk, and rollback before acting. Prefer a dry-run preview for budget, bid, targeting, optimization-event, and create operations when the connector offers it.

- Prefer pause/enable over irreversible deletion.
- Create campaigns and line items paused, then verify configuration before activation.
- Reuse the same client request ID only when retrying the same create after an uncertain response; use a new ID for a genuinely new entity.
- Treat optimization-event changes as learning resets and say so before approval.
- Resolve targeting names to platform IDs before applying criteria; preserve unrelated targeting unless the user approved a full replacement.
- After an approved mutation, use the returned before/after evidence or a fresh read to confirm the resulting state. Report partial failures plainly.

Finish with the confirmed action, observation window, success metric, and rollback trigger. A proposal remains `ready_for_review`; call it `published` only after the live connector confirms it.
