# SEO Best Practices Reference

This is the shared reference for Toprank SEO operators. Use it to keep recommendations grounded in durable SEO principles rather than one-off heuristics.

## Primary resources

1. **Google Search Central — SEO Starter Guide**  
   https://developers.google.com/search/docs/fundamentals/seo-starter-guide  
   Best for: crawl/index basics, site organization, descriptive URLs, titles, snippets, links, images, and measuring impact over weeks/months.

2. **Google Search Essentials**  
   https://developers.google.com/search/docs/essentials  
   Best for: eligibility, technical requirements, spam boundaries, helpful content, crawlable links, prominent keyword placement, and Search appearance basics.

3. **Google — Creating Helpful, Reliable, People-First Content**  
   https://developers.google.com/search/docs/fundamentals/creating-helpful-content  
   Best for: content quality, originality, usefulness, first-hand expertise, E-E-A-T, and avoiding search-engine-first content.

4. **Google — Page Experience**  
   https://developers.google.com/search/docs/appearance/page-experience  
   Best for: Core Web Vitals, HTTPS, mobile usability, intrusive interstitials, main-content clarity, and overall UX.

5. **Google — Structured Data Introduction**  
   https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data  
   Best for: JSON-LD, rich results, validation, and giving explicit machine-readable clues about page meaning.

6. **Google Business Profile Help — Local Ranking**  
   https://support.google.com/business/answer/7091  
   Best for: local ranking factors: relevance, distance, prominence; complete business info; reviews; photos/videos; hours; categories.

7. **Ahrefs — Beginner’s Guide to SEO**  
   https://ahrefs.com/seo  
   Best for: practical learning path across keyword research, content, on-page SEO, link building, technical SEO, local SEO, and AI search.

8. **Moz — Beginner’s Guide to SEO**  
   https://moz.com/beginners-guide-to-seo  
   Best for: SEO hierarchy: crawl accessibility → content → keyword optimization → UX → links/citations → CTR → schema/snippets.

## MECE improvement framework

Every SEO opportunity should map to exactly one primary improvement lane. A recommendation can mention secondary lanes, but the operator should rank and explain it through one primary lane to avoid muddled actions.

### 1. Search eligibility & indexability

**Goal:** Google can discover, crawl, render, canonicalize, and index the right URLs.

Includes:
- robots directives, noindex, canonical tags, redirects
- sitemap and internal discoverability
- crawlable links
- duplicate URL consolidation
- JavaScript/rendering visibility

Typical actions:
- fix blocked/uncrawlable pages
- consolidate duplicate URLs
- repair canonical/redirect mistakes
- submit or refresh sitemap

Do not confuse with: content quality. If Google cannot reliably access the page, content optimization is premature.

### 2. Demand & intent targeting

**Goal:** Choose the search demand worth winning, based on business value and searcher intent.

Includes:
- keyword/query research
- brand vs non-brand split
- local/commercial/research/informational intent classification
- priority services, locations, customers, and conversion events
- query-to-page ownership

Typical actions:
- identify high-value query clusters
- map queries to transactional vs supporting pages
- demote low-value national informational traffic when local bookings are the goal
- choose the one page that should own each intent

Do not confuse with: SERP packaging. First decide whether the query is worth winning and which page should win it.

### 3. Content usefulness & trust

**Goal:** The page gives users a satisfying answer and demonstrates credible experience/expertise.

Includes:
- original useful information, not commodity rewrites
- completeness relative to the SERP
- first-hand proof, examples, reviews, local details, pricing context
- author/site trust signals where relevant
- freshness only when substance changes

Typical actions:
- add missing information users need to decide
- replace generic copy with specific proof
- add comparison, pricing, process, FAQs, or service-area details when useful
- prune or merge thin/duplicative content

Do not confuse with: metadata. If the page itself does not satisfy intent, title tweaks are lipstick.

### 4. On-page relevance & SERP packaging

**Goal:** Searchers and search engines can quickly understand why this page is the right result.

Includes:
- title, H1, meta description, headings
- above-the-fold answer clarity
- internal anchor text
- image alt text where useful
- structured data/rich-result eligibility
- snippet and CTR diagnostics

Typical actions:
- rewrite title/meta/H1 for the actual query intent
- add fast answer blocks or CTAs above the fold
- improve internal anchors to the target page
- add valid JSON-LD only when content is visible and eligible

Do not confuse with: demand selection. Metadata improvements matter only after the target query/page pairing is correct.

### 5. Technical UX & page experience

**Goal:** The page is fast, secure, mobile-friendly, and usable enough that experience does not suppress performance.

Includes:
- Core Web Vitals
- HTTPS
- mobile usability/responsive layout
- intrusive interstitials/dialogs
- ad or layout clutter
- main-content clarity

Typical actions:
- improve LCP/INP/CLS bottlenecks
- remove intrusive blockers
- fix mobile layout issues
- make primary content and CTA obvious

Do not confuse with: ranking magic. Perfect Lighthouse scores do not compensate for weak intent/content.

### 6. Authority & distribution

**Goal:** Earn enough off-page and internal authority for competitive terms.

Includes:
- backlinks and mentions
- citations/directories where relevant
- internal link equity
- promotion in relevant communities
- reputation signals that users and search engines can corroborate

Typical actions:
- build internal links from relevant high-authority pages
- earn local citations or editorial mentions
- promote genuinely useful assets
- fix orphaned important pages

Do not confuse with: spammy link building. Authority work should be reputation-building, not manipulation.

### 7. Local presence & reputation

**Goal:** For local businesses, win relevant map/local results through complete, trusted, locally specific signals.

Includes:
- Google Business Profile completeness and categories
- NAP, hours, services, photos/videos
- reviews, ratings, and owner responses
- service areas and location pages
- local proof points and prominence

Typical actions:
- complete/update GBP fields
- improve review acquisition/response workflows
- add local proof to service/location pages
- align website pages with priority locations/services

Do not confuse with: generic organic SEO. Local search adds relevance, distance, and prominence constraints.

### 8. Measurement, prioritization & experimentation

**Goal:** Improve business outcomes with evidence, not vanity traffic.

Includes:
- GSC/GA4/CRM conversion measurement
- baselines and holdout/after windows
- normalized metrics: CTR, conversion rate, clicks per impression, leads per organic session
- confidence/sample size
- follow-up checks and learned priors
- approval guardrails

Typical actions:
- define success metric before editing
- create proposal + baseline + follow-up window
- separate regression investigation from publishable edits
- update learned priors after results mature

Do not confuse with: dashboards. Measurement exists to choose and validate actions.

## Operator checklist before proposing an SEO edit

1. **Eligibility:** Can Google access and understand the page? If no, fix lane 1 first.
2. **Intent:** Is this query/page worth winning for the business? If unclear, ask for business context or map query ownership.
3. **Page fit:** Does the target page actually satisfy the intent? If no, improve/merge/reroute before metadata changes.
4. **SERP fit:** Does the live SERP suggest CTR/snippet packaging, zero-click risk, local pack pressure, or a different content format?
5. **Business value:** What conversion or qualified outcome should improve?
6. **Risk:** Would the change affect production content, redirects, canonicals, CMS, PRs, or metadata? If yes, require approval.
7. **Measurement:** What baseline, success threshold, guardrail, and follow-up date will prove whether it worked?
