# PPC Optimization Pattern Playbook for NotFair Skills

Research date: 2026-05-29  
Scope: generalized paid-search operating patterns distilled into reusable Google Ads workflows for NotFair skills.

## 1) Pattern inventory overview

- Coverage: search term management, n-grams, negatives, broad match, RSA/ad testing, Quality Score, bidding/budgets/impression share, conversion tracking, Search Partners, account audits, assets, landing pages, and PMax/Search overlap.
- Most reusable pattern families:
  - Search term + n-gram mining for negatives, new keywords, ad-group routing, and product/content insights.
  - Negative keyword hygiene: inconsistent coverage, conflicts, malformed terms, root-word negatives, and shared-list governance.
  - Broad match readiness and containment: only use when measurement, bidding, budgets, landing pages, and search-term review can support wider matching.
  - RSA testing: test business outcomes, not just Google ad strength/CTR; control ad-group granularity and pinning where message-to-query alignment matters.
  - Quality Score diagnosis: break down expected CTR, ad relevance, and landing-page experience; interpret trends with changes in ads, landing pages, targeting, budgets, and broad match expansion.
  - Impression share and budget/rank triage: separate lost IS due to budget from lost IS due to rank, then map to budget, bid, quality, asset, and targeting interventions.
  - Conversion tracking audit: validate action consistency before trusting automated bidding, ad tests, negative decisions, or budget scaling.
  - Search Partners evaluation: segment by network, compare profitability and search-term quality, then disable or split/monitor when partner traffic diverges.
  - Audit automation: automate deterministic checks first, escalate judgment-heavy findings with evidence and likely financial impact.
  - Landing-page experience and ad/LP testing: align message, trust, navigation, speed, and conversion action; test full message chains when ad and page interact.

## 2) Top repeatable patterns

1. **Aggregate before judging sparse queries**
   - Individual search terms often lack enough clicks for decisions. Roll up one-, two-, and three-token n-grams across queries, then sort by spend, clicks, conversions, CPA/ROAS, bounce-like engagement if available, and campaign/ad-group distribution.
   - Default candidate filters: `conversions = 0` sorted by cost; or high-click/no-conversion terms (example threshold: clicks > 150). Treat these as review triggers, not automatic negatives.

2. **Classify bad search terms by action, not just performance**
   - Irrelevant intent -> add negative keyword.
   - Relevant but wrong ad group/campaign -> add exact/phrase keyword to correct group and/or negative-route from wrong group.
   - Relevant but poor message fit -> rewrite RSA/landing page or split ad group.
   - Repeated relevant demand not sold/offered -> flag product/service/content opportunity.

3. **Use negatives as steering controls for automation**
   - Smart bidding and looser match types can keep spending on poor intent even after lots of clicks. Negatives are how the manager constrains the machine.
   - Watch question words, research phrases, consumer-vs-B2B modifiers, jobs/free/DIY, geography mismatch, and duplicated search terms served from lower-converting ad groups.

4. **Govern negative keyword scope deliberately**
   - Account-wide disqualifiers belong in shared negative lists linked consistently to campaigns.
   - Campaign/ad-group negatives should be reserved for routing, brand/non-brand separation, or product-line differences.
   - Audit for conflicts where a negative blocks a positive keyword or high-value search term.
   - Remember negative match types are not the same as positives: plurals/misspellings often require explicit variants.

5. **Broad match requires a readiness gate**
   - Before adding broad match, confirm conversion tracking is trustworthy, search-term management cadence exists, landing pages are focused, budget can absorb exploration, and bidding strategy fits the data volume/risk.
   - Prefer broad match for longer buying journeys or when smart bidding has meaningful conversion data; be cautious for short buying cycles, dynamic pages, broad service-list pages, low budgets, or weak conversion signals.
   - Do not assume exact always beats broad: if broad match plus smart bidding converts better because it can use unseen user-journey signals, keep broad and use exact selectively.

6. **Budget increases need opportunity proof**
   - If lost IS due to budget is near 0%, more budget is unlikely to add meaningful traffic.
   - If budget is capped, forecast incremental spend/conversions using lost IS, recent CPA/ROAS, and marginal query quality. New budget can be absorbed by worse broad-match inventory, search partners, cannibalization, or operational bottlenecks.
   - Increasing budget without negative/search-term controls can scale waste.

7. **Rank loss has four common levers**
   - Quality Score/ad relevance/landing page changes.
   - Bid or target changes, including forgotten bid adjustments after strategy changes.
   - Targeting/match-type expansion changing auction mix.
   - Asset coverage and expected impact.

8. **Diagnose conversions as traffic × conversion rate**
   - Conversion change comes from click volume change, conversion-rate change, or both.
   - Isolate by campaign/ad group/device/network/search term/landing page/date, compare year-over-year seasonality, and overlay recent account changes.

9. **RSA tests should measure the advertiser’s goal**
   - Google may serve RSA assets/combinations based heavily on CTR; the advertiser may care about CVR, CPA, ROAS, conversion per impression, revenue per impression, or profit per impression.
   - Use experiments or structured before/after with enough minimum data. Pause losing RSAs only after the chosen metric has sufficient volume and confounders are checked.

10. **RSA structure matters more than asset volume alone**
   - A broad ad group with many intents can cause Google to mismatch assets to queries. Split ad groups when query intent requires specific copy or landing pages.
   - Ad strength is a diagnostic of Google’s asset diversity expectations, not a final performance objective. Pinning can reduce ad strength but may improve message control.

11. **Quality Score work should be componentized**
   - Expected CTR: compare SERP/message attractiveness and query fit.
   - Ad relevance: ensure query themes appear in ad assets without forcing irrelevant repetition.
   - Landing-page experience: match query/ad promise, improve trust, transparency, navigation, speed, mobile UX, and conversion clarity.
   - Trend patterns matter: cliffs often indicate broken pages/disapprovals/tracking/offer changes; slow declines suggest relevance drift or competitor movement.

12. **Search Partner traffic is a separate diagnostic segment**
   - Compare Google Search vs Search Partners for cost, clicks, conversions, CPA/ROAS, conversion rate, search terms, and brand/non-brand composition.
   - If partners are materially worse and volume is meaningful, disable Search Partners; if better, keep but monitor because site mix is opaque and can shift.

13. **Conversion tracking is a prerequisite, not a postscript**
   - Audit conversion action status, primary/secondary inclusion, attribution/counting consistency, duplicate tags/actions, imported action ownership, values/currencies, phone/form/offline coverage, and campaign-specific goal consistency.
   - Do this before optimizing bids, budgets, negatives, or ad tests.

14. **Landing page tests can be independent or bundled with ads**
   - If testing message chains (e.g., discount vs free shipping), pair ad+LP variants.
   - If testing which ad and which page independently wins, use a full factorial setup: each ad to each page.
   - Geographic/service specificity may improve CTR only, CVR only, or both; measure both.

15. **PMax can obscure Search diagnostics**
   - When PMax serves on overlapping queries, Search impression share and search-term opportunity can look different because eligibility/auction priority shifts.
   - Audit overlap between PMax search terms, Search keywords, and Search search terms; compare CTR/CVR/value and use negatives/keyword coverage/routing where controls exist.

## 3) Recommended NotFair skill modules

### Module A — `search-term-ngram-triage`
- **Primary skill home:** `google-ads/manage`; secondary audit integration.
- **Triggers:** “wasted spend,” “search terms,” “add negatives,” “query analysis,” “low conversions,” broad match cleanup, PMax/Search overlap review.
- **Workflow:**
  1. Pull search terms for 30–90 days by campaign/ad group/network; include cost, clicks, conversions, conversion value, keyword/ad group, and campaign type.
  2. Tokenize terms into 1-, 2-, and 3-grams; aggregate performance and count distinct queries/campaigns/ad groups.
  3. Generate action buckets: negative candidates, keyword/add-to-exact candidates, route-to-better-ad-group candidates, ad/LP mismatch candidates, product/content opportunity candidates.
  4. Apply safeguards: minimum cost/clicks, ignore brand/protected terms unless user confirms, check existing negatives and conflicts, surface examples for each n-gram.
  5. Recommend or execute bulk negatives/keywords only after user approval and experiment-impact checks.
- **Decision rules:** no-conversion high-spend n-grams are review candidates; high-conversion terms missing as keywords are keyword candidates; same query in multiple ad groups with divergent CVR/CPA is routing candidate.
- **Sources:** n-gram posts; search query decisions; negative steering; PMax/Search overlap.

### Module B — `negative-keyword-hygiene`
- **Primary skill home:** `google-ads/manage` and `google-ads/audit`.
- **Triggers:** “negative keyword audit,” “conflicts,” “shared negative list,” “irrelevant searches,” “B2B consumer traffic,” “duplicates.”
- **Workflow:**
  1. Inventory campaign/ad-group negatives and shared lists.
  2. Detect inconsistent campaign coverage for common disqualifiers.
  3. Detect positive-keyword/search-term conflicts.
  4. Detect malformed negatives and missing singular/plural/close variants.
  5. Recommend shared-list consolidation by scope: account-wide, brand/non-brand, product line, geography/routing.
  6. Produce a safe mutation plan: create/link list, add terms, remove conflicts, or move ad-group negatives to list.
- **Decision rules:** use shared lists for universal exclusions; use ad-group negatives for routing; never remove a conflict without confirming the blocked positive/search term is desirable.
- **Sources:** negative primer; common negative problems; steering the machine; n-gram posts.

### Module C — `broad-match-readiness-and-containment`
- **Primary skill home:** `google-ads/manage`.
- **Triggers:** “should I use broad match,” “Google recommends broad,” “pause exact,” “broad match wasted spend,” “scale campaign.”
- **Workflow:**
  1. Confirm conversion tracking health and bid strategy.
  2. Check conversion volume, budget headroom, lost IS, search-term quality, negative coverage, landing-page focus, sales-cycle length, and current exact/phrase winners.
  3. Classify readiness: safe to test, test with guardrails, or do not expand yet.
  4. If testing, create a controlled experiment or limited ad-group rollout; pre-build negatives and monitoring thresholds.
  5. After rollout, compare query mix, CPA/ROAS, CTR, CVR, and incremental conversions; decide whether to keep broad, add exact, or pause exact if broad is better.
- **Decision rules:** broad is riskier with short buying cycles, weak tracking, unfocused/dynamic pages, low budget, and insufficient negatives. Exact is not automatically superior when broad uses valuable journey signals.
- **Sources:** broad-match readiness; when to pause exact; broad match vs CTR/QS; budget scaling article.

### Module D — `rsa-ad-testing-lab`
- **Primary skill home:** `google-ads/copy` and `google-ads/manage`.
- **Triggers:** “test RSAs,” “ad copy underperforming,” “low CTR/CVR,” “ad strength,” “pinning,” “ad group organization.”
- **Workflow:**
  1. Pull RSA assets, asset performance labels if available, ad-level metrics, ad-group query themes, and landing pages.
  2. Identify broad/mixed-intent ad groups where assets cannot match every query theme.
  3. Choose test metric based on business goal: CTR, CVR, CPA, ROAS, conversion per impression, revenue/profit per impression.
  4. Recommend test type: unpinned RSA optimization, pinned message test, theme-vs-theme test, RSA-vs-existing baseline, or ad+LP message-chain test.
  5. Use experiments when possible; otherwise require minimum data and note confounders.
  6. Generate complete RSA replacement assets when mutating; do not rely on ad strength as the winner criterion.
- **Decision rules:** pin when legal/brand/query-message control matters; split ad groups when one RSA contains assets for distinct intents; treat high ad strength as coverage signal, not proof of profitability.
- **Sources:** RSA testing; RSA organization; effective RSAs; ad strength; ad/LP testing.

### Module E — `quality-score-component-diagnosis`
- **Primary skill home:** `google-ads/manage`; landing submodule for LPX.
- **Triggers:** “quality score,” “expected CTR,” “ad relevance,” “landing page experience,” “CPC rose,” “rank lost IS.”
- **Workflow:**
  1. Pull keyword QS components and performance; segment by campaign/ad group/match type.
  2. Bucket issues by component: expected CTR, ad relevance, LP experience.
  3. Overlay recent changes: ads, landing page URL, budgets, bids, targeting, broad-match additions, disapprovals.
  4. For expected CTR/ad relevance: recommend ad group split, RSA copy, keyword-to-ad theme alignment.
  5. For LPX: invoke landing-page checklist (message match, trust, transparency, navigation, mobile/speed, conversion clarity).
  6. Show expected impact as rank/CPA opportunity, not guaranteed QS increase.
- **Decision rules:** do not optimize visible QS in isolation; prioritize high-spend/high-impression keywords with below-average components and material rank/cost impact.
- **Sources:** QS primer/trends; visible vs auction QS; ad relevance; landing-page experience; rank IS diagnostics.

### Module F — `budget-impression-share-triage`
- **Primary skill home:** `google-ads/manage` and `google-ads/audit`.
- **Triggers:** “raise budget,” “limited by budget,” “lost impression share,” “more conversions,” “rank loss,” “top IS changed,” “budget pacing.”
- **Workflow:**
  1. Pull campaign metrics, budgets, spend, lost IS budget, lost IS rank, search/top/absolute top IS, CPA/ROAS, search terms, and recent changes.
  2. Classify blocker: no headroom, budget-constrained, rank-constrained, demand/seasonality shift, targeting/match expansion, quality issue, asset issue, PMax overlap.
  3. For budget-constrained campaigns, estimate incremental spend/conversions from lost IS and marginal CPA/ROAS; flag if current extra traffic is low quality.
  4. For rank-constrained campaigns, check QS components, bids/targets, bid adjustments, assets, and target changes.
  5. Recommend budget increases only for campaigns with headroom and acceptable marginal economics; otherwise reallocate from waste.
- **Decision rules:** lost IS budget near zero -> budget increase unlikely; budget increase with broad match/search partners can degrade marginal efficiency; PMax overlap can make Search IS incomplete.
- **Sources:** impression share analysis; lost IS budget; lost IS rank/top IS; budget changes; more budget same results; PMax IS impact.

### Module G — `conversion-tracking-integrity-audit`
- **Primary skill home:** `google-ads/audit`; prerequisite gate for manage actions.
- **Triggers:** first-time audit, “tracking,” “conversions look wrong,” “smart bidding,” “CPA/ROAS unreliable,” “offline conversions.”
- **Workflow:**
  1. Inventory conversion actions: type, status, category, primary flag, owner, counting type, attribution, value/currency, ECFL/offline/call coverage where available.
  2. Compare campaign goal settings and included actions for consistency.
  3. Flag duplicate actions, missing primary actions, irrelevant primary actions, inconsistent counting/attribution, imported/read-only actions, missing values/currencies, and suspicious zero/huge conversion patterns.
  4. Before bid/budget optimization, summarize whether data is trustworthy enough for automated bidding.
- **Decision rules:** if tracking is materially inconsistent, do not make aggressive bid/budget recommendations; fix measurement first.
- **Sources:** conversion tracking mistakes; assisted conversions; audit checklist.

### Module H — `network-partner-evaluator`
- **Primary skill home:** `google-ads/manage` and `google-ads/audit`.
- **Triggers:** “search partners,” “network performance,” “bad traffic,” “CPA spike,” “conversion rate changed.”
- **Workflow:**
  1. Segment campaigns by ad network type for Google Search vs Search Partners.
  2. Compare cost, clicks, CTR, CVR, CPA/ROAS, conversion value, and search-term quality.
  3. Identify campaigns where partners are material volume and materially worse/better.
  4. Recommend disabling partners, keeping them, or monitoring with alerts.
- **Decision rules:** disable only when partner traffic is meaningful and worse on the account’s goal metric; avoid conclusions from tiny volume.
- **Sources:** Search Partners evaluation; conversion-change diagnosis; audit checklist.

### Module I — `landing-page-message-match`
- **Primary skill home:** `google-ads/landing`; connected to copy/manage experiments.
- **Triggers:** “landing page experience,” “LPX below average,” “conversion rate dropped,” “test landing pages,” “message match.”
- **Workflow:**
  1. Map keyword/search-term themes -> RSA claims -> final URLs.
  2. Score message match, offer consistency, trust/transparency, navigation, page speed/mobile usability, and conversion-action clarity.
  3. Decide test design: ad-only, LP-only, paired message-chain, or full factorial ad×LP.
  4. Recommend page variants and experiment setup; track CTR and CVR separately.
- **Decision rules:** if CTR improves but CVR does not, landing page may not reinforce the ad promise; if CVR improves only for local pages, scale by geography/service carefully.
- **Sources:** landing-page experience; 10 LP steps; ad+LP testing posts.

### Module J — `automated-audit-orchestrator`
- **Primary skill home:** `google-ads/audit`.
- **Triggers:** “audit account,” “health check,” “what’s broken,” “quick wins,” recurring monitoring.
- **Workflow:**
  1. Run deterministic checks first: disapprovals, broken/final URLs, paused/limited entities, missing assets, missing conversion actions, negative conflicts, budget/rank lost IS, search-term waste, zero-conversion spend, landing-page issues, PMax overlap.
  2. Group findings by financial impact and actionability.
  3. Separate safe automated fixes from recommendations requiring business judgment.
  4. Produce a prioritized action plan with source metric, evidence, suggested mutation, risk, and expected direction.
- **Decision rules:** audits should translate findings into likely spend/revenue impact; automate repeatable scans but keep human confirmation for brand, legal, and strategic exclusions.
- **Sources:** ultimate audit checklist; audit automation; asset audit; conversion tracking; all diagnostic modules above.
