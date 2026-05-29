# Intervention Memory

Use this whenever the agent recommends or executes a material Google Ads change. The goal is to make future reviews measurable instead of anecdotal.

## Intervention record

Store or report enough detail for a future 3/7/14-day review:

```json
{
  "id": "<stable id or changeId group>",
  "created_at": "<ISO>",
  "account_id": "<account>",
  "scope": { "campaign_id": "", "ad_group_id": "", "entity_ids": [] },
  "change_type": "negative_keyword | keyword_add | keyword_pause | bid | budget | ad_copy | landing_page | conversion_tracking | schedule | experiment",
  "summary": "<human summary>",
  "hypothesis": "<what should improve and why>",
  "success_metric": "<CPA, CVR, waste spend, lead quality, QS, etc.>",
  "guardrail_metric": "<what must not degrade>",
  "baseline_window": "<date range>",
  "review_after_days": [3, 7, 14],
  "approval_source": "<chat/manual/standing rule>",
  "change_ids": [],
  "verification": "<verified live state>",
  "status": "watching"
}
```

Prefer NotFair server-side change/intervention surfaces when available:

- `getChanges`
- `listChangeInterventions`
- `getChangeIntervention`
- `evaluateChangeIntervention`
- `reviewChangeImpact`

If the environment lacks durable intervention storage, include the record in the session report and recommend persisting it before scheduling automated reviews.

## Review protocol

At review time:

1. Pull before/after metrics for the same scope.
2. Normalize to rates where volume changed: CPA, CVR, CTR, CPC, waste-spend share.
3. Check confounders: other changes, budget shifts, seasonality, tracking edits.
4. Classify verdict:
   - likely positive
   - likely negative
   - neutral/inconclusive
   - too new / insufficient data
5. Decide: keep, revert, iterate, or extend watch.

## Output shape

```text
Impact review — <change>
Verdict: likely positive / inconclusive / negative

Baseline: <window>
After: <window>
Metric movement:
- CPA:
- Waste spend:
- Conversions:
- Guardrail:

Confounders:
Decision:
```

## Anti-patterns

- Reviewing raw spend without denominators.
- Calling a change successful when conversion volume is too low.
- Ignoring other edits in the same campaign during the window.
- Forgetting to define success before making the change.
