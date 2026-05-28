/**
 * Every GAQL string fired by the audit engine, extracted as named builder
 * functions so `runAudit` and narrow view tools share the exact same query
 * text. Shared query text means the Phase 5 cache coalesces across tools —
 * `getWasteFindings` and `runAudit` called in the same session hit one
 * upstream fetch per query, not two.
 *
 * Each function is pure — it takes date/window parameters and returns a
 * string. Snapshot-tested in `queries.test.ts` so any deliberate change is
 * reviewed explicitly.
 */

/** Q0: Account info + settings. */
export function queryAccountInfo(): string {
  return `
      SELECT
        customer.id, customer.descriptive_name, customer.currency_code,
        customer.time_zone, customer.auto_tagging_enabled,
        customer.tracking_url_template
      FROM customer LIMIT 1
    `;
}

/** Q1: All campaigns with IS, budget, network, bid strategy, values. */
export function queryCampaigns(start: string, end: string): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        campaign.advertising_channel_type, campaign.bidding_strategy_type,
        campaign.target_cpa.target_cpa_micros,
        campaign.network_settings.target_search_network,
        campaign.network_settings.target_content_network,
        campaign.geo_target_type_setting.positive_geo_target_type,
        campaign_budget.amount_micros,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value, metrics.all_conversions,
        metrics.search_impression_share,
        metrics.search_budget_lost_impression_share,
        metrics.search_rank_lost_impression_share
      FROM campaign
      WHERE campaign.status != 'REMOVED'
        AND segments.date BETWEEN '${start}' AND '${end}'
      ORDER BY metrics.cost_micros DESC
    `;
}

/** Q2: Geo targeting criteria (LOCATION + PROXIMITY). */
export function queryGeoTargeting(): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        campaign_criterion.type, campaign_criterion.negative,
        campaign_criterion.location.geo_target_constant,
        campaign_criterion.proximity.radius,
        campaign_criterion.proximity.radius_units
      FROM campaign_criterion
      WHERE campaign.status = 'ENABLED'
        AND campaign_criterion.type IN ('LOCATION', 'PROXIMITY')
    `;
}

/** Q3: Top keywords by spend (with metrics). Positives only — keyword_view includes ad-group negatives.
 *  Status filters target the CURRENT live config. GAQL joins historical metrics with point-in-time
 *  dimensions, so `status = 'ENABLED'` filters to entities active right now — even on a 30-day
 *  metric window. This is how we stop yesterday's paused keywords from re-surfacing in today's
 *  "what should I fix" output (the stale-recommendation loop). For historical "what changed"
 *  analysis, query without these filters. */
export function queryKeywords(start: string, end: string): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        ad_group.id, ad_group.name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.negative,
        metrics.impressions, metrics.clicks, metrics.ctr,
        metrics.cost_micros, metrics.average_cpc, metrics.conversions
      FROM keyword_view
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_criterion.status = 'ENABLED'
        AND ad_group_criterion.negative = FALSE
      ORDER BY metrics.cost_micros DESC
      LIMIT 2000
    `;
}

/** Q4: Quality score lookup table for all active keywords. */
export function queryQualityScores(): string {
  return `
      SELECT
        campaign.status,
        ad_group_criterion.criterion_id,
        ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score,
        ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr
      FROM ad_group_criterion
      WHERE campaign.status = 'ENABLED'
        AND ad_group_criterion.type = 'KEYWORD'
        AND ad_group_criterion.status != 'REMOVED'
    `;
}

/** Q5: Top search terms by spend.
 *  Status filters target current live config — ad groups paused yesterday no longer surface in
 *  today's recommendation pass (see Q3 for the GAQL semantic). `search_term_view` exposes no
 *  criterion-level status so the underlying matched-keyword pause case is still possible; the
 *  per-row `recentChange` annotation (built from `change_event`) covers that remainder. */
export function querySearchTerms(start: string, end: string): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        ad_group.id, ad_group.name,
        search_term_view.search_term, search_term_view.status,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions
      FROM search_term_view
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 2000
    `;
}

/** Q6: Converting search terms (used for mining + negative-conflict detection).
 *  Same current-state status filters as Q5 — mining a paused ad group for new positive keywords
 *  would propose adding them back to a campaign that no longer serves. */
export function queryConvertingSearchTerms(start: string, end: string): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        ad_group.id, ad_group.name,
        search_term_view.search_term,
        metrics.conversions, metrics.cost_micros, metrics.clicks
      FROM search_term_view
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND metrics.conversions > 0
      ORDER BY metrics.conversions DESC
      LIMIT 500
    `;
}

/** Q7: Zero-conversion keywords (candidate waste). Positives only — without the negative filter,
 * ad-group negatives would all match conversions=0 by definition (they block serving).
 *
 * Status filters on campaign/ad_group/criterion target current live config (see Q3 docstring for
 * the GAQL semantic). This is THE query that primarily drove the stale-recommendation loop: a
 * keyword paused yesterday in a still-active campaign used to surface every day until its 30-day
 * window of spend rolled off. With the criterion-level filter it's gone the moment the pause
 * commits. */
export function queryZeroConversionKeywords(start: string, end: string): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        ad_group.id, ad_group.name,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.criterion_id,
        ad_group_criterion.negative,
        metrics.clicks, metrics.cost_micros
      FROM keyword_view
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_criterion.status = 'ENABLED'
        AND ad_group_criterion.negative = FALSE
        AND metrics.conversions = 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 500
    `;
}

/** Q8: Ad copy + strength. */
export function queryAds(start: string, end: string): string {
  return `
      SELECT
        campaign.id, campaign.status,
        ad_group.name,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad_strength, ad_group_ad.status,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions
      FROM ad_group_ad
      WHERE campaign.status = 'ENABLED'
        AND ad_group_ad.status != 'REMOVED'
        AND segments.date BETWEEN '${start}' AND '${end}'
      ORDER BY metrics.cost_micros DESC
      LIMIT 1000
    `;
}

/** Q9: Ad groups with per-group metrics. */
export function queryAdGroups(): string {
  return `
      SELECT
        campaign.id, campaign.status,
        ad_group.id, ad_group.name, ad_group.status,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions
      FROM ad_group
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 1000
    `;
}

/** Q10: Conversion actions. */
export function queryConversionActions(): string {
  // owner_customer + type let agents filter out read-only actions before
  // calling updateConversionAction. GA4-imported, Floodlight, Firebase, and
  // manager-owned actions return mutate_error=9 if mutated; selecting them
  // here lets a script skip them client-side instead of probing one at a time.
  return `
      SELECT
        conversion_action.id, conversion_action.name,
        conversion_action.category, conversion_action.type,
        conversion_action.status, conversion_action.counting_type,
        conversion_action.include_in_conversions_metric,
        conversion_action.primary_for_goal,
        conversion_action.owner_customer,
        conversion_action.value_settings.default_value
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
      ORDER BY conversion_action.name ASC
    `;
}

/** Conversion counts segmented by conversion action. Cost/click metrics are
 * intentionally omitted because Google does not allow those with
 * segments.conversion_action_name. */
export function queryConversionActionPerformance(start: string, end: string): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        segments.conversion_action_name,
        metrics.conversions, metrics.conversions_value,
        metrics.all_conversions, metrics.all_conversions_value
      FROM campaign
      WHERE campaign.status != 'REMOVED'
        AND segments.date BETWEEN '${start}' AND '${end}'
      ORDER BY metrics.conversions DESC
      LIMIT 500
    `;
}

/** Q11: Audience segments (existence check only — LIMIT 1). */
export function queryAudienceSegmentCheck(): string {
  return `
      SELECT campaign.id, campaign.status, ad_group.id, ad_group_criterion.type
      FROM ad_group_criterion
      WHERE campaign.status = 'ENABLED'
        AND ad_group_criterion.type IN ('USER_LIST', 'CUSTOM_AUDIENCE', 'COMBINED_AUDIENCE')
      LIMIT 1
    `;
}

/** Q12: Device performance segmentation. */
export function queryDevicePerformance(start: string, end: string): string {
  return `
      SELECT
        campaign.id, campaign.status, segments.device,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date BETWEEN '${start}' AND '${end}'
      ORDER BY metrics.cost_micros DESC
    `;
}

/** Q13: Negative keywords per campaign. */
export function queryNegativeKeywords(): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        campaign_criterion.keyword.text,
        campaign_criterion.keyword.match_type
      FROM campaign_criterion
      WHERE campaign.status = 'ENABLED'
        AND campaign_criterion.type = 'KEYWORD'
        AND campaign_criterion.negative = TRUE
    `;
}

/** Q14: Network type segmentation (Search vs Search Partners vs Display). */
export function queryNetworkSegmentation(start: string, end: string): string {
  return `
      SELECT
        campaign.id, campaign.status, segments.ad_network_type,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE campaign.status = 'ENABLED'
        AND segments.date BETWEEN '${start}' AND '${end}'
    `;
}

/** Active Google Ads recommendations. Keep this conservative: agents can use
 * the type/resource/campaign as a launcher, then call getResourceMetadata if
 * they need type-specific nested details. */
export function queryRecommendations(): string {
  return `
      SELECT
        recommendation.resource_name,
        recommendation.type,
        recommendation.dismissed,
        recommendation.campaign
      FROM recommendation
      WHERE recommendation.dismissed = FALSE
      LIMIT 1000
    `;
}

/** Billing setup overview. Avoid payments_account_info.* because it is
 * frequently hallucinated and not portable across Ads API surfaces. */
export function queryBillingSetups(): string {
  return `
      SELECT
        billing_setup.id,
        billing_setup.status,
        billing_setup.payments_account
      FROM billing_setup
      LIMIT 100
    `;
}

/** Q15: Campaign assets / extensions. */
export function queryCampaignAssets(): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        campaign_asset.field_type
      FROM campaign_asset
      WHERE campaign.status = 'ENABLED'
    `;
}

/** Q16: Landing page performance. */
export function queryLandingPages(start: string, end: string): string {
  return `
      SELECT
        campaign.status,
        landing_page_view.unexpanded_final_url,
        metrics.impressions, metrics.clicks, metrics.cost_micros,
        metrics.conversions
      FROM landing_page_view
      WHERE segments.date BETWEEN '${start}' AND '${end}'
        AND campaign.status = 'ENABLED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 200
    `;
}

/**
 * Q17: Account changes via `change_event`. Google Ads caps this at 30 rolling
 * days; callers must tighten `start` to the window they want inside that cap.
 * Filter uses `>=`/`<=` (BETWEEN is not supported for change_date_time) and
 * requires `ORDER BY change_date_time DESC`.
 */
export function queryChangeEvents(start: string, end: string): string {
  const today = new Date();
  const earliest = new Date(today);
  earliest.setDate(today.getDate() - 29);
  const earliestStart = earliest.toISOString().slice(0, 10);
  const safeStart = start < earliestStart ? earliestStart : start;

  return `
      SELECT
        change_event.change_date_time,
        change_event.change_resource_type,
        change_event.resource_name,
        change_event.client_type,
        change_event.user_email,
        change_event.changed_fields,
        change_event.resource_change_operation,
        change_event.campaign,
        change_event.ad_group
      FROM change_event
      WHERE change_event.change_date_time >= '${safeStart} 00:00:00'
        AND change_event.change_date_time <= '${end} 23:59:59'
      ORDER BY change_event.change_date_time DESC
      LIMIT 500
    `;
}


/** Q18: Ad group assets / extensions. */
export function queryAdGroupAssets(): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        ad_group.id, ad_group.name, ad_group.status,
        ad_group_asset.field_type
      FROM ad_group_asset
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status != 'REMOVED'
    `;
}

/** Q19: Shared negative keyword lists. */
export function querySharedNegativeKeywordLists(): string {
  return `
      SELECT
        shared_set.id, shared_set.name, shared_set.type,
        shared_set.member_count, shared_set.status
      FROM shared_set
      WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
        AND shared_set.status != 'REMOVED'
      ORDER BY shared_set.name ASC
    `;
}

/** Q20: Members of shared negative keyword lists. */
export function querySharedNegativeKeywordMembers(): string {
  return `
      SELECT
        shared_set.id, shared_set.name, shared_set.status,
        shared_criterion.keyword.text,
        shared_criterion.keyword.match_type
      FROM shared_criterion
      WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
        AND shared_set.status != 'REMOVED'
    `;
}

/** Q21: Paused/non-removed campaigns so stale cruft is visible in audits. */
export function queryPausedCampaigns(): string {
  return `
      SELECT
        campaign.id, campaign.name, campaign.status,
        campaign.advertising_channel_type, campaign.bidding_strategy_type,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.status = 'PAUSED'
      ORDER BY campaign.name ASC
      LIMIT 500
    `;
}

/** Q22: Manager links visible from this customer. Useful for agency/access audits. */
export function queryCustomerManagerLinks(): string {
  return `
      SELECT
        customer_manager_link.manager_customer,
        customer_manager_link.manager_link_id,
        customer_manager_link.status
      FROM customer_manager_link
      WHERE customer_manager_link.status IN ('ACTIVE', 'PENDING')
      LIMIT 100
    `;
}

/** Q23: Per-day per-campaign metrics for pre/post-change splits. */
export function queryDailyCampaignMetrics(start: string, end: string): string {
  return `
      SELECT
        campaign.id, segments.date,
        metrics.cost_micros, metrics.clicks, metrics.conversions
      FROM campaign
      WHERE campaign.status != 'REMOVED'
        AND segments.date BETWEEN '${start}' AND '${end}'
    `;
}
