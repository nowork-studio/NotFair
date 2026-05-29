# Search Term Analysis Guide

Systematic framework for interpreting search term reports, mining keywords, building negative keyword lists, and maximizing paid search relevance. Every recommendation includes concrete thresholds and actionable workflows.

---

## Match Type Behavior Reference

Understanding what Google actually matches to each match type is the foundation of search term analysis.

### Match Type Definitions (Current Behavior, 2025-2026)

| Match Type | Syntax | What It Matches | Example Keyword | Example Matched Queries |
|-----------|--------|----------------|-----------------|------------------------|
| **Broad Match** | `keyword` | Themes, intent, related concepts; uses AI to determine relevance | `plumber services` | "plumber near me", "fix leaky faucet", "emergency pipe repair", "plumbing contractor reviews" |
| **Phrase Match** | `"keyword"` | Queries that include the meaning of the keyword; word order matters for meaning. In practice, semantic overlap with Broad match is nearly complete in most verticals (2025-2026). | `"plumber services"` | "plumber services near me", "affordable plumber services in austin", "residential plumber services" |
| **Exact Match** | `[keyword]` | Queries that match the exact meaning including close variants | `[plumber services]` | "plumber services", "plumber service", "plumbing services", "services plumber" |

> **Note (2026):** Phrase and Broad match overlap is nearly 100% in many verticals. Running both on the same keyword is redundant. In most cases, choose one: Broad with Smart Bidding for maximum reach, or Exact for maximum control. Adding Phrase match alongside Broad rarely changes which queries you match.

### Close Variants (All Match Types)

Google applies close variants to ALL match types. These include:

| Close Variant Type | Example Keyword | Matched Query | Risk Level |
|-------------------|-----------------|---------------|------------|
| Misspellings | `plumber` | "plumer", "plummber" | Low — usually helpful |
| Singular / Plural | `running shoe` | "running shoes" | Low — usually helpful |
| Stemming | `running` | "run", "runner" | Low-Medium — check intent |
| Abbreviations | `california` | "CA", "calif" | Low — usually helpful |
| Accents | `cafe` | "cafe" | Low — usually helpful |
| Implied words | `daytime tv` | "tv shows during the day" | Medium — may shift intent |
| Synonyms | `cheap hotels` | "affordable hotels", "budget hotels" | Medium — check relevance |
| Paraphrases | `how to fix a faucet` | "faucet repair steps" | Medium — usually OK |
| **Same intent (broad)** | `plumber services` | "fix leaky pipe" | **High — can be very far from keyword** |

### Close Variant Gotchas

| Gotcha | Example | Impact | Mitigation |
|--------|---------|--------|------------|
| Google matches exact match to synonyms you didn't intend | `[luxury hotel]` matches "5 star resort" | May not match your landing page | Add exact negative `[5 star resort]` if landing page is hotel-specific |
| Broad match picks up tangentially related queries | `plumber` matches "DIY pipe repair youtube" | Wasted spend on informational, non-commercial queries | Add negative keywords: "DIY", "youtube", "how to" |
| Phrase match reorders words when Google determines same meaning | `"new york plumber"` matches "plumber in new york" | Usually fine, but check | Monitor search terms weekly |
| Exact match singular/plural shifts intent | `[glass]` matches "glasses" (eyewear vs. material) | Completely different intent | Add negative `[glasses]` if selling glass material |

---

## Relevance Scoring Framework

Score every search term on a 1-5 scale to prioritize actions.

| Score | Label | Definition | Example (for keyword "emergency plumber") | Action |
|-------|-------|------------|-------------------------------------------|--------|
| **5** | Perfect Match | Query exactly matches keyword intent and is high-converting | "emergency plumber near me" | Add as keyword if not already targeted |
| **4** | Strong Relevant | Related to keyword, clear commercial intent, likely converter | "24 hour plumber service" | Add as keyword if 2+ conversions |
| **3** | Moderately Relevant | Related but broader intent or lower purchase signals | "plumber cost estimate" | Monitor; add as keyword if converting consistently |
| **2** | Weakly Relevant | Tangentially related; unlikely to convert at acceptable CPA | "plumber salary", "plumber apprenticeship" | Add as negative if 10+ clicks with zero conversions |
| **1** | Irrelevant | No relation to business or search intent | "mario plumber game", "plumber meme" | Add as negative immediately |

---

## Search Term Mining Workflow

### Decision Rules

```
FOR EACH search term in the report:
|
+-- Has 3+ conversions at acceptable CPA?
|   YES --> Add as keyword (exact match) in the most relevant ad group
|   NO  --> Continue evaluation
|
+-- Has 10+ clicks with 0 conversions?
|   YES --> Add as negative keyword (exact negative if one bad term;
|           phrase negative if a pattern)
|   NO  --> Continue evaluation
|
+-- Has 50+ impressions with 0 clicks?
|   YES --> Check: is the ad relevant to this query?
|   |   Ad is relevant --> Query may be too broad/informational; monitor
|   |   Ad is NOT relevant --> Likely in wrong ad group; check keyword/ad group mapping
|   NO  --> Continue evaluation
|
+-- Has 1-2 conversions at acceptable CPA?
|   YES --> Monitor for 30 more days; add as keyword if conversions continue
|   NO  --> Continue evaluation
|
+-- Relevance score 1-2?
    YES --> Add as negative even without click data (proactive hygiene)
    NO  --> No action needed; review again next period
```

### Mining Frequency

| Account Spend | Review Frequency | Minimum Data Window |
|--------------|-----------------|---------------------|
| < $1,000/month | Monthly | 30 days |
| $1,000-$5,000/month | Bi-weekly | 14 days |
| $5,000-$20,000/month | Weekly | 7 days |
| > $20,000/month | Twice weekly | 3-7 days |

---

## Important: Negatives Are Now a Supplementary Layer (2026)

Traditional negative keyword lists remain useful but are no longer the primary lever for query control. Several Google Ads changes have reduced their precision:

- **Brand Exclusions**: Campaign-level brand exclusion lists (launched 2023, expanded 2024-2025) are now the recommended way to block competitor or irrelevant brand traffic. They work at the brand-entity level, not the keyword level, so they catch variations that keyword negatives miss.
- **Account-Level Suitability Settings**: Google's account-level content suitability and brand safety controls filter categories of queries before negative keywords are even evaluated. Check these settings before building extensive negative lists.
- **Search Themes (Performance Max / Broad Match)**: Google's AI-driven query expansion (Search Themes in PMax, and Broad match's intent matching) can serve ads on queries that don't contain any of your keyword text. Negative keywords only block queries containing the negative term literally — they cannot block conceptually related queries that the AI matches to. This means negative keyword lists give **false confidence** in query control when running Broad match or PMax campaigns.
- **Google's LLM-powered bidding** has real-time signal advantages (device, location, time, audience, query context) that static negative lists cannot replicate. Smart Bidding can effectively "negative out" low-value queries by bidding them down to near-zero, often more precisely than manual negatives.

**Bottom line**: Use negatives for clear-cut exclusions (job seekers, DIY, competitors you don't want to conquest). But don't rely on them as your primary quality control mechanism — Brand Exclusions, suitability settings, and Smart Bidding now carry more of that weight.

---

## Negative Keyword Strategy

### Negative Match Type Selection

| Negative Match Type | Syntax | What It Blocks | When to Use |
|--------------------|--------|---------------|-------------|
| **Negative Broad** | `free` | Any query containing the word "free" in any order | Block a single toxic word across all contexts |
| **Negative Phrase** | `"free plumber"` | Queries containing "free plumber" in that order | Block a specific phrase but allow other uses of individual words |
| **Negative Exact** | `[free plumber near me]` | Only that exact query | Block one specific query without risking over-blocking |

### Negative Match Type Decision Tree

```
Is the word ALWAYS irrelevant regardless of context?
  YES --> Negative broad match (e.g., "free", "jobs", "salary")
  NO  --> Continue

Is the phrase irrelevant but individual words might be OK?
  YES --> Negative phrase match (e.g., "plumber jobs" — "plumber" alone is fine)
  NO  --> Continue

Is only this specific query irrelevant?
  YES --> Negative exact match (e.g., [plumber salary in texas])
```

### Campaign-Level vs. Ad Group-Level Negatives

| Level | When to Use | Example |
|-------|------------|---------|
| **Ad group level** | Block terms from triggering in one ad group but allow in another | "plumber" negative in HVAC ad group; still active in Plumbing ad group |
| **Campaign level** | Block terms from the entire campaign | "jobs" negative at campaign level for all service campaigns |
| **Negative keyword list (shared)** | Block terms across multiple campaigns | Universal exclusion list: "free", "DIY", "salary", "reddit", "youtube" |

### Universal Negative Keyword Lists

Build these shared lists and apply across all campaigns in the account. **Caveat (2026):** These lists are a useful starting point for clear-cut exclusions, but they give false confidence when running Broad match or Performance Max campaigns. Google's Search Themes and AI-driven query expansion can serve ads on conceptually related queries that don't literally contain any of these negative terms. Treat these lists as a supplementary layer, not a complete shield.

#### General Exclusions (Apply to All Commercial Campaigns)

| Category | Negative Keywords | Match Type |
|----------|------------------|------------|
| **Job seekers** | jobs, careers, hiring, salary, pay, wage, resume, indeed, glassdoor, interview | Broad |
| **Education / DIY** | how to, tutorial, DIY, learn, course, class, training, certification, school, university | Broad |
| **Free / cheap seekers** | free, cheap, cheapest, discount code, coupon, promo code, giveaway | Broad |
| **Information seekers** | what is, definition, meaning, wiki, wikipedia, history of | Phrase |
| **Social / entertainment** | reddit, youtube, tiktok, pinterest, instagram, forum, meme, video | Broad |
| **Complaints / reviews** | complaint, scam, lawsuit, ripoff, BBB, better business bureau | Broad |

#### Industry-Specific Exclusion Patterns

| Industry | Additional Negatives | Rationale |
|----------|---------------------|-----------|
| **Legal** | "pro bono", "legal aid", "free consultation" (if not offered), "law school" | Filters out non-paying prospects |
| **Home Services** | "DIY", "home depot", "lowes", "parts", "tools" | Filters out DIYers who won't hire |
| **SaaS** | "open source", "free alternative", "github", "self-hosted" | Filters out non-buyers |
| **Healthcare** | "symptoms", "webmd", "home remedy", "natural cure" | Filters out info-seekers |
| **E-commerce** | "used", "refurbished", "craigslist", "ebay", "amazon" (if not selling there) | Filters out bargain hunters and marketplace traffic |
| **Real Estate** | "zillow", "trulia", "rent", "section 8" (if selling, not renting) | Filters out renters and portal users |
| **Education** | "free", "scholarship", "financial aid" (if paid-only programs) | Filters out non-paying students |
| **Finance** | "calculator", "formula", "excel template", "reddit" | Filters out DIY finance people |

---

## N-gram Analysis Framework

N-gram analysis identifies recurring word patterns in search terms to find systematic waste or opportunity.

### How to Run N-gram Analysis

1. Export search term report (last 30-90 days)
2. Split each search term into individual words (unigrams), word pairs (bigrams), and three-word phrases (trigrams)
3. Aggregate clicks, cost, impressions, conversions, conversion value, distinct queries, campaigns, and ad groups by each n-gram
4. Sort by cost descending to find the most expensive patterns
5. Classify each pattern into an action bucket before recommending a mutation

### Generalized Action Buckets

| Bucket | Signal | Action |
|--------|--------|--------|
| Negative candidate | Irrelevant intent, wrong geography, job seeker, DIY/info, free/cheap when not offered, unwanted competitor/name-seeking | Add negative after checking positive/search-term conflicts |
| Keyword candidate | Converting query/n-gram not present as a positive keyword | Add as exact or phrase in the most relevant ad group |
| Routing candidate | Same query/n-gram served by multiple ad groups with divergent CPA/CVR | Add keyword to the best-fit ad group and negative-route from the wrong group |
| Ad/LP mismatch | Relevant query, poor performance, weak ad relevance or LPX | Rewrite RSA, split ad group, or improve landing page message match |
| Product/content opportunity | Repeated relevant demand not currently targeted or sold | Flag opportunity; do not negative unless business confirms it is unwanted |

High-spend/no-conversion n-grams are review triggers, not automatic negatives. Always inspect examples.

### Common High-Waste N-grams (Cross-Industry)

| N-gram | Typical Waste Signal | Action |
|--------|---------------------|--------|
| "free" | High clicks, near-zero conversions | Add as broad negative |
| "jobs" / "careers" | Job seekers, not customers | Add as broad negative |
| "salary" / "pay" | Job seekers | Add as broad negative |
| "DIY" | Will not hire/buy | Add as broad negative |
| "reddit" | Looking for opinions, not buying | Add as broad negative |
| "youtube" | Looking for video content | Add as broad negative |
| "near me" | High intent if local business; irrelevant if not | Keep if local; negative if not local |
| "reviews" | Can be high intent (commercial investigation) | Keep; optimize landing page |
| "vs" / "versus" | Comparison shoppers; moderate intent | Keep; ensure comparison content on LP |
| "best" | High commercial intent | Keep; prioritize in ad copy |
| "how to" | Informational intent; low conversion | Add as phrase negative for commercial campaigns |
| "what is" | Pure informational | Add as phrase negative |
| "cost" / "price" / "pricing" | High commercial intent — ready to buy | Keep; ensure pricing info on LP |

---

## Search Term Categorization Framework

Categorize search terms by intent to determine campaign-level strategy.

| Category | Signal Words | Conversion Likelihood | Campaign Strategy |
|----------|-------------|----------------------|-------------------|
| **High-Intent Commercial** | buy, hire, cost, price, near me, quote, book, order, best + [product] | High (5-15% conv rate) | Bid aggressively; dedicated ad groups; specific landing pages |
| **Comparison / Evaluation** | vs, compare, review, alternative, top, best + [category] | Medium (2-5% conv rate) | Moderate bids; comparison landing pages; remarketing |
| **Informational** | how to, what is, why, guide, tutorial, tips | Low (0.5-2% conv rate) | Low bids or exclude; content marketing channel instead |
| **Navigational** | [brand name], [competitor name], login, website | Variable | Own brand: bid high. Competitor: moderate bid with competitor LP |
| **Irrelevant** | jobs, salary, free, DIY, meme, youtube | Near zero | Add as negative immediately |

---

## Search Term Report Analysis Cadence

| Time Period | Analysis Task | Key Questions |
|------------|--------------|---------------|
| **Weekly** | Review top 50 search terms by spend | Any new irrelevant terms burning budget? |
| **Weekly** | Check terms with 10+ clicks, 0 conversions | Are these terms worth continued investment? |
| **Bi-weekly** | Mine converting search terms | Any new terms with 3+ conversions to add as keywords? |
| **Monthly** | Full n-gram analysis | Any systematic waste patterns? New negative keyword lists needed? |
| **Monthly** | Review negative keyword lists | Any over-blocking (negatives killing good traffic)? |
| **Quarterly** | Match type performance audit | Are broad match terms converting at acceptable CPA? Should any be tightened to phrase/exact? |

### Match Type Performance Evaluation

| Match Type | Acceptable CPA vs. Account Avg | Action if CPA Exceeds Threshold |
|-----------|-------------------------------|-------------------------------|
| Exact Match | CPA <= 100% of account average | This is your baseline; if even exact is too expensive, the keyword itself is the problem |
| Phrase Match | CPA <= 130% of account average | Review search terms; add negatives for irrelevant phrase matches |
| Broad Match | CPA <= 160% of account average | Review search terms aggressively; consider tightening to phrase; ensure smart bidding is active |

**Rule**: If broad match CPA is > 200% of exact match CPA for the same keyword, review search terms and add negatives or Brand Exclusions. Switching to Phrase match is unlikely to help given the near-complete semantic overlap between Phrase and Broad in most verticals (2026). Instead, ensure Smart Bidding (tCPA or tROAS) is active — Google's LLM bidding has real-time signal advantages that adjust bids per query more precisely than match type restrictions. If CPA remains unacceptable after negative refinement and Smart Bidding, consider pausing the broad match variant and running exact match only.

---

## Wasted Spend Audit

### Calculating Wasted Spend

```
Wasted spend = Cost from search terms with Relevance Score 1-2
             + Cost from search terms with 15+ clicks and 0 conversions
             - Cost from those terms that generated assisted conversions

Healthy account: Wasted spend < 10% of total spend
Needs work:      Wasted spend 10-20% of total spend
Critical:        Wasted spend > 20% of total spend
```

### Top Wasted Spend Patterns

| Pattern | How to Identify | Fix |
|---------|----------------|-----|
| Broad match runaway | High spend, low relevance search terms, mostly from broad match keywords | Add negatives and Brand Exclusions; ensure Smart Bidding is active; if CPA remains unacceptable, switch to exact match only |
| Wrong-intent matches | Commercial keyword matching to informational queries | Add informational signal words as negatives |
| Competitor term leakage | Your ads showing for competitor brand names (unintentionally) | Add competitor names as exact negatives (unless conquesting) |
| Geographic mismatch | Queries from locations you don't serve | Tighten location targeting; add location negatives |
| Language mismatch | Queries in languages you don't serve | Check campaign language settings |
