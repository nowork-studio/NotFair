# Search-Term Triage

Use this when the user asks to clean keywords/search terms, add negatives, review broad match, or inspect today's traffic quality.

## Contract

Search-term triage produces a small, approval-ready action queue. It must classify each pattern before proposing a write.

## Action buckets

- **Negative candidate** — clearly non-buyer, wrong service, job/training/research/free-template, irrelevant brand/tool, competitor lookup that the advertiser should not buy.
- **Keyword candidate** — relevant converting or high-intent term not already covered by exact/phrase.
- **Routing candidate** — relevant query is serving in the wrong campaign/ad group or landing page.
- **Ad/LP mismatch** — query is relevant but poor CVR/Quality Score suggests the message chain is weak.
- **Watch** — plausible buyer intent with too little data.
- **Winner** — term deserves more budget/coverage once economics are proven.

## Required checks before negatives

1. Aggregate by n-gram/token pattern, not just individual terms.
2. Check whether the term conflicts with any enabled positive keyword or strategic service line.
3. Check match type and scope: campaign-level negative vs shared list vs ad-group negative.
4. Prefer exact/phrase negatives when blocking a narrow leak; broad negatives only for unmistakably bad concepts.
5. Preserve converting terms and high-intent local/service terms unless the user explicitly chooses to stop buying that demand.

## Local-service examples

Usually negative:

- jobs, salary, career, training, course, certification, apprenticeship
- free template, DIY, software-only, calculator-only
- services the business does not sell
- locations outside the service area

Usually watch first:

- `service near me`
- `service city`
- competitor-adjacent terms where intent may still be commercial
- high-CPC local terms with 1–3 clicks and no conversions

Usually promote:

- Service + city/neighborhood terms with conversions.
- Search terms that mirror the best landing-page offer.

## SaaS/Product-led examples

Usually negative:

- free no signup, tutorial, meaning, what is, course, jobs, salary
- unrelated tools/products surfaced by broad match
- generic marketplace/list/directory terms when the product is not a directory

Usually promote:

- product category + named workflow
- named integration + problem
- competitor/integration terms only when landing page and brand framing are clear

## Output shape

```text
Search-term triage — <scope/window>

Waste patterns:
- <n-gram/pattern>: spend/clicks/conversions, recommendation

Approval queue:
1. Add <match type> negative `<term>` at <scope>
   Reason:
   Conflict check:
   Risk:

2. Add exact/phrase keyword `<term>` to <ad group>
   Reason:
   Landing page:
   Risk:

Watch:
- <term/entity> until <threshold>
```

## Anti-patterns

- Adding a negative solely because a term has zero conversions on tiny click volume.
- Blocking a high-value service category because one broad keyword is noisy.
- Adding broad negatives without checking conflicts.
- Mixing recommendations and writes in the same step without explicit approval.
