# Safe Executor

Use this pattern for every Google Ads write. It is the gatekeeper between recommendations and mutations.

## Contract

Before any write:

- Verify actor, account, campaign/ad group/ad/keyword target, scope, and blast radius.
- Confirm the exact current state and exact desired state.
- Confirm the user approved the specific write or an explicitly bounded batch.
- Check active experiments; either apply consistently to both arms or require explicit experiment-impact acknowledgement.
- Prefer reversible / low-risk changes first.

After any write:

- Capture `changeId` and tool response.
- Verify the exact changed resource with a fresh read against the relevant resource type.
- Report verified live state, not just the mutation response.
- If verification fails, say the write is unverified/failed and do not claim success.

## Approval text

For approval queues, make the user able to answer with `approve 1`, `approve all low risk`, or `explain 2`.

```text
Needs approval:
1. Add phrase negative `jobs` to Campaign X
   Current state: not present
   Proposed state: campaign-level phrase negative
   Evidence: $42 spend, 0 conv, employment intent
   Risk: low — blocks job-seeker traffic only
   Verification: read campaign negatives after write
```

## Preflight checklist

- Account ID/name resolved.
- Campaign/ad group/ad/criterion IDs resolved.
- Parent statuses are not removed.
- Change does not touch an active experiment unless handled intentionally.
- Guardrails permit the change size.
- Keyword pause/bid/budget changes are within user-approved blast radius.
- Negative keywords do not conflict with strategic positive intent.
- RSA updates include complete headline/description replacement if required by the tool.

## Verification checklist

Use the narrowest read that proves the state:

- Negative keyword write → read campaign/ad-group/shared-set negatives.
- Positive keyword add/pause → read `keyword_view` / `listKeywords` for criterion status and match type.
- Bid/budget write → read campaign/ad group/keyword bidding field.
- RSA update → read `ad_group_ad` responsive search ad assets.
- Asset link/unlink → read asset links.
- Experiment schedule/promote → call async error list after the long-running operation.

## Failure handling

- A NotFair `changeId` for a failed operation is an attempted-change log, not proof of Google acceptance.
- Preserve Google request IDs, enum names, and partial-failure details when available.
- Compare nearby successful writes to distinguish account auth, tool routing, resource policy, and request-shape problems.
- Use dry-run / validate-only probes when available before retrying a risky mutation.
- File internal NotFair tool feedback when the tool returns misleading success semantics or an unhelpful error surface.

## Anti-patterns

- Saying "done" before a live read verifies the state.
- Treating all `authorization_error=7` as global auth failure when other write types succeeded.
- Retrying the same failed mutation repeatedly without changing hypothesis.
- Hiding partial failures in a bulk operation.
