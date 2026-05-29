# Ad + Landing Page Message-Chain Testing

Use this when landing-page experience, high CTR / low CVR, Quality Score LPX, or ad-copy testing points to a mismatch between the query, ad, and landing page.

Core idea: sometimes you are not testing an ad or a page in isolation — you are testing a **message chain**. Query intent → RSA promise → landing-page headline/offer/form must reinforce one another.

---

## 1. Map the message chain

For each target ad group or URL, collect:

- Top search terms and converting terms.
- Active RSA headlines/descriptions and pinned assets.
- Final URL, H1, hero subheadline, CTA, form fields, trust proof.
- Keyword QS components if available, especially ad relevance and landing-page experience.
- Last 30d clicks, spend, CTR, CVR, conversions, CPA/ROAS.

Then classify:

- **Match:** query phrase, ad promise, and page H1/offer use the same concept.
- **Drift:** same general business, but page does not reinforce the exact promise.
- **Broken:** ad promises one thing and page leads with another.

Examples:

- Query: `Seattle bookkeeping services`; ad: `Bookkeeping from $190/mo`; page H1: `Seattle & King County Bookkeeping Services` → strong match.
- Query: `QuickBooks cleanup`; ad: `QuickBooks Cleanup Help`; page H1: generic `Accounting Services` → drift.

---

## 2. Decide test design

### Ad-only test

Use when page is already tightly aligned and the bottleneck is CTR/ad relevance.

### Landing-page-only test

Use when ads are clear and CTR is healthy, but CVR / LPX / form friction is weak.

### Paired message-chain test

Use when the angle changes both ad and page promise, e.g.:

- `Free bookkeeping review` ad → page hero and form explicitly offer the review.
- `QuickBooks cleanup` ad → page hero, proof, FAQ, and CTA are cleanup-specific.
- `NotFair for Claude MCP` ad → page hero clarifies NotFair + Claude/Codex/OpenClaw compatibility.

### Full factorial ad × page test

Use when you need to know whether the ad, page, or their combination drives the win. This requires enough traffic and clean tracking; otherwise it creates noise.

---

## 3. What to fix first

Prioritize by evidence:

1. **Broken message match** — update H1/hero/CTA or rewrite RSA to match the page.
2. **Missing trust proof** — add reviews, local proof, certifications, price transparency, client type, examples.
3. **Form friction** — reduce fields, clarify what happens next, make CTA specific.
4. **Mobile/page speed** — if PSI or manual browser evidence shows slow LCP/interaction problems.
5. **Offer ambiguity** — if the ad says free/review/quote but the page hides or dilutes it.

Do not redesign the entire page when a specific above-the-fold message change would fix the paid-search problem.

---

## 4. Reporting format

Lead with the concrete chain:

- Search term theme: `<actual query/theme>`
- Top ad promise: `<headline/description>`
- Page H1 / CTA: `<actual text>`
- Verdict: Match / Drift / Broken
- Fix first: `<single above-the-fold change>`
- Why: `<metric + window>`

For small accounts, keep recommendations conservative. One high-CPC click can look dramatic; the right proposal may be "watch for 3–5 more relevant clicks" if traffic is clean but sample is tiny.

---

## 5. Mutation boundary

This skill diagnoses pages. If the repo/site is available and the user asks for local page edits, make the smallest page change and verify with browser screenshots / HTML checks. If only Google Ads changes are needed, hand off to `/google-ads-copy` for RSA assets or `/google-ads` for final URL / experiment changes.

Always avoid form submissions unless explicitly approved; they can trigger client emails or CRM automations.

---

## Sources

- `../../shared/ppc-optimization-pattern-playbook.md` — landing page and ad+LP testing modules.
- General landing-page experience, ad+landing-page testing, customer-journey testing, and Quality Score patterns.
