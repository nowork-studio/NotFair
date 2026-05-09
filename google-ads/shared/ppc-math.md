# PPC Math — Margin-Aware Profitability Calculators

Formulas and interpretation rules used throughout the Google Ads skills. Load this when a finding needs dollar-denominated impact, profitability framing, or a forecast.

**Priority rule:** When `business-context.json` has `profit_margin` and `aov`, use break-even-based thresholds. Otherwise fall back to account-average heuristics in `analysis-heuristics.md`. Never mix the two in a single finding — the framing should be consistent.

---

## Core Formulas

```
CPA            = Spend / Conversions
ROAS           = Revenue / Spend              (ratio, e.g. 3.5x)
ROAS%          = (Revenue - Spend) / Spend × 100
CPC            = Spend / Clicks
CPM            = (Spend / Impressions) × 1000
CTR            = Clicks / Impressions × 100
CVR            = Conversions / Clicks × 100
CPL            = Spend / Leads
```

## Profitability Formulas (require margin + AOV)

```
Break-Even CPA      = AOV × Profit Margin
Max Profitable CPA  = Break-Even CPA                    (bid up to this, no higher)
Break-Even ROAS     = 1 / Profit Margin
Unit Profit         = AOV × Profit Margin - CPA
Headroom $          = (Break-Even CPA - Current CPA) × Monthly Conversions
```

**Headroom interpretation:**

| Headroom | Framing | Action |
|---|---|---|
| Negative | "Losing $X/month on this campaign" | Pause or restructure immediately |
| $0-$500/mo | "Barely break-even" | Improve QS / CVR before scaling |
| $500-$2,000/mo | "Profitable but tight" | Selective scaling |
| >$2,000/mo | "Strong unit economics" | Scale aggressively (20% rule) |

---

## LTV:CAC (require LTV data)

```
CAC       = Total Marketing Spend / New Customers Acquired
LTV       = ARPU × Avg Customer Lifespan   (or use business-context.json.ltv if set)
LTV:CAC   = LTV / CAC
Payback   = CAC / (ARPU × Gross Margin)    (months to recover CAC)
```

| LTV:CAC | Interpretation |
|---|---|
| <1:1 | Losing money on every customer. Stop scaling immediately |
| 1:1–3:1 | Marginal. Viable only if payback period < 12 months |
| 3:1 | Healthy (SaaS/service benchmark) |
| 5:1+ | Under-investing in growth. You can afford to bid higher |

---

## Impression Share Opportunity

```
Revenue Opportunity        = Current Revenue × (1 / Current IS - 1)
Budget to Capture Full IS  = Current Spend × (1 / Current IS)
```

**Example:** Campaign at 60% IS, spending $3,000/mo, generating $12,000 revenue.
- Full-IS revenue potential: $12,000 × (1/0.6 - 1) = **$8,000/mo additional**
- Budget to capture it: $3,000 × (1/0.6) = **$5,000/mo**
- Incremental: spend $2,000 more → capture $8,000 more revenue (4x ROAS on incremental)

**Only use this framing when Budget-Lost IS is the constraint (Layer 4 Scale).** If Rank-Lost IS is the constraint, increasing budget does nothing — the formula mis-frames the problem.

---

## Budget Forecasting

```
Projected Spend       = Daily Budget × Days in Period
Projected Conversions = Projected Spend / Historical CPA
Projected Revenue     = Projected Conversions × AOV
```

Present 3 scenarios, enforcing the **20% scaling rule** (never recommend more than +20% in a single week; compound across weeks):

| Scenario | Weekly Budget Increase | Caveat |
|---|---|---|
| Conservative | +20% | Safest — no learning phase reset |
| Moderate | +50% over 3 weeks (+20%, +25%, +25% compounded) | Monitor for CPA drift after each step |
| Aggressive | +100% over 5 weeks | Diminishing returns kick in; expect CPA to rise 15–25% |

Always show the **diminishing returns warning** for aggressive: "Doubling budget rarely doubles conversions — expect 1.5–1.7x conversions at 2x spend."

---

## MER (Marketing Efficiency Ratio)

```
MER = Total Business Revenue / Total Marketing Spend
```

Use MER when the user has multi-channel spend and wants blended efficiency. Typical ranges by industry template (see `industry-templates.json`):

| Industry | Typical MER | Excellent |
|---|---|---|
| Ecommerce | 3–5x | 8x+ |
| SaaS | 5–10x | 15x+ |
| Local Service | 3–8x | 10x+ |

MER captures organic, brand, and retention — so it's higher than paid ROAS and should never be compared directly to ROAS.

---

## Usage in Findings

**Before (account-average framing):**
> "Keyword 'emergency plumber example-city' has CPA of $72, which is 150% of account average."

**After (margin-aware framing, requires `margin=0.4`, `aov=$180` from business-context.json):**
> "Keyword 'emergency plumber example-city' has CPA of $72. Your Break-Even CPA is $72 (AOV $180 × 40% margin) — every conversion from this keyword nets $0 profit. Either improve CVR or pause."

**Headroom example:**
> "Example City Search is profitable: CPA $18, Break-Even $72, **~$2,700/mo headroom** at 50 conversions. Budget-Lost IS is 35% — raising budget by $1,500/mo could capture ~$5,000 more revenue."

The second framing is concretely actionable. The first is a number without a verdict.

---

## Gates

1. **Never compute break-even without verified margin.** If `business-context.json.profit_margin` is missing or marked `inferred_from_template`, label the output "estimated from industry template (±20%)" and ask the user to confirm before any write operation.
2. **Never project conversions more than 2x current spend.** Diminishing returns make linear projections unreliable beyond that.
3. **Never use MER in place of ROAS for individual-campaign decisions.** MER is a blended portfolio metric; individual campaigns must clear ROAS/CPA targets.
4. **LTV:CAC requires ≥12 months of history.** If the business is newer, fall back to payback period only.
