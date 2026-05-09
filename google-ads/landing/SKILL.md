---
name: google-ads-landing
description: Score and diagnose Google Ads landing pages. Use when asked to audit a landing page, check landing page quality, diagnose high-CTR but low-conversion-rate ad groups, improve Quality Score's Landing Page Experience component, or compare an ad group's messaging against its landing page. Trigger on "landing page audit", "landing page score", "landing page quality", "why is my conversion rate low", "LPX", "landing page experience", "ad to page match", or when `/google-ads-audit` surfaces a high-CTR / low-CVR ad group.
argument-hint: "<landing page URL or ad group name>"
---

## Setup

Read and follow `../shared/preamble.md` (MCP detection, account selection) and `../shared/analysis-principles.md` (evidence requirement, guardrails). Both apply throughout this skill — every dimension below is a measurement, not an opinion.

# Landing Page Scoring + Diagnostic

Google Ads campaigns fail on the landing page more often than in the auction. A great RSA that sends traffic to a slow, unfocused, or mismatched page burns budget twice — once on the click, once on the lost conversion. This skill scores landing pages on **5 weighted dimensions** and emits concrete fixes.

Only score pages that actually run ad traffic. Don't score random marketing pages. Run this on direct request, on auto-handoff from `/google-ads-audit` (high-CTR / low-CVR ad groups), when QS diagnosis flags "Landing Page Experience: Below Average", or as a preflight before `/google-ads-copy` writes new copy for a page nobody's validated.

## Reference

- `references/scoring-rubric.md` — the 5-dimension weighted rubric, thresholds, and evidence fields. Read before scoring.
- `../manage/references/quality-score-framework.md` — only when the user's explicit goal is QS improvement.

## Phase 1: Resolve the target pages

Figure out which URLs to score. In priority order:

1. **User supplied a URL** — score that page, skip discovery.
2. **User supplied an ad group or campaign name** — `runScript` a GAQL query against `ad_group_ad` filtered to that ad group; extract unique `final_urls`. Normalize (strip tracking params, preserve path + query that affects routing).
3. **Auto-handoff from `/google-ads-audit`** — the handoff passes the specific ad groups flagged. Pull their final URLs the same way.
4. **No arguments** — `runScript` an `ad_group_ad` query across the account ranking final URLs by last-30-day spend, propose the top 3, ask the user to confirm.

**De-duplicate aggressively.** Many ads point to the same final URL — score each unique URL once, then map back to every ad group that uses it.

## Phase 2: Gather signal (parallel)

Do all of these in a single tool-use turn:

1. **WebFetch the landing page** — capture visible headline, subheadline, primary CTA text, form fields, trust signals, body copy tone. Capture the full HTML so we can spot script bloat and above-the-fold content.
2. **PageSpeed Insights API call** — `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={url}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo` via WebFetch. No API key needed for single-URL queries. Extract LCP, CLS, INP, TTI, performance score, and the top 3 opportunities from `lighthouseResult.audits`.
3. **Pull the referring ad copy and the ad group's conversion metrics** — one `runScript` call with `ads.gaqlParallel` against `ad_group_ad` (for headline/description text — the message-match baseline) and `ad_group` or `keyword_view` (for clicks, conversions, CVR — used to ground the dollar-impact estimate). One call covers both.
4. **Read `{data_dir}/business-context.json`** — for brand voice, differentiators, offers, target audience. If missing, point the user to `/google-ads-audit` first. Don't guess the business.

If any single call fails, continue — note the gap in the report rather than blocking. PageSpeed Insights can rate-limit; if it does, fall back to a manual timing annotation ("PSI unavailable — could not score Page Speed") and deflate the final report's confidence rather than skipping the dimension.

## Phase 3: Score the page

Read `references/scoring-rubric.md` and score each dimension 0-100 with evidence. The dimension scores are real measurements (PageSpeed Insights numbers, word-for-word copy comparison, form field counts, etc.) — they're not artificial ratings, they're observations.

Compute the weighted composite only as an **internal reference number** for the dollar-lift formula below. Do not surface it as a letter grade. The user sees the dimension-level measurements and the estimated dollar lift — the composite is plumbing.

```
internal_composite = 0.25 * Message Match
                   + 0.25 * Page Speed
                   + 0.20 * Mobile Experience
                   + 0.15 * Trust Signals
                   + 0.15 * Form & CTA
```

**Dollar lift is the headline.** If `business-context.json.unit_economics` has `aov_usd` + `profit_margin`, compute the estimated monthly lift from raising the composite by 15 points (see `../shared/ppc-math.md`):

```
Target lift           = min(+15, 90 - internal_composite)    # cap at 90 internal
Assumed CVR lift      = target_lift / 100 * 0.5              # cap at 50% relative lift
Current conversions   = ad group conversions from last 30d
Additional conversions = current_conversions * assumed_CVR_lift
Additional revenue    = additional_conversions * AOV
Additional profit     = additional_conversions * AOV * profit_margin
```

Present the lift as `fixing this page is worth ~$X/mo in profit` — never as a guarantee. The 50% cap on CVR lift and the 15-point cap on score improvement keep estimates out of fantasy territory. If `unit_economics` isn't available, skip the dollar line entirely rather than making up a number — the dimension measurements still stand on their own.

## Phase 4: Deliver the report

Max 60 lines. Lead with the dollar lift (when available) and the single biggest fix. No letter grade.

```
# Landing Page — [URL]
Ads sending traffic here: [N ad groups] · [X clicks/mo] · [$Y spent/mo] · CVR [Z%]
[If unit_economics available] **Estimated lift from top 3 fixes: ~$X/mo in profit**
[If unit_economics is missing] _(Dollar lift unavailable — no verified AOV/margin. Confirm unit economics in business-context.json for sharper estimates.)_

**Biggest leak:** [one sentence naming the dimension and the specific observation, e.g. "LCP is 5.8s on mobile — 2.8s slower than the 3s threshold that kills conversion rate."]

## Measurements
| Dimension | Measurement | Top Finding |
|-----------|-------------|-------------|
| Message Match | [word-for-word verdict: Match / Drift / Broken] | [one line citing ad H1 vs page H1] |
| Page Speed | LCP Xs · INP Xms · CLS X · PSI perf score X | [top blocking audit from Lighthouse] |
| Mobile Experience | PSI accessibility X · [mobile-specific issue count] | [one line: e.g. "No click-to-call, form below fold"] |
| Trust Signals | [review count, years in business, cert count] | [one line: e.g. "Zero named testimonials, copyright 2023"] |
| Form & CTA | [field count] fields · CTA text: "[button]" · [above/below fold] | [one line: e.g. "11 fields for a free quote"] |

## Fix First (top 3, ranked by estimated $ lift)
1. **[Action]** — est. +$X/mo · `<time_to_fix>`
   Evidence: [the actual text/number from the page or PSI audit]
2. **[Action]** — est. +$X/mo · `<time_to_fix>`
   Evidence: [...]
3. **[Action]** — est. +$X/mo · `<time_to_fix>`
   Evidence: [...]

## Message Match Detail
Ad headline: "[actual headline from top-spending ad]"
Page H1:    "[actual H1 from landing page]"
Observation: [Match / Drift / Broken] — [one-line rationale citing the specific words that match or don't]

## Handoff
[Pick one:]
- Page speed dominates the problem → "Share these fixes with your developer: [list]"
- Message mismatch dominates → "Run /google-ads-copy to rewrite ads to match the page, or update the page to match the ads"
- Form friction dominates → "Reduce form to [specific fields]. Every removed field is ~10% more conversions"
```

## Writing back to history

Append the score to `{data_dir}/landing-page-history.json` so re-audits can show deltas:

```json
{
  "pages": {
    "https://example.com/services/roofing": {
      "history": [
        {
          "date": "2026-04-14",
          "internal_composite": 67,
          "dimensions": {
            "message_match": 72,
            "page_speed": 45,
            "mobile": 80,
            "trust": 70,
            "form_cta": 65
          },
          "psi_mobile_lcp_s": 4.2,
          "psi_mobile_cls": 0.15,
          "psi_mobile_inp_ms": 320,
          "estimated_lift_usd_per_month": 380,
          "ad_groups": ["Example City Search - Roofing"],
          "monthly_spend": 1240.50,
          "monthly_cvr": 2.1,
          "biggest_leak": "Page Speed — LCP 4.2s on mobile"
        }
      ]
    }
  }
}
```

`internal_composite` is stored for trend tracking only — it's the internal reference number used by the dollar-lift formula, never shown to the user as a letter grade. On subsequent runs against the same URL, diff the raw dimension measurements and the dollar lift: `LCP 4.2s → 2.1s · Page Speed 45 → 78 · estimated lift $380/mo → $120/mo remaining`. Three measurements moved, no artificial grade flip.

## Rules

1. **Never score a page without WebFetch'ing it.** The rubric demands evidence. No WebFetch = no score. Ask the user to help if the page is gated or requires auth.
2. **Never report a PSI number you didn't measure.** If PSI failed, say "PSI unavailable" — don't estimate.
3. **One page at a time unless the user asks for multiple.** Scoring three pages in one turn creates unreadable reports. Batch only when explicitly requested.
4. **Don't rewrite copy here.** This skill diagnoses the page. Handoff to `/google-ads-copy` for new headlines or `/google-ads` for bid/negative/budget moves.
5. **Margin-aware dollar impact requires verified unit economics.** If `unit_economics.source == "inferred_from_template"`, append `_(using industry defaults — confirm your AOV/margin for sharper estimates)_` to the lift line.
6. **Always persist.** Every scored page goes into `landing-page-history.json`, even if the user doesn't ask — future audits depend on the baseline.
