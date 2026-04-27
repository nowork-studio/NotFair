# GEO Techniques — Generative Engine Optimization Playbook

Reference for `geo-optimizer`. Derived from:

- **Princeton/GA Tech GEO** (KDD 2024, arXiv:2311.09735) — the 9 methods,
  PAWC metric, GPT-3.5 / Perplexity validation
- **AutoGEO** (CMU, ICLR 2026) — automated rewriting, GRPO training,
  utility-preserving rewrite rules
- **C-SEO Bench** (NeurIPS 2025) — competitive baseline, what survives at scale
- **CORE-EEAT / CITE** (community frameworks) — operational checklists

---

## Table of Contents

1. [Core Principles](#core-principles)
2. [The GEO Signal Stack](#the-geo-signal-stack)
3. [Audit Scoring](#audit-scoring)
4. [Rewrite Patterns](#rewrite-patterns)
5. [Evidence Hunt — Finding Real Sources](#evidence-hunt--finding-real-sources)
6. [Per-Engine Playbooks](#per-engine-playbooks)
7. [AI Crawlability](#ai-crawlability)
8. [Anti-Patterns](#anti-patterns)
9. [Measurement](#measurement)

---

## Core Principles

### 1. PAWC drives everything

Position-Adjusted Word Count is the metric the Princeton paper proved
correlates with AI citation:

```
Imp_pwc(c, r) = Σ |sentence| · e^(-pos/total)  /  total_words
```

The exponential decay is the key: **sentence #1 of the AI's answer is
worth ~5× sentence #20.** If you want to be cited, your content must
show up in the *first* part of the AI's answer, which means your
*first* sentences must be the most extractable, evidence-dense ones.

### 2. Evidence density > keyword density

Princeton's empirical ranking of techniques by visibility lift:

| Rank | Technique | PAWC lift |
|------|-----------|-----------|
| 1 | Quotation Addition | +41% |
| 2 | Statistics Addition | +30% |
| 3 | Cite Sources | +28% |
| 3 | Fluency Optimization | +28% |
| 5 | Technical Terms | +18% |
| 6 | Easy-to-Understand | +14% |
| 7 | Authoritative tone | +10% |
| 8 | Unique Words | +6% |
| 9 | **Keyword Stuffing** | **−8%** (hurts) |

Best combo: **Fluency + Statistics** (≥+35%, beats any single technique).

### 3. Generative engines don't use PageRank

This is the democratization finding from the Princeton GEO paper
(arXiv:2311.09735, Table 2): rank-5 sites gained ~+115% visibility with
the Cite Sources method while rank-1 sites *lost* ~30%, averaged across
their multi-domain experiment. Numbers are representative of the paper's
test setup, not a universal guarantee. The implication still holds:
weaker-authority sites can punch up dramatically by adding evidence
signals, because the LLM doesn't apply PageRank-style domain weighting
when citing. **It cares whether your sentence is the most quotable one.**

### 4. Engines diverge

Cross-engine citation overlap is 0.11–0.58 (Princeton + AutoGEO data).
Optimize per-engine:

- **ChatGPT** cites Wikipedia in ~48% of top citations
- **Perplexity** cites recent web sources, weights freshness
- **Gemini** leans Reddit/Quora for opinion queries
- **Claude** weights primary sources and academic citations
- **Google AI Overviews** mirrors organic top-10 + featured snippets

### 5. Real evidence wins long-term

Princeton showed fabricated quotes worked against GPT-3.5. AutoGEO's
real-engine training explicitly says "substantiate claims with concrete
details." Engines have moved on. Build with real sources only.

---

## The GEO Signal Stack

Four pillars, weighted as in the audit scoring:

### Pillar 1 — Evidence Density (35%)

| Signal | Target | Why |
|--------|--------|-----|
| Numbers with units | ≥5 per article | LLMs preferentially extract specific numerics |
| External citations | ≥1 per 500 words, ≥3 source types | Authority + verifiability |
| Direct expert quotes | ≥2 from named individuals | Quotation Addition is the +41% method |
| Named entities | ≥3 with full names + roles | Specificity beats vagueness |
| First-party data | ≥1 original stat or framework | Becomes the only-citable source |

### Pillar 2 — Structure & Position (25%)

| Signal | Target |
|--------|--------|
| Direct answer in first 150 words | Required (PAWC) |
| TL;DR or Key Takeaways near top | ≥1 box |
| Heading hierarchy (H1→H2→H3) | No level skipping, single H1 |
| Comparison/spec data in tables | Required if comparison content |
| Sequential steps in numbered lists | Required if procedural |
| FAQ section with question-format H2/H3 | Required for informational |
| Average paragraph length | 2–4 sentences |
| JSON-LD schema | `Article` minimum, `FAQPage` if FAQ, `HowTo` if procedural |

### Pillar 3 — Authority Signals (25%)

| Signal | Target |
|--------|--------|
| Author byline | Real name, role, ≥30-word bio |
| `author.sameAs` JSON-LD | Wikipedia, LinkedIn, ORCID, Google Scholar |
| Last updated within 60 days | Recency (3× citation lift per Princeton + amplifying-ai data); 60–90 days is the boundary, target 60 |
| Methodology disclosed | Sample sizes, criteria, dates |
| Limitations acknowledged | Counter-LLM-hallucination signal |
| First-party experience markers | "We tested", "Our analysis of N…" — not vague "experts say" |
| External validators | Featured in / cited by named outlets |

### Pillar 4 — AI Crawlability (15%)

| Signal | Target |
|--------|--------|
| robots.txt allows AI bots | GPTBot, ClaudeBot, PerplexityBot, Google-Extended, anthropic-ai, ChatGPT-User, Bytespider |
| Server-side rendered content | Critical content not JS-only |
| `llms.txt` at site root | Optional but adopted by 784+ sites as of mid-2025 |
| HTTPS + HSTS | Required |
| Canonical URLs | Required |
| `<time>` tags + `dateModified` | Required for freshness signal |
| Schema validates | Use Rich Results Test |

---

## Audit Scoring

For each item in the signal stack, score:

- **Pass (full points)** — meets target
- **Partial (50%)** — partial implementation
- **Fail (0)** — missing or wrong direction (e.g., keyword stuffing present)

Sum to a 0–100 GEO Score with the pillar weights.

### Veto items (auto-cap at 60)

These either kill citation or expose the user to liability:

1. **Self-contradictory data** — internal inconsistency on the page
2. **Title-content intent mismatch** — clickbait
3. **No identifiable author** — anonymous content rarely gets cited as primary source
4. **AI crawlers blocked** in robots.txt or CDN/WAF
5. **Fabricated citations or stats** detected — hard fail, not a cap
6. **YMYL content without disclaimers** — health/finance/legal without appropriate warnings

### GEO Score interpretation

- **80–100** — well-positioned for AI citation; iterate on per-engine playbooks
- **60–79** — solid foundation, missing 1–3 high-leverage signals
- **40–59** — structural fixes needed before per-engine work pays off
- **0–39** — rewrite from outline; current content unlikely to be cited

---

## Rewrite Patterns

Apply in this priority order. Stop when the content is at quality bar; not
every page needs every pattern.

### Pattern 1 — Front-Load the Answer

**Before:**
> "In today's rapidly evolving digital landscape, businesses are constantly
> seeking ways to optimize their online presence. This article will explore
> the various strategies and considerations involved in [topic]."

**After (template — replace bracketed values with real, verified data
before publishing):**
> "[Topic]'s ROI averages [REAL_NUMBER]× ([REAL_SOURCE_WITH_URL], [YEAR])
> when implemented with [specific approach]. Three steps drive that lift:
> [step 1], [step 2], [step 3]. Below: how to implement each in 2 weeks."

The first sentence carries: a specific number, a unit, a real-source
citation, a year, and a concrete preview. PAWC will weigh this sentence
~5× any conclusion paragraph. **Do not ship the template values** — every
bracketed value must be replaced with a real, verifiable fact before this
content goes live. Run the Evidence Hunt section below to source them.

### Pattern 2 — Statistics Addition (real)

**Before:**
> "Many companies struggle with onboarding."

**After (template):**
> "[REAL_PERCENT]% of [defined population] report [specific finding]
> ([REAL_SOURCE_NAME_WITH_URL], [year], n=[real sample size])."

Rule: every claim that can be quantified, must be. Hunt for the real stat
before falling back to vague language. If the stat doesn't exist publicly,
follow the "What to do when the stat doesn't exist" section below — never
keep the claim as a vague unsourced statement.

### Pattern 3 — Quotation Addition (real)

**Before:**
> "Experts agree that retention is more cost-effective than acquisition."

**After (template):**
> "'[Verbatim quote from a real, named person],' [wrote/said]
> [Real Name] in *[Real Publication Title]* ([Publisher], [Year]),
> [one-line context establishing why this person is authoritative]."

A real working example for the retention claim above: Frederick Reichheld
& Earl Sasser's "Zero Defections: Quality Comes to Services" (Harvard
Business Review, Sep–Oct 1990) is the canonical retention-economics
citation. Verify the quote and URL before publishing.

Rule: cite a real person at a real org with a real publication. If you
can't find one for the claim, the claim probably isn't load-bearing.

### Pattern 4 — Citation Addition (real)

**Before:**
> "Search behavior has shifted toward AI assistants."

**After (template):**
> "[Specific stat]% of [defined activity] now [specific behavior]
> ([Real Research Firm], [Month Year], [URL]) versus [historical stat]
> in [comparison year], with [observed pattern]."

Rule: ≥1 citation per 500 words, ≥3 source types per article. Source types
include: peer-reviewed papers, government data, industry research firms,
named publications, primary first-party data. Every citation must include
a URL the reader can click — citations without verifiable URLs do not
count toward the density target and trigger the fabrication veto.

### Pattern 5 — Fluency Optimization

The +28% lift from this method requires no new facts. It's just rewriting
for flow. Apply it last, after you've added evidence.

Rules:
- One idea per paragraph
- Sentence variety: alternate short/medium/long
- Active voice by default
- Cut every word that doesn't earn its place
- Read aloud test — if you stumble, rewrite

### Pattern 6 — Schema Markup

Minimum for any article-style content:

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "[H1]",
  "author": {
    "@type": "Person",
    "name": "[Real name]",
    "url": "[Author page URL]",
    "sameAs": [
      "https://en.wikipedia.org/wiki/[Author]",
      "https://www.linkedin.com/in/[handle]",
      "https://orcid.org/[id]"
    ]
  },
  "datePublished": "[ISO date]",
  "dateModified": "[ISO date]",
  "publisher": {
    "@type": "Organization",
    "name": "[Org]",
    "logo": {"@type": "ImageObject", "url": "[Logo URL]"}
  },
  "mainEntityOfPage": "[Canonical URL]"
}
```

Add `FAQPage` if FAQ section present. Add `HowTo` if procedural. Validate
at `search.google.com/test/rich-results` before publishing.

---

## Evidence Hunt — Finding Real Sources

Before any rewrite, build a source list. Tools in priority order:

1. **WebSearch** — for recent stats and named studies
2. **WebFetch on primary source pages** — verify the stat exists at the URL
3. **Google Scholar** (`scholar.google.com/scholar?q=...`) — academic
4. **Government data portals** — `data.gov`, `bls.gov`, `eurostat.ec.europa.eu`,
   `data.gov.uk`
5. **Named research firms** — Pew, Forrester, McKinsey, Gartner, Statista
   (cite the firm + publication date + report name)
6. **Primary publications** — NYT, FT, WSJ, The Economist, trade press
   relevant to the topic
7. **First-party data from the user** — ask: "Do you have any internal data
   that supports this claim?" Original first-party data is the strongest
   GEO signal.

### Verification rules

- **Every stat must trace to a URL you've actually fetched**
- **Every quote must come from a real publication you can cite by name**
- **Every named expert must be a real person at a real org**
- If you can't verify, reframe the claim or remove it

### What to do when the stat doesn't exist

If you genuinely can't find a real source for a claim, in order of preference:

1. **Anchor to a related, verifiable stat** — "the broader [parent category]
   grew 12% in 2024 (Source, URL)" with a real source for the parent number.
   This is acceptable because the citation is real and the relationship is
   stated honestly.
2. **Run an internal analysis** — if the user has data, use it. First-party
   data is the strongest GEO signal anyway.
3. **Drop the claim** — if it's not load-bearing, cut it.

**Do not** keep the claim as a vague directional statement ("growing
rapidly", "increasingly common", "many companies"). That violates the
vague-entity anti-pattern below — vague unsourced statements are still
fabrication-adjacent and dilute the page's evidence density.

Never invent. Not "according to a 2024 study", not "experts estimate", not
"surveys show". Real source with URL, or no claim.

---

## Per-Engine Playbooks

Cross-engine citation overlap is 0.11–0.58. Tailor the strategy.

### ChatGPT (OpenAI)

**Citation pattern:** Wikipedia ~48% of top citations; reputable publications;
moderate freshness preference.

**Optimization moves:**
- Build/maintain a Wikipedia presence for the entity (brand, person, product)
- Get listed in Wikidata with structured properties
- Earn coverage in citations Wikipedia accepts (NYT, FT, BBC, Reuters,
  industry trade press)
- Strong author-as-entity signaling (`sameAs` to Wikipedia)
- Comprehensive reference articles outrank thin "answer" pages

### Perplexity

**Citation pattern:** Heavy on recent web; cites primary sources directly;
fewer "synthesis" citations.

**Optimization moves:**
- Recency matters most — pages updated within 90 days outperform
- Original first-party data gets cited disproportionately
- Clear thesis sentences in the first paragraph
- Industry blog content with named author + date stamps
- Tracking: Perplexity Sonar API exposes which URLs were cited
  (gego repo automates this); use it to verify

### Gemini (Google)

**Citation pattern:** Reddit / Quora prominent for opinion / advice queries;
Google search index parity.

**Optimization moves:**
- Reddit presence: maintain authoritative subreddit comments under named
  account; AMA-style threads
- Quora answers from credentialed account
- Strong on-page Google SEO — Gemini citations correlate with organic
  top-10
- Google AI Overviews specifically: structured data + featured-snippet
  format wins

### Claude (Anthropic)

**Citation pattern:** Primary sources, academic citations, well-structured
explanatory content.

**Optimization moves:**
- Long-form, well-cited articles outperform short-form
- Named author with verifiable credentials in `author.sameAs`
- Citations to peer-reviewed sources where applicable
- Limitations and methodology disclosed (counter-hallucination signaling)
- Avoid marketing language — Claude weights informational tone heavily

### Google AI Overviews

**Citation pattern:** ~85% overlap with organic top 10 + featured snippets.

**Optimization moves:**
- Win the featured snippet for the query (definition box, list, table)
- Schema markup (`Article`, `FAQPage`, `HowTo`)
- Direct answer in 40–60 words near top of page
- Page must already rank top 10 organically — GEO doesn't bypass SEO here

### Cross-engine moves (do these first)

- llms.txt at site root with content map
- Author entities with strong `sameAs` linkage
- Original data publications quarterly
- Wikipedia / Wikidata presence for the brand
- Reddit + Stack Overflow + relevant community presence

---

## AI Crawlability

### robots.txt — must allow

```
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Bytespider
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: meta-externalagent
Allow: /
```

If the user is currently blocking these (often inherited from default
"block all bots" templates), this is the single highest-leverage fix.

### Optional: llms.txt

Adopted by 784+ sites as of mid-2025; not yet a confirmed ranking signal
but trending. Place at site root:

```
# Site Name

> One-paragraph description of the site, what it does, who it's for.

## Core content

- [Page Title](URL): One-line summary
- [Page Title](URL): One-line summary

## About

- [About](URL)
- [Contact](URL)

## Optional

- [Old content](URL): Archive
```

### CDN / WAF

Cloudflare, AWS WAF, and Akamai often block AI bots by default. Verify
in the CDN dashboard separately from robots.txt — robots.txt being
permissive doesn't help if the WAF returns 403.

### Server-side rendering

JS-only content (CSR-heavy SPAs without prerendering) is invisible to
most AI crawlers. Use Next.js / Nuxt / Astro / Remix server rendering
or static generation for any page that should be cited.

---

## Anti-Patterns

These either don't work or actively hurt:

### Hard fails (will cause penalties or removal)

- **Fabricated citations / quotes / stats** — see Step 5 of SKILL.md
- **Hidden text optimization** — old SEO trick; AI engines detect and demote
- **Doorway pages** — single-purpose pages targeting near-duplicate queries
- **AI-generated mass content with no human review** — both Google and
  AI engines now penalize
- **PBN backlink networks** — CITE framework veto item

### Soft fails (waste of effort)

- **Keyword stuffing** — Princeton: −8% PAWC. Stop.
- **Generic AI-language intros** — "In today's rapidly evolving landscape…"
  Cut.
- **Vague entities** — "a leading company", "experts say", "studies show".
  Specify or remove.
- **Unsupported superlatives** — "the best", "the most comprehensive".
  Either back with data or cut.
- **Filler paragraphs** — every paragraph must earn its place
- **Redundant H2s covering the same subtopic** — cannibalizes extraction

---

## Measurement

GEO without measurement is a vibe. Set up at minimum:

### Citation tracking

- **gego** — open source (Go), self-host. Schedules prompts across
  OpenAI, Anthropic, Gemini, Perplexity, Ollama; regex-matches brand
  mentions; Perplexity Sonar URL capture is unique. Repo:
  https://github.com/AI2HU/gego — clone, follow README to set API keys
  and run the cron scheduler.
- **llmopt** — open source (Go + React), self-host. Richer multi-pillar
  scoring (LLM knowledge testing, AEO content scoring, video authority
  via YouTube transcripts, Reddit authority, search visibility), MCP
  integration for Claude Code/Desktop. Repo:
  https://github.com/jonradoff/llmopt — clone, follow README to
  configure API keys and start the dashboard.
- **Manual baseline** — every 2 weeks, run 5 brand queries + 5 category
  queries against ChatGPT, Claude, Perplexity, Gemini. Log: cited (Y/N),
  position in answer, sentiment.

### Content KPIs (per page)

- GEO Score (this skill's audit)
- Citations per AI engine, per query
- Position in AI answer (1st sentence, 1st paragraph, body, footer)
- Click-through from AI answer (if engine surfaces source links)
- Organic traffic to the page (control variable)

### Brand KPIs

- Share of Model — % of category-query AI answers mentioning brand
- Cross-engine coverage — % of monitored engines citing brand
- Sentiment in AI answers — positive / neutral / negative
- Wikipedia presence + Wikidata edit recency

### Monthly review

- Which content is being cited? Why? (extract the pattern, replicate)
- Which content was optimized but isn't cited? Why? (audit fail mode)
- Which queries does the brand never appear in? (off-site authority gap?)
- Which engines diverge most from the others? (engine-specific playbook
  not yet running)

---

## Quick reference: Do / Don't

### Do
- Front-load the answer in first 150 words
- Add real stats with units, sources, dates
- Quote real named experts from named publications
- Cite ≥1 external source per 500 words from ≥3 source types
- Update content every 60 days for competitive queries, 90 days minimum for stable topics
- Allow all major AI crawlers in robots.txt + CDN
- Add Article + FAQPage + HowTo schema as appropriate
- Build Wikipedia / Wikidata / Reddit presence
- Track citations across all four major engines
- Publish original first-party data quarterly

### Don't
- Fabricate stats, quotes, citations, or expert names
- Keyword-stuff (−8% PAWC, actively hurts)
- Use vague entities ("experts say", "studies show")
- Block AI crawlers in robots.txt or WAF
- Ship JS-only content without SSR/SSG
- Treat GEO as identical to SEO (different signals, different weights)
- Optimize for one engine and assume the others follow
- Skip the author byline + sameAs linkage
