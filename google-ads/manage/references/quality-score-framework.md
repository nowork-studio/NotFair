# Quality Score — Mechanics & Diagnostic Reference

Domain knowledge for diagnosing Quality Score. **This is reference data, not a checklist.** Pull QS component data from this account, identify what's actually broken, and let the data drive the recommendation. Every claim you make about QS has to cite the specific keyword, its components, and its spend (per `../../shared/analysis-principles.md`).

---

## Components

Quality Score (1–10, keyword-level) is composed of three sub-components, each rated **Below Average / Average / Above Average**:

| Component | Approx. weight | What Google evaluates |
|-----------|---------------|----------------------|
| **Expected CTR** | ~35–40% | Historical CTR of the keyword, normalized for ad position, extensions, and format |
| **Ad Relevance** | ~20–25% | How closely ad copy matches the keyword's intent and language |
| **Landing Page Experience** | ~35–40% | Page load speed, mobile UX, content relevance, navigation, trust signals |

> **Caveat.** Google has never published official QS component weights. The ranges above are estimates from third-party regression studies (notably WordStream and Optmyzr) and may shift over time. Use directionally, not as exact figures.

**Key insight:** Landing Page Experience and Expected CTR together account for the majority (~70–80%) of QS. Ad Relevance is the smallest factor — and often the easiest fix.

---

## QS impact on CPC

Quality Score directly modifies CPC through Ad Rank. Approximate modifiers relative to QS 5 (the neutral baseline):

| QS | CPC vs. QS 5 | Effective CPC at $2.00 baseline |
|---|---|---|
| 10 | −50% | $1.00 |
| 9 | −44% | $1.12 |
| 8 | −37% | $1.26 |
| 7 | −28% | $1.44 |
| 6 | −17% | $1.66 |
| **5** | **0%** | **$2.00** |
| 4 | +25% | $2.50 |
| 3 | +67% | $3.34 |
| 2 | +150% | $5.00 |
| 1 | +400% | $10.00 |

> **Caveat.** These are third-party estimates, not Google-published numbers. Actual modifiers vary by auction, vertical, and account history.

**Rule of thumb:** every 1-point QS increase above 5 saves ~16% on CPC; every 1-point decrease below 5 costs ~50% more. When you cite QS-driven savings, ground them in the specific keyword's spend and current QS — not the rule of thumb alone.

> **Smart Bidding context:** when Smart Bidding (tCPA, tROAS, Maximize Conversions, Maximize Conversion Value) is active, manual bid changes are overridden. Adjust target CPA / target ROAS instead of bid amounts.

---

## Component-level diagnosis

Pull QS components for the specific keywords on the table. The data tells you which lever matters here:

- **Expected CTR — Below Average** → the ad isn't earning the clicks Google expected at this position. Likely fixes live in headline relevance, extensions, search-term hygiene, or ad-group tightness. Validate against the actual CTR by impression-location segment (Absolute Top / Top / Other) — average position has been deprecated since September 2019; segment data is the right read.
- **Ad Relevance — Below Average** → the ad copy doesn't match the keyword's intent or vocabulary. Check whether the keyword (or a close variant) appears in any headline, whether the ad group is bloated past 15–20 keywords with mixed intent, and whether the same generic RSA is reused across many ad groups.
- **Landing Page Experience — Below Average** → the page is slow, mismatched, or thin. **Hand off to `/google-ads-landing`** for a structured measurement (PageSpeed Insights, message-match, mobile UX, trust signals, form friction). That skill produces evidence-backed dimensional scores; don't try to second-guess it from GAQL alone.

---

## Close-variant context

Google applies close variants to all match types — misspellings, singular/plural, stemming, abbreviations, accents, implied words, synonyms, paraphrases, and (for Broad) same-intent expansions. This means ad copy needs to cover the broader intent space, not just the literal keyword text. When diagnosing low Ad Relevance, pull the search-term report alongside the keyword and ad copy — the gap often shows up there.

See `search-term-analysis-guide.md` for the full close-variant reference and the negative-keyword precision caveats under Broad / Search Themes / PMax.

---

## Health-check questions

When evaluating QS at the account level, the data you actually want to look at:

- What share of impression-volume sits at QS 7+, QS 5–6, and QS 1–4? Concentration of spend on QS ≤ 4 is where the money leaks.
- Which 10 keywords have the largest spend × (5 − QS) gap? That's the prioritized fix list — not a generic "raise QS everywhere".
- Is one QS component dragging across many keywords (e.g., Landing Page Experience: Below Average on 60% of keywords)? That's a structural problem, not a per-keyword one.

Answer these from this account's data and let the answers shape the recommendation. The hierarchy of impact on overall account performance is roughly Landing Page Experience > Expected CTR > Ad Relevance — but spend-weighted is what matters, not the percentage of keywords.
