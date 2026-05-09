# Account Health — Diagnostic Reference

Domain knowledge and the audit's structured output format. **Not a checklist.** Pull this account's data, find what's actually broken, and let the data drive the recommendation. Every claim cites specific entities, numbers, and time windows (per `../../shared/analysis-principles.md`).

---

## The seven areas to look at

These are where you look for evidence — not boxes to grade.

| Area | The question it answers |
|---|---|
| Signal Quality | Can I trust the data? |
| Campaign Structure | Am I in the right auctions, organized so each one makes sense? |
| Keyword Health | Are my keywords pulling weight, or burning money? |
| Search Term Quality | Are queries reaching me actually relevant? |
| Ad Copy & Creative | Are my ads competitive once an auction starts? |
| Impression Share | Why am I losing the auctions I lose? |
| Spend Efficiency | Where is the money going, and is it producing customers? |

---

## Signal Quality — diagnostic facts

If signals are broken, every downstream decision is built on lies. Smart Bidding can't optimize what it can't measure. Patterns to recognize:

- **0 conversions in 30 days with spend > 5× account CPA** → tracking is almost certainly broken or missing.
- **Conversion rate > 50%** → tag firing on page load, not on actual conversions.
- **All conversions = "Website" with no action names** → default tracking only; no segmentation.
- **Last-click attribution** → deprecated since 2023; data-driven attribution is the only model accepted for new conversion actions. Existing conversion actions on last-click should migrate.
- **Smart Bidding (tCPA / tROAS) with < ~15 conversions/month** → insufficient data density for the algorithm to learn (typical floor is 30+ for tCPA, 50+ for tROAS).
- **Missing Consent Mode v2 with EU traffic** → degraded conversion modeling in privacy-regulated markets; bid strategies underperform.
- **Enhanced conversions disabled** → cross-device / cross-browser attribution gaps; Smart Bidding is missing signal.

**STOP condition:** if Signal Quality is broken, recommend pausing spend until it's fixed before any other recommendation.

---

## Impression Share — the most important read in the audit

Rank-lost-IS and budget-lost-IS are two different problems with two different fixes. Treating them as one "impression share problem" produces bad advice — telling someone with a relevance problem to spend more burns money faster.

- **Lost IS (Rank)** = relevance problem. Ad Rank is low; the auction is telling you the ads, themes, or landing page aren't competitive. Fix with better creative, tighter themes, better landing pages — not more money.
- **Lost IS (Budget)** = scaling opportunity. You're winning auctions but running out of gas. Fix with more budget or narrower targeting, *if* the campaign is profitable.

**The 2×2:**

| | Rank-Lost IS LOW | Rank-Lost IS HIGH |
|---|---|---|
| **Budget-Lost IS LOW** | Healthy — optimize at the margins | Relevance problem — fix QS / ads / pages, do **not** add budget |
| **Budget-Lost IS HIGH** | Capital problem — add budget if profitable, or narrow geo / daypart | Structural problem — wrong keywords or wrong audience entirely; rebuild |

**Data caveat:** impression-share metrics in GAQL only return up to 90 days. Don't use `LAST_365_DAYS` on any query that selects `metrics.search_*_impression_share`.

---

## Wasted spend — formula

Wasted spend is three things, summed and de-duplicated:

```
Keyword waste     = Spend on Tier 2/3 keywords with 0 conversions AND clicks past significance gate
Search-term waste = Spend on search terms with low relevance (irrelevant intent, clear non-buyer signals)
Structural waste  = Spend on Display Network impressions inside Search-channel campaigns
                    (network_settings.target_content_network = TRUE on a SEARCH campaign)
```

**De-duplicate:** search-term waste from a wasted keyword is already counted in keyword waste — don't double-count. Tier 1 (core) keyword underperformance is an optimization opportunity, not waste.

---

## Brand vs. non-brand — the most misleading rollup

Many accounts show great overall ROAS where the majority comes from brand traffic — paying Google a tax on existing customers, not acquiring new ones. Always report the split:

> "Overall CPA is $X, but brand CPA is $Y and non-brand CPA is $Z."

If brand and non-brand aren't in separate campaigns, that itself is a structural finding. PMax running alongside Search with declining brand impression-share = cannibalization; flag and recommend brand exclusions.

---

## Pulse Metrics — the audit's headline output

The audit doesn't emit a letter grade or a 0–5 score. It surfaces **three pulse metrics**, each annotated with its biggest contributor and a pointer to the fix. The metric IS the verdict — read it as dollars and act on it directly.

Every pulse metric answers three questions inline:
1. **What's the number?** (raw value)
2. **What's driving it?** (the single biggest contributor, named)
3. **Where do I fix it?** (specific handoff or action)

### The three metrics

| Metric | Measures | Better = | Compute |
|---|---|---|---|
| **Waste** | $/mo burning on zero-conversion spend | Lower | Wasted-spend formula above, extrapolated to 30 days |
| **Demand captured** | % of eligible impressions won on profitable campaigns | Higher | Spend-weighted avg `search_impression_share` across campaigns with ≥ 1 conversion. If `unit_economics` exists, filter to campaigns with `CPA ≤ Break-Even CPA` |
| **CPA** | Cost per conversion | Lower or stable | `total spend / total conversions` — compare to industry benchmarks below or to `unit_economics.break_even_cpa` if available |

### Annotation rules

**Waste line.** Dollar value extrapolated to 30 days (`$X/mo, Y% of spend`) + top contributor (keyword / search term / campaign) + pointer to the fix.
- *Signal-failure override:* if conversion tracking is broken, replace the dollar figure with `⚠️ Cannot compute — conversion tracking broken` and point to the tracking fix. Waste is meaningless when conversions can't be measured.

**Demand-captured line.** Percentage + top single opportunity (campaign + headroom in $/mo, margin-aware where possible) + pointer.
- *Relevance override:* if rank-lost-IS > 30% on the named campaign, flag that more budget won't help — "fix relevance first" — and point at the relevance fix instead.

**CPA line.** Dollar value + context (`vs industry $Y–$Z` from `industry-templates.json`, or `vs break-even $Y` from `unit_economics`) + the single biggest structural driver if CPA is unhealthy (which campaign is pulling it up; which QS component is below average).

### Quick Wins section

After the pulse metrics and per-area findings, emit a `## Quick Wins` section containing every finding where:

```
dollar_impact_usd >= 200 AND time_to_fix IN ('<5min', '<15min')
```

Plus any **signal/tracking/policy fix** regardless of dollar value — these qualify unconditionally because they unblock measurement.

Sort by dollar impact descending (signal fixes pinned to top). Max 5 items. If none qualify, omit the section — don't fabricate.

Every Quick Win includes the executable command where applicable. Examples:
- `Add 7 negatives to Example City Search — saves ~$340/mo (<5 min) · /google-ads add negatives to Example City Search: jobs, careers, salary, diy, free, reddit, training`
- `Enable Enhanced Conversions — unblocks measurement (<15 min) · Configure in Google Ads UI`

### `time_to_fix` field

Every finding carries `time_to_fix ∈ <5min | <15min | <30min | <2h | >2h`. This is how long the fix takes, not how important it is. The dollar figure carries priority — sort and filter on dollars.

### Persisting to `audit-history.json`

```json
{
  "date": "2026-04-14",
  "date_range": "2026-03-15 to 2026-04-14",
  "account_id": "7521406707",
  "mode": "full",
  "total_spend": 14320.00,
  "total_conversions": 72,
  "metrics": {
    "waste": {
      "usd_per_month": 1240,
      "pct_of_spend": 8.7,
      "top_contributor": "keyword 'free estimate' — $340/mo",
      "tracking_blocker": false
    },
    "demand_captured": {
      "pct": 42.7,
      "top_opportunity": "Example City Search — ~$2,100/mo headroom at 35% budget-lost IS",
      "rank_lost_blocker": false
    },
    "cpa": {
      "usd": 19.88,
      "benchmark_low": 25,
      "benchmark_high": 65,
      "break_even": 72,
      "trend_vs_last": -2.14
    }
  },
  "top_actions": [
    "Paused 'free estimate' keyword ($120 waste)",
    "Budget-lost IS 40% on Example City Search at $14 CPA"
  ],
  "next_milestone": null
}
```

On re-audits, diff the three numbers directly:

- `Waste: $640/mo (4.1%) _(was $1,240/mo — 3 fixes applied)_`
- `Demand captured: 58% _(was 42% — Example City budget increased)_`
- `CPA: $18.40 _(was $19.88 — stable)_`

Three numbers, three deltas, zero artificial ratings. If a number didn't move, say "unchanged." If it moved the wrong way, show the delta without sugar-coating.

---

## Industry CPA Benchmarks — calibration anchors

Directional benchmarks for evaluating spend efficiency. Actual CPA varies by market, geography, competition, and offer — use as a reference point, not an absolute target. Always prefer `unit_economics.break_even_cpa` when available.

| Industry | Avg CPA (Search) | Good | Excellent |
|----------|------------------|------|-----------|
| Legal | $85–$120 | <$70 | <$50 |
| Home Services | $40–$65 | <$35 | <$25 |
| Healthcare | $55–$85 | <$50 | <$35 |
| B2B / SaaS | $75–$120 | <$65 | <$45 |
| E-commerce | $30–$50 | <$25 | <$15 |
| Finance / Insurance | $70–$110 | <$60 | <$40 |
| Real Estate | $50–$80 | <$45 | <$30 |
| Education | $45–$75 | <$40 | <$25 |
| Travel | $35–$60 | <$30 | <$20 |
| Automotive | $40–$65 | <$35 | <$25 |
