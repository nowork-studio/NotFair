# Conversion + Network Integrity Audit

Use this during first-time audits, regression explanations, Smart Bidding/budget recommendations, Search Partners questions, or any account where CPA/ROAS looks suspicious.

Bid, budget, negative, and ad-test decisions are only as good as the conversion and traffic segment data behind them. Measurement and network mix are prerequisite checks, not afterthoughts.

---

## 1. Conversion tracking integrity

Pull conversion-action inventory and campaign conversion settings before recommending aggressive optimization.

Check:

- Enabled primary conversion actions exist and match the business goal.
- Lead-gen counting is normally `ONE_PER_CLICK`; purchases/subscriptions may be `MANY_PER_CLICK`.
- Conversion values/currencies are present and sane when using value-based bidding.
- Imported/read-only actions are not treated as mutable API targets.
- Campaign-specific goals do not optimize one campaign for irrelevant actions.
- Duplicate actions/tags are not double-counting the same event.
- Offline/call/form coverage matches how revenue actually happens.
- Recent zero-conversion cliffs are not caused by tag/site/form changes.

Stop condition:

- If tracking is materially broken, say so and recommend fixing measurement before bid/budget changes. Do not optimize on bad signal.

---

## 2. Network segmentation

Use for Search Partners, Display-in-Search leakage, unexplained CPA/CVR shifts.

Pull by `segments.ad_network_type` when compatible:

- cost, clicks, impressions, conversions, conversion value
- CTR, CVR, CPA/ROAS
- campaign/ad group
- search terms where available

Interpretation:

- **Google Search better, Partners material and worse:** recommend disabling Search Partners or testing without them.
- **Partners better or similar:** keep, but monitor because partner mix is opaque and can shift.
- **Tiny partner volume:** do not overreact.
- **Display Network in Search campaign:** flag as structural leakage unless intentionally enabled.

Search Partners decision must be based on the account's goal metric, not CTR alone. A lower CTR partner segment can still be profitable; a high CTR segment can still produce junk leads.

---

## 3. Regression lens

When conversions or CVR change, split the diagnosis:

- Traffic volume changed: impressions/clicks/search demand/impression share.
- Traffic quality changed: search terms, network, match type, geography/device.
- Conversion rate changed: landing page, tracking, form, offer, site speed.
- Bidding changed: strategy, targets, learning, budget caps.
- Measurement changed: conversion actions, primary flags, tag health, offline import.

Always overlay recent changes from NotFair changes and Google `change_event` before attributing causality.

---

## Sources

- `../../shared/ppc-optimization-pattern-playbook.md` — conversion tracking, Search Partners, and conversion-change diagnosis modules.
- General conversion tracking, Search Partners evaluation, assisted conversions, and KPI monitoring patterns.
