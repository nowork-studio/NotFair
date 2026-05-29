# Repeatable Optimization Loops

This reference turns the generalized paid-search patterns in `../../shared/ppc-optimization-pattern-playbook.md` plus NotFair/Tong operating patterns into reusable Google Ads workflows. Use it when the user asks for recurring improvement, daily/weekly checks, campaign cleanup, or "what should I do next?"

Core principle: **diagnose the bottleneck before changing the account.** Most failed optimizations come from treating symptoms — low conversions, high CPA, limited spend — without separating measurement, query quality, rank, budget, ad message, and landing-page fit.

---

## Loop 1 — Daily / recent-day keyword and search-term check

Use for: "check today's keyword", "what spent today", "overview and proposal", small-account monitoring, post-change watch.

### Pull once

Use one `runScript` / `gaqlParallel` pass. Include:

- Campaign metrics for today, yesterday, 7d, and 30d.
- Keyword metrics for the active/recent day.
- Search terms for the active/recent day.
- Campaign budgets, bidding strategy, search lost IS budget/rank, top IS / absolute top IS where available.
- Recent NotFair `getChanges` or Google `change_event` for context.

### Interpret

Report in this order:

1. **Evaluated** — spend, clicks, impressions, conversions, avg CPC, CTR, and whether the campaign is enabled/serving.
2. **Changed** — what was changed recently, or "nothing today".
3. **Saw** — 1–3 concrete search-term / keyword observations.
4. **Proposal** — either a small action or "no change proposed yet".

### Decision rules

- Thin data: if the day has <3 clicks or expected conversions <1, do not overfit. Say what you are watching for.
- Query quality problem: propose negatives only for clearly irrelevant terms or repeated expensive bad patterns.
- Clean traffic but no conversions: check landing page / form / tracking before touching bids.
- Rank-limited and far under budget: prioritize ad relevance, Quality Score, landing-page message match, and bid competitiveness; do not recommend more budget.
- Budget-limited with good CPA: budget increase can be reasonable, but first verify marginal query quality and search partners.

Tong-facing output should be short, like an operator note — not a full audit.

---

## Loop 2 — Search-term → n-gram → action buckets

Use for: wasted spend, add negatives, broad match cleanup, low conversion quality, PMax/Search overlap.

### Pull once

Search term data for 30–90 days by campaign/ad group/network:

- search term, campaign/ad group, keyword where available
- cost, clicks, impressions, conversions, conversion value
- network segment if available
- campaign type / bidding strategy

### Aggregate

Inside the script, tokenize search terms into 1-, 2-, and 3-grams. For each n-gram capture:

- total cost, clicks, impressions, conversions, CPA / ROAS
- distinct search terms, campaigns, ad groups
- example queries by spend
- whether the n-gram appears in existing positives or negatives

### Action buckets

Do not output one raw list. Classify:

1. **Negative candidates** — irrelevant intent, wrong geography, job seeker, DIY/info, free/cheap when not offered, competitor/name-seeking when not intentionally conquesting.
2. **Keyword candidates** — converting search terms not present as exact/phrase positives.
3. **Routing candidates** — same query/n-gram served by multiple ad groups with materially different CPA/CVR.
4. **Ad / landing-page mismatch** — relevant query, poor performance, weak message match or QS component.
5. **Product / content opportunity** — repeated relevant demand the business does not currently target or sell.

### Safeguards

- Never negative a brand/protected/core service term without explicit user confirmation.
- Check positive-keyword and high-value search-term conflicts before adding negatives.
- Prefer shared negative lists for universal disqualifiers; use campaign/ad-group negatives for routing.
- Negative match variants matter: plurals, misspellings, and close variants are not as forgiving as positive keywords.
- Treat high-spend/no-conversion n-grams as review triggers, not automatic negatives.

---

## Loop 3 — Budget / impression-share triage

Use for: "raise budget", "limited by budget", "not spending", "more conversions", "rank loss", "why did conversions drop?"

### Pull once

Campaign-level:

- cost, clicks, impressions, conversions, CPA / ROAS for 7d, 30d, and prior comparable window
- daily budget and actual daily spend
- search impression share, lost IS due to budget, lost IS due to rank, top IS, absolute top IS
- bidding strategy, target CPA/ROAS, learning/primary status if available
- search-term quality and network split
- recent changes

### Classify the blocker

- **Budget-constrained:** spend reaches budget and lost IS budget is material.
- **Rank-constrained:** spend is below budget and lost IS rank is material.
- **Demand-constrained:** low impressions with low lost IS; market/search volume is limited.
- **Quality-constrained:** rank loss plus weak QS/ad relevance/LPX.
- **Query-quality constrained:** spend scales into irrelevant/non-converting terms.
- **Tracking-constrained:** conversion signal is broken or inconsistent.

### Recommendation rules

- Lost IS budget near zero → budget increase is unlikely to help.
- Spend far below budget + high rank-lost IS → improve relevance / landing page / bid competitiveness before increasing budget.
- Budget-limited + profitable CPA/ROAS + clean search terms → propose a measured budget increase within guardrails.
- Budget-limited + broad/search-partner waste → clean traffic first; more budget will scale waste.
- PMax overlap can distort Search impression share. Check PMax/Search term overlap before declaring Search demand missing.

---

## Loop 4 — Broad match readiness and containment

Use for: "should we use broad", Google recommendations, scaling a campaign, broad match waste.

### Readiness gate

Broad match is only testable when most of these are true:

- Conversion tracking is trustworthy and primary actions match the business goal.
- The campaign has enough conversion volume for automated bidding to learn.
- Budget can absorb exploration without starving proven exact/phrase terms.
- Landing pages are focused enough that broader query intent still receives a relevant page.
- Existing search-term review cadence and negative/shared-list hygiene exist.
- The campaign is not a very short buying-cycle / tiny-budget / weak-signal account where every bad click hurts.

### Safer rollout

- Prefer experiment or limited ad-group rollout over account-wide broad expansion.
- Pre-build obvious negatives and brand/geography controls.
- Monitor query mix, CPA/ROAS, CTR, CVR, and incremental conversions against exact/phrase baseline.
- Do not assume exact always beats broad; with strong Smart Bidding, broad can sometimes find better converting auctions. Keep what wins on business metrics.

---

## Loop 5 — Conversion tracking integrity before optimization

Use for: first audit, CPA/ROAS seems wrong, Smart Bidding, offline conversions, low-volume client accounts.

Before aggressive bid/budget/keyword decisions, verify:

- At least one relevant primary conversion action is enabled.
- Lead-gen uses one-per-click counting unless there is a clear reason not to.
- Purchase/value accounts have sane values and currency.
- Imported/read-only actions are understood before trying to mutate them.
- Campaign-specific goals do not accidentally optimize for irrelevant actions.
- Duplicate tags/actions are not double-counting.
- Phone, form, and offline conversion coverage matches how leads actually close.

If tracking is materially broken, stop. Fix measurement first; do not optimize bidding on bad signal.

---

## Loop 6 — Small client-account posture

This captures the pattern from CentsIQ-style accounts: expensive clicks, low volume, high need for message match.

- Use exact/phrase and clean query review before broad exploration.
- Do not jump to Smart Bidding or budget increases just because volume is low.
- If spend is far below budget, inspect rank loss and Quality Score before touching budget.
- For high-CPC lead gen, a single bad competitor/info click matters. Daily notes should propose small negatives only when the intent is clearly wrong.
- Landing page clarity and trust can be the highest-leverage change when query intent is clean but clicks do not convert.

---

## Sources

- `../../shared/ppc-optimization-pattern-playbook.md`
- Generalized paid-search operations: n-gram analysis, negative keyword hygiene, broad match readiness, RSA testing, Quality Score, impression share, conversion tracking, Search Partners, landing-page testing, and audit automation patterns.
