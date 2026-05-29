# RSA Testing Lab

Use this when the user asks to improve CTR, write/test RSAs, pin headlines, compare ad variants, or diagnose ad groups with mixed intent. It complements `rsa-best-practices.md`: that file tells you how to write compliant assets; this file tells you how to decide what to test and when to trust the result.

---

## 1. Choose the test objective first

Google's Ad Strength and asset labels are not the business objective. Pick the winner metric before generating copy:

- **CTR** — when the bottleneck is low click-through and the landing page converts normally.
- **CVR** — when traffic volume is acceptable but query/ad/page promise may be wrong.
- **CPA** — lead-gen default when conversion volume is enough.
- **ROAS / conversion value per impression** — e-commerce or value-tracked accounts.
- **Conversion per impression (CPI)** — useful when both CTR and CVR can move; it rewards ads that create conversions from available impressions.

If data is thin, state that the test is directional. Do not call winners from tiny conversion samples.

---

## 2. Diagnose ad-group organization before writing

The biggest RSA failure is often not the words — it is putting too many query intents into one ad group, then asking one RSA to match all of them.

Before writing:

1. Pull recent search terms for the ad group.
2. Cluster them by intent: service, location, urgency, price, competitor, problem/pain.
3. Compare clusters to the final URL and current RSA assets.
4. If one ad group contains materially different intents, recommend splitting before writing more assets.

Examples:

- `bookkeeping seattle`, `quickbooks cleanup`, and `tax prep` may need different RSAs/pages.
- `Claude MCP server`, `Codex MCP`, and generic `AI agent for Google Ads` may need separate NotFair messaging and negatives.

---

## 3. Test real angles, not word swaps

Good tests compare distinct hypotheses:

- **Trust / proof:** reviews, years, certifications, named expertise.
- **Speed / convenience:** same-day, fast setup, easy process.
- **Price / value:** transparent pricing, starting price, fixed-fee plans.
- **Pain / problem:** messy books, wasted ad spend, low-quality leads.
- **Local / specificity:** city/service fit, neighborhood intent.
- **Brand clarity / safety:** independent, approval-gated, not affiliated language where needed.

Bad tests:

- `Call Today` vs `Call Now`.
- Adding many generic headlines just to chase Excellent Ad Strength.
- Writing assets for intents not present in the ad group's search terms.

---

## 4. Pinning decision rules

Pinning can reduce Google's Ad Strength but improve business outcomes when message control matters.

Pin when:

- Legal/compliance/brand clarity must always appear.
- The ad group is narrow and one service/location promise should anchor every ad.
- The campaign has Limited Ad Serving / trust ambiguity and the brand must be explicit.
- The landing page headline requires the ad's promise to match word-for-word.

Avoid heavy pinning when:

- Query intent varies widely and Google needs room to compose.
- You are using RSAs to discover which value prop resonates.
- You do not have enough volume to test pinned vs unpinned.

Default controlled structure:

- Pin one service/location or brand-clarity headline to `HEADLINE_1` only when needed.
- Optionally pin one CTA to `HEADLINE_3`.
- Leave `HEADLINE_2` unpinned for value prop / trust / pain-angle testing.

---

## 5. Experiment mechanics

Preferred paths:

- Use `createAdVariationExperiment` for clean RSA asset tests.
- Use `createExperiment` + arms for broader ad+landing-page or structural tests.
- For very low-stakes / low-volume work, before/after can be acceptable, but report confounders.

Minimum-read rules:

- <100 clicks per variant: usually too early for CTR/CVR conclusions.
- ≥20% relative CTR/CVR delta: meaningful directional signal if volume is reasonable.
- 2x CVR gap: strong signal, still check conversion count and recent changes.
- If the test changes final URL, evaluate both CTR and CVR; an ad can win clicks while losing leads.

---

## 6. Output shape

For copy proposals, show:

- Baseline problem: entity + metric + window.
- Test hypothesis: what angle should improve and why.
- Complete RSA assets with character counts.
- Pinning plan, if any.
- Winner metric and minimum read threshold.
- Exact mutation path, but wait for user approval before writing.

---

## Sources

- `../../shared/ppc-optimization-pattern-playbook.md` — RSA/ad testing module.
- General RSA testing, ad testing metrics, ad group organization, Ad Strength, and ad+landing-page testing patterns.
