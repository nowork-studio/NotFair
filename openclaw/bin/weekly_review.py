#!/usr/bin/env python3
"""Run an automated weekly review for a site using GSC analysis output."""

from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote_plus, unquote, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from persist_run import persist_payload
from runtime import load_json, workspace_root
from site_id import normalize_site_id

ANALYZE_GSC = Path(__file__).resolve().parents[2] / "seo" / "seo-analysis" / "scripts" / "analyze_gsc.py"
DEFAULT_PRIMARY_METRIC = "non_brand_clicks_28d"


SEO_BEST_PRACTICE_REFERENCE = "seo/shared/seo-best-practices.md"
SEO_BEST_PRACTICE_AREAS: dict[str, dict[str, Any]] = {
    "search_eligibility_indexability": {
        "label": "Search eligibility & indexability",
        "resources": [
            "Google Search Essentials",
            "Google Search Central SEO Starter Guide",
        ],
        "why": "Google must be able to discover, crawl, render, canonicalize, and index the right URL before content changes can work.",
    },
    "demand_intent_targeting": {
        "label": "Demand & intent targeting",
        "resources": [
            "Ahrefs Beginner’s Guide to SEO",
            "Moz Beginner’s Guide to SEO",
            "Google helpful content guidance",
        ],
        "why": "The operator should first choose the valuable search demand and map each query intent to the page that should own it.",
    },
    "content_usefulness_trust": {
        "label": "Content usefulness & trust",
        "resources": [
            "Google helpful, reliable, people-first content guidance",
            "Google Search Quality concepts: E-E-A-T",
        ],
        "why": "Pages need original, complete, trustworthy information that satisfies the searcher, not just search-engine-first copy.",
    },
    "on_page_relevance_serp_packaging": {
        "label": "On-page relevance & SERP packaging",
        "resources": [
            "Google Search Central SEO Starter Guide",
            "Google structured data documentation",
            "Moz Beginner’s Guide to SEO",
        ],
        "why": "Titles, headings, snippets, structured data, and above-the-fold packaging help users and search engines understand why the page is the right result.",
    },
    "technical_ux_page_experience": {
        "label": "Technical UX & page experience",
        "resources": [
            "Google page experience documentation",
            "Google Core Web Vitals guidance",
        ],
        "why": "Fast, secure, mobile-friendly, non-intrusive pages support better user outcomes and can contribute when helpful content is otherwise competitive.",
    },
    "authority_distribution": {
        "label": "Authority & distribution",
        "resources": [
            "Ahrefs link building guidance",
            "Moz link building guidance",
            "Google Search Essentials promotion guidance",
        ],
        "why": "Competitive topics often need internal link equity, citations, mentions, or other legitimate reputation signals beyond page-level copy.",
    },
    "local_presence_reputation": {
        "label": "Local presence & reputation",
        "resources": [
            "Google Business Profile local ranking guidance",
            "Ahrefs local SEO guidance",
        ],
        "why": "Local rankings depend on relevance, distance, and prominence, including complete business information, reviews, photos, and locally specific proof.",
    },
    "measurement_prioritization_experimentation": {
        "label": "Measurement, prioritization & experimentation",
        "resources": [
            "Google Search Central measurement guidance",
            SEO_BEST_PRACTICE_REFERENCE,
        ],
        "why": "SEO work should be prioritized by expected business impact, measured against baselines, and followed up after enough data matures.",
    },
}

ACTION_BEST_PRACTICE_AREAS = {
    "canonical_or_tracking_investigation": "search_eligibility_indexability",
    "query_intent_mapping": "demand_intent_targeting",
    "local_intent_ownership": "demand_intent_targeting",
    "content_refresh": "content_usefulness_trust",
    "page_improvement": "content_usefulness_trust",
    "meta_tags": "on_page_relevance_serp_packaging",
    "snippet_content_packaging": "on_page_relevance_serp_packaging",
    "internal_links": "authority_distribution",
    "manual_review": "measurement_prioritization_experimentation",
}


def future_iso(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def metric_snapshot_from_analysis(data: dict[str, Any]) -> dict[str, float]:
    period_days = int((data.get("period") or {}).get("days") or 28)
    suffix = f"_{period_days}d"
    summary = data.get("summary") or {}
    branded_split = data.get("branded_split") or {}
    branded = branded_split.get("branded") or {}
    non_branded = branded_split.get("non_branded") or {}
    snapshot: dict[str, float] = {
        f"organic_clicks{suffix}": float(summary.get("clicks", 0)),
        f"organic_impressions{suffix}": float(summary.get("impressions", 0)),
        f"organic_ctr{suffix}": float(summary.get("ctr", 0)),
        f"avg_position{suffix}": float(summary.get("position", 0)),
    }
    if branded_split:
        snapshot[f"non_brand_clicks{suffix}"] = float(non_branded.get("clicks", 0))
        snapshot[f"branded_clicks{suffix}"] = float(branded.get("clicks", 0))
        snapshot[f"non_brand_impressions{suffix}"] = float(non_branded.get("impressions", 0))
        snapshot[f"branded_impressions{suffix}"] = float(branded.get("impressions", 0))
    return snapshot


def learned_multiplier(learned: dict[str, Any], action_type: str, primary_metric: str) -> float:
    priors = (learned or {}).get("priors") or {}
    prior = priors.get(f"{action_type}::{primary_metric}")
    if not prior:
        return 1.0
    sample_size = max(int(prior.get("sample_size", 0)), 1)
    wins = int(prior.get("wins", 0))
    losses = int(prior.get("losses", 0))
    neutral = int(prior.get("neutral", 0))
    avg_change = float(prior.get("avg_primary_change", 0.0))
    confidence = float(prior.get("confidence", 0.0))
    win_rate = wins / sample_size
    loss_rate = losses / sample_size
    neutral_rate = neutral / sample_size
    raw = 1.0 + (win_rate * 0.25) - (loss_rate * 0.2) + (avg_change * 0.5) + (confidence * 0.1) + (neutral_rate * 0.02)
    return max(0.7, min(1.5, round(raw, 3)))


TRACKING_PARAM_NAMES = {
    "fbclid",
    "gclid",
    "gbraid",
    "wbraid",
    "mc_cid",
    "mc_eid",
    "msclkid",
}
TRACKING_PARAM_PREFIXES = ("utm_",)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def expected_ctr_for_position(position: float | None) -> float:
    """Return a conservative expected CTR percentage for a rough SERP position."""
    if position is None or position <= 0:
        return 1.0
    if position <= 1.5:
        return 18.0
    if position <= 3:
        return 10.0
    if position <= 5:
        return 6.0
    if position <= 10:
        return 3.0
    if position <= 20:
        return 1.5
    return 0.5


def sample_confidence(clicks: float = 0, impressions: float = 0) -> float:
    """Soft confidence curve: larger samples earn more trust without a hard cutoff."""
    click_component = 1 - math.exp(-max(clicks, 0) / 35)
    impression_component = 1 - math.exp(-max(impressions, 0) / 1200)
    return round(clamp(0.25 + (click_component * 0.45) + (impression_component * 0.3), 0.25, 1.0), 3)


def url_context(url: str | None) -> dict[str, Any]:
    if not url:
        return {
            "raw_target": None,
            "canonical_target": None,
            "url_quality_score": 0.8,
            "has_tracking_params": False,
            "operator_judgment_notes": [],
        }

    parsed = urlparse(url)
    query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
    tracking_keys = [key for key, _ in query_pairs if key in TRACKING_PARAM_NAMES or key.startswith(TRACKING_PARAM_PREFIXES)]
    remaining_pairs = [(key, value) for key, value in query_pairs if key not in TRACKING_PARAM_NAMES and not key.startswith(TRACKING_PARAM_PREFIXES)]
    canonical_path = parsed.path or "/"
    canonical_query = urlencode(remaining_pairs, doseq=True)
    canonical = urlunparse((parsed.scheme, parsed.netloc, canonical_path, "", canonical_query, ""))

    notes = []
    if tracking_keys:
        notes.append(f"tracking URL variant ({', '.join(sorted(set(tracking_keys)))})")
    if query_pairs and not remaining_pairs:
        notes.append("canonical target removes query parameters")

    if tracking_keys and not remaining_pairs:
        url_quality = 0.45
    elif tracking_keys:
        url_quality = 0.65
    elif query_pairs:
        url_quality = 0.8
    else:
        url_quality = 1.0

    return {
        "raw_target": url,
        "canonical_target": canonical,
        "url_quality_score": url_quality,
        "has_tracking_params": bool(tracking_keys),
        "operator_judgment_notes": notes,
    }


def severity_from_score(score: float) -> str:
    if score >= 1.4:
        return "critical"
    if score >= 0.65:
        return "warning"
    return "info"


def make_issue(
    title: str,
    severity: str,
    confidence: float,
    evidence: list[str],
    action_type: str,
    target: str | None = None,
    base_priority: float = 0.5,
    **extra: Any,
) -> dict[str, Any]:
    context = url_context(target)
    issue = {
        "title": title,
        "severity": severity,
        "confidence": round(confidence, 2),
        "evidence": evidence,
        "recommended_action_type": action_type,
        "base_priority": round(base_priority, 3),
        "operator_judgment_notes": extra.pop("operator_judgment_notes", []) + context["operator_judgment_notes"],
        "score_components": extra.pop("score_components", {}),
        "raw_target": context["raw_target"],
        "canonical_target": context["canonical_target"],
    }
    if target:
        issue["target"] = context["canonical_target"] or target
    issue.update(extra)
    return issue


def best_practice_alignment_for_issue(issue: dict[str, Any]) -> dict[str, Any]:
    """Attach the primary MECE SEO best-practice lane for operator review."""
    action_type = str(issue.get("recommended_action_type") or "manual_review")
    area_key = ACTION_BEST_PRACTICE_AREAS.get(action_type)
    if area_key is None:
        return {
            "reference": SEO_BEST_PRACTICE_REFERENCE,
            "primary_area": "unmapped",
            "primary_area_label": "Unmapped SEO action type",
            "resources": [SEO_BEST_PRACTICE_REFERENCE],
            "notes": [
                f"Action type '{action_type}' is not mapped to a MECE SEO best-practice lane.",
                "Downgrade to investigation/manual review or update ACTION_BEST_PRACTICE_AREAS before treating this as an approved recommendation.",
            ],
        }

    area = SEO_BEST_PRACTICE_AREAS[area_key]
    notes = [area["why"]]

    if action_type in {"meta_tags", "snippet_content_packaging"}:
        notes.append("Validate the query/page/SERP fit before treating low CTR as a title or meta-description problem.")
    elif action_type in {"query_intent_mapping", "local_intent_ownership"}:
        notes.append("Resolve search intent ownership before changing content, redirects, canonicals, or metadata.")
    elif action_type == "page_improvement":
        notes.append("A regression is a diagnosis trigger; inspect content usefulness, SERP changes, and technical access before publishing edits.")
    elif action_type == "internal_links":
        notes.append("Use relevant internal links to clarify page ownership and distribute authority; do not jump straight to redirects.")
    elif action_type == "canonical_or_tracking_investigation":
        notes.append("Canonical/tracking variants should be investigated as URL hygiene before editing page copy.")

    return {
        "reference": SEO_BEST_PRACTICE_REFERENCE,
        "primary_area": area_key,
        "primary_area_label": area["label"],
        "resources": area["resources"],
        "notes": notes,
    }



LOCAL_INTENT_TERMS = {
    "near me",
    "nearby",
    "local",
    "open now",
}
COMMERCIAL_SERVICE_TERMS = {
    "service",
    "services",
    "repair",
    "installation",
    "contractor",
    "company",
    "provider",
    "appointment",
    "booking",
    "quote",
    "consultation",
}
INFORMATIONAL_SERP_TERMS = {
    "how much",
    "average",
    "cost",
    "price",
    "prices",
    "per day",
    "per night",
    "for a week",
}


def business_intent_for_query(query: str | None) -> tuple[float, str, list[str]]:
    """Estimate whether click upside is likely to map to revenue, not just visits.

    This is deliberately a soft judgment lever, not a hard rule. Informational
    price queries can be valuable, but they often have zero-click SERPs and need
    content/CTA packaging, not metadata-only edits.
    """
    if not query:
        return 0.7, "unknown", ["query intent unknown; validate before editing metadata"]

    q = query.lower()
    has_local = any(term in q for term in LOCAL_INTENT_TERMS)
    has_service = any(term in q for term in COMMERCIAL_SERVICE_TERMS)
    has_info = any(term in q for term in INFORMATIONAL_SERP_TERMS)

    if has_local and has_service:
        return 1.0, "local_commercial", []
    if "near me" in q:
        return 0.95, "local_commercial", []
    if has_service and not has_info:
        return 0.85, "commercial", []
    if has_info and has_service:
        return 0.7, "commercial_research", [
            "commercial research query; metadata alone is unproven",
            "possible zero-click/SERP-answer behavior; inspect SERP before assuming CTR lift",
        ]
    if has_info:
        return 0.55, "informational", [
            "informational query; click upside may not convert",
            "possible zero-click/SERP-answer behavior; inspect SERP before assuming CTR lift",
        ]
    return 0.75, "mixed", ["mixed intent; validate business value before content edits"]


def zero_click_risk_for_query(query: str | None, intent_class: str | None = None) -> tuple[str, list[str]]:
    q = (query or "").lower()
    notes = []
    risk_score = 0
    if intent_class in {"commercial_research", "informational"}:
        risk_score += 1
        notes.append(f"{intent_class} intent often gets answered directly on the SERP")
    if any(term in q for term in INFORMATIONAL_SERP_TERMS):
        risk_score += 1
        notes.append("price/how-much wording can trigger answer boxes or calculator-style snippets")
    if any(term in q for term in LOCAL_INTENT_TERMS):
        risk_score -= 1
        notes.append("local modifier increases booking intent and reduces pure zero-click risk")
    if risk_score >= 2:
        return "high", notes
    if risk_score == 1:
        return "medium", notes
    return "low", notes or ["query does not look primarily answer-box driven"]


def is_branded_query(query: str | None, brand_terms: list[str] | None) -> bool:
    if not query or not brand_terms:
        return False
    q = query.lower()
    return any(term and term.lower() in q for term in brand_terms)


def goal_alignment_for_query(query: str | None, brand_terms: list[str] | None) -> tuple[float, list[str]]:
    if is_branded_query(query, brand_terms):
        return 0.35, ["branded/navigational query; lower priority for non-brand growth"]
    return 1.0, []


def decline_issue(page: dict[str, Any]) -> dict[str, Any]:
    raw_target = page.get("page")
    context = url_context(raw_target)
    clicks_now = float(page.get("clicks_now") or 0)
    clicks_prev = float(page.get("clicks_prev") or 0)
    lost_clicks = max(clicks_prev - clicks_now, 0.0)
    change_pct = float(page.get("change_pct") or 0)
    confidence = sample_confidence(clicks=clicks_prev + clicks_now)
    impact_score = clamp(lost_clicks / 50, 0.05, 2.0)
    actionability_score = 0.75
    action_type = "page_improvement"
    title_target = raw_target
    notes = []
    if context["has_tracking_params"]:
        action_type = "canonical_or_tracking_investigation"
        actionability_score = 0.45
        notes.append("treat as attribution/canonical investigation before editing page content")
        title_target = context["canonical_target"] or raw_target
    if lost_clicks < 25:
        notes.append("low absolute click loss; percentage drop may overstate impact")

    url_quality = float(context["url_quality_score"])
    score = impact_score * confidence * actionability_score * url_quality
    return make_issue(
        f"Traffic dropped on {title_target}",
        severity_from_score(score),
        confidence,
        [
            f"Clicks changed {change_pct}% vs prior period.",
            f"Current clicks: {clicks_now:g} | previous clicks: {clicks_prev:g} | lost clicks: {lost_clicks:g}",
        ],
        action_type,
        target=raw_target,
        base_priority=impact_score,
        expected_click_delta=round(-lost_clicks, 1),
        priority_score=round(score, 3),
        score_components={
            "expected_impact": round(impact_score, 3),
            "confidence_score": confidence,
            "goal_alignment_score": 1.0,
            "actionability_score": actionability_score,
            "url_quality_score": url_quality,
        },
        operator_judgment_notes=notes,
    )


def ctr_gap_issue(gap: dict[str, Any], brand_terms: list[str] | None = None) -> dict[str, Any]:
    raw_target = gap.get("page")
    clicks = float(gap.get("clicks") or 0)
    impressions = float(gap.get("impressions") or 0)
    ctr = float(gap.get("ctr") or 0)
    position = float(gap.get("position") or 0)
    expected_ctr = expected_ctr_for_position(position)
    incremental_clicks = max(impressions * ((expected_ctr - ctr) / 100), 0.0)
    impact_score = clamp(incremental_clicks / 50, 0.05, 2.0)
    confidence = sample_confidence(clicks=clicks, impressions=impressions)
    query = gap.get("query")
    business_intent_score, intent_class, intent_notes = business_intent_for_query(query)
    actionability_score = 0.95
    action_type = "meta_tags"
    action_notes = ["clear snippet/title lever with measurable upside"]
    if intent_class in {"commercial_research", "informational", "mixed", "unknown"}:
        action_type = "snippet_content_packaging"
        actionability_score = 0.75
        action_notes = [
            "low CTR is a hypothesis, not proof of bad metadata",
            "recommend SERP + snippet + above-the-fold content diagnosis before editing",
        ]
    url_quality = float(url_context(raw_target)["url_quality_score"])
    goal_alignment_score, goal_notes = goal_alignment_for_query(query, brand_terms)
    score = impact_score * confidence * goal_alignment_score * actionability_score * url_quality * business_intent_score
    evidence = [
        f"{impressions:g} impressions with CTR {ctr}%.",
        f"Average position {position:g}; conservative expected CTR {expected_ctr}% suggests ~{incremental_clicks:.0f} incremental-click upside before intent/zero-click discount.",
        f"Query intent classified as {intent_class} with business intent score {business_intent_score:g}.",
    ]
    if query:
        evidence.append(f"Underperforming query: {query}")
    return make_issue(
        f"High-impression page with low CTR: {raw_target}",
        severity_from_score(score),
        confidence,
        evidence,
        action_type,
        target=raw_target,
        base_priority=impact_score,
        expected_click_delta=round(incremental_clicks * business_intent_score, 1),
        priority_score=round(score, 3),
        primary_query=query,
        intent_class=intent_class,
        score_components={
            "expected_impact": round(impact_score, 3),
            "confidence_score": confidence,
            "goal_alignment_score": goal_alignment_score,
            "business_intent_score": business_intent_score,
            "actionability_score": actionability_score,
            "url_quality_score": url_quality,
        },
        operator_judgment_notes=[*action_notes, *intent_notes, *goal_notes],
    )


def cannibalization_issue(cannibal: dict[str, Any], brand_terms: list[str] | None = None) -> dict[str, Any]:
    raw_target = cannibal.get("winner_page")
    impressions = float(cannibal.get("total_impressions") or 0)
    clicks = float(cannibal.get("total_clicks") or 0)
    impact_score = clamp(impressions / 5000, 0.05, 1.4)
    confidence = sample_confidence(clicks=clicks, impressions=impressions)
    actionability_score = 0.65
    url_quality = float(url_context(raw_target)["url_quality_score"])
    goal_alignment_score, goal_notes = goal_alignment_for_query(cannibal.get("query"), brand_terms)
    score = impact_score * confidence * goal_alignment_score * actionability_score * url_quality
    loser_pages = cannibal.get("loser_pages", [])
    return make_issue(
        f"Cannibalization on query '{cannibal.get('query')}'",
        severity_from_score(score),
        confidence,
        [
            f"Winner page: {raw_target}",
            f"Competing pages: {', '.join(loser_pages[:8])}{'...' if len(loser_pages) > 8 else ''}",
            f"Affected query set: {impressions:g} impressions and {clicks:g} clicks.",
        ],
        "internal_links",
        target=raw_target,
        base_priority=impact_score,
        expected_click_delta=None,
        priority_score=round(score, 3),
        score_components={
            "expected_impact": round(impact_score, 3),
            "confidence_score": confidence,
            "goal_alignment_score": goal_alignment_score,
            "actionability_score": actionability_score,
            "url_quality_score": url_quality,
        },
        operator_judgment_notes=["needs intent review before redirects/canonicals", *goal_notes],
    )


def query_ctr_issue(opp: dict[str, Any], brand_terms: list[str] | None = None) -> dict[str, Any]:
    impressions = float(opp.get("impressions") or 0)
    clicks = float(opp.get("clicks") or 0)
    ctr = float(opp.get("ctr") or 0)
    position = float(opp.get("position") or 0)
    expected_ctr = expected_ctr_for_position(position)
    incremental_clicks = max(impressions * ((expected_ctr - ctr) / 100), 0.0)
    impact_score = clamp(incremental_clicks / 65, 0.05, 1.3)
    confidence = sample_confidence(clicks=clicks, impressions=impressions)
    actionability_score = 0.55  # Query-only; needs page mapping before editing.
    query = opp.get("query")
    business_intent_score, intent_class, intent_notes = business_intent_for_query(query)
    goal_alignment_score, goal_notes = goal_alignment_for_query(query, brand_terms)
    score = impact_score * confidence * goal_alignment_score * actionability_score * business_intent_score
    return make_issue(
        f"Query-level CTR opportunity: {query}",
        severity_from_score(score),
        confidence,
        [
            f"{impressions:g} impressions with CTR {ctr}%.",
            f"Average position {position:g}; conservative expected CTR {expected_ctr}% suggests ~{incremental_clicks:.0f} incremental-click upside before intent/zero-click discount.",
            f"Query intent classified as {intent_class} with business intent score {business_intent_score:g}.",
        ],
        "query_intent_mapping",
        base_priority=impact_score,
        expected_click_delta=round(incremental_clicks * business_intent_score, 1),
        priority_score=round(score, 3),
        primary_query=query,
        intent_class=intent_class,
        score_components={
            "expected_impact": round(impact_score, 3),
            "confidence_score": confidence,
            "goal_alignment_score": goal_alignment_score,
            "business_intent_score": business_intent_score,
            "actionability_score": actionability_score,
            "url_quality_score": 1.0,
        },
        operator_judgment_notes=["query-level signal; map to a concrete page before editing", *intent_notes, *goal_notes],
    )


def declining_query_issue(query: dict[str, Any], brand_terms: list[str] | None = None) -> dict[str, Any]:
    clicks_now = float(query.get("clicks_now") or 0)
    clicks_prev = float(query.get("clicks_prev") or 0)
    lost_clicks = max(clicks_prev - clicks_now, 0.0)
    confidence = sample_confidence(clicks=clicks_prev + clicks_now)
    impact_score = clamp(lost_clicks / 50, 0.05, 1.0)
    actionability_score = 0.5
    goal_alignment_score, goal_notes = goal_alignment_for_query(query.get("query"), brand_terms)
    score = impact_score * confidence * goal_alignment_score * actionability_score
    return make_issue(
        f"Query demand fell for '{query.get('query')}'",
        severity_from_score(score),
        confidence,
        [
            f"Clicks changed {query.get('change_pct')}% vs prior period.",
            f"Current clicks: {clicks_now:g} | previous clicks: {clicks_prev:g} | lost clicks: {lost_clicks:g}",
        ],
        "content_refresh",
        base_priority=impact_score,
        expected_click_delta=round(-lost_clicks, 1),
        priority_score=round(score, 3),
        score_components={
            "expected_impact": round(impact_score, 3),
            "confidence_score": confidence,
            "goal_alignment_score": goal_alignment_score,
            "actionability_score": actionability_score,
            "url_quality_score": 1.0,
        },
        operator_judgment_notes=["query-level regression; needs SERP/page diagnosis before editing", *goal_notes],
    )


def dedupe_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        key = candidate.get("canonical_target") or candidate.get("title")
        existing = by_key.get(key)
        if not existing or candidate.get("priority_score", 0) > existing.get("priority_score", 0):
            by_key[key] = candidate
        elif existing:
            existing.setdefault("operator_judgment_notes", []).append(f"Also saw signal: {candidate['title']}")
    return list(by_key.values())


def derive_candidate_issues(data: dict[str, Any]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    comparison = data.get("comparison") or {}
    ctr_gaps = data.get("ctr_gaps_by_page") or []
    cannibalization = data.get("cannibalization") or []
    ctr_opps = data.get("ctr_opportunities") or []
    declining_pages = comparison.get("declining_pages") or []
    declining_queries = comparison.get("declining_queries") or []
    brand_terms = data.get("_brand_terms") or []

    issues.extend(decline_issue(page) for page in declining_pages[:8])
    issues.extend(ctr_gap_issue(gap, brand_terms) for gap in ctr_gaps[:8])
    issues.extend(cannibalization_issue(cannibal, brand_terms) for cannibal in cannibalization[:5])
    issues.extend(query_ctr_issue(opp, brand_terms) for opp in ctr_opps[:5])
    issues.extend(declining_query_issue(query, brand_terms) for query in declining_queries[:5])

    return dedupe_candidates(issues)


def apply_prioritization(candidates: list[dict[str, Any]], learned: dict[str, Any], primary_metric: str) -> list[dict[str, Any]]:
    ranked = []
    for item in candidates:
        multiplier = learned_multiplier(learned, item["recommended_action_type"], primary_metric)
        score = float(item.get("priority_score", item.get("base_priority", 0.5))) * multiplier
        enriched = dict(item)
        enriched["priority_score"] = round(score, 3)
        enriched["learned_multiplier"] = multiplier
        enriched["severity"] = severity_from_score(score)
        ranked.append(enriched)
    ranked.sort(key=lambda issue: issue["priority_score"], reverse=True)
    return ranked



class PageSnapshotParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.meta_description = ""
        self.h1 = ""
        self._tag_stack: list[str] = []
        self._capture_title = False
        self._capture_h1 = False
        self._skip_depth = 0
        self.body_chunks: list[str] = []
        self.cta_texts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value or "" for key, value in attrs}
        tag = tag.lower()
        self._tag_stack.append(tag)
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        if tag == "title":
            self._capture_title = True
        if tag == "h1" and not self.h1:
            self._capture_h1 = True
        if tag == "meta" and attrs_dict.get("name", "").lower() == "description":
            self.meta_description = attrs_dict.get("content", "").strip()
        if tag in {"a", "button"}:
            aria = attrs_dict.get("aria-label", "").strip()
            if aria:
                self.cta_texts.append(aria)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._capture_title = False
        if tag == "h1":
            self._capture_h1 = False
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
        if self._tag_stack:
            self._tag_stack.pop()

    def handle_data(self, data: str) -> None:
        text = re.sub(r"\s+", " ", data).strip()
        if not text:
            return
        if self._capture_title:
            self.title = (self.title + " " + text).strip()
        if self._capture_h1 and not self.h1:
            self.h1 = (self.h1 + " " + text).strip()
        if self._skip_depth == 0:
            self.body_chunks.append(text)
            if self._tag_stack and self._tag_stack[-1] in {"a", "button"}:
                self.cta_texts.append(text)


def live_fetch_headers(site_profile: dict[str, Any] | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; ToprankOpenClawSEOOperator/1.0; +https://openclaw.ai)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    profile = site_profile or {}
    for name, value in (profile.get("live_fetch_headers") or {}).items():
        if value:
            headers[str(name)] = str(value)
    for name, env_name in (profile.get("live_fetch_header_env") or {}).items():
        value = os.environ.get(str(env_name))
        if value:
            headers[str(name)] = value

    bypass_env_names = [
        profile.get("vercel_protection_bypass_env"),
        "TOPRANK_VERCEL_PROTECTION_BYPASS",
        "VERCEL_PROTECTION_BYPASS",
        "VERCEL_AUTOMATION_BYPASS_SECRET",
    ]
    for env_name in bypass_env_names:
        if env_name and os.environ.get(str(env_name)):
            headers["x-vercel-protection-bypass"] = os.environ[str(env_name)]
            break
    return headers


def fetch_url_text(url: str, timeout: int = 12, site_profile: dict[str, Any] | None = None) -> tuple[str | None, dict[str, Any]]:
    request = Request(url, headers=live_fetch_headers(site_profile))
    try:
        with urlopen(request, timeout=timeout) as response:
            content_type = response.headers.get("content-type", "")
            raw = response.read(750_000)
            return raw.decode("utf-8", "ignore"), {"status": "ok", "http_status": response.status, "content_type": content_type}
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read(80_000).decode("utf-8", "ignore")
        except Exception:
            body = ""
        mitigated = "vercel" in body.lower() and ("security checkpoint" in body.lower() or "challenge" in body.lower())
        return None, {"status": "blocked", "http_status": exc.code, "reason": "vercel_security_checkpoint" if mitigated else str(exc)}
    except (TimeoutError, URLError) as exc:
        return None, {"status": "error", "reason": str(exc)}


def parse_html_snapshot(raw_html: str, source: str) -> dict[str, Any]:
    parser = PageSnapshotParser()
    parser.feed(raw_html)
    body = "\n".join(parser.body_chunks)
    body = re.sub(r"\s+", " ", html.unescape(body)).strip()
    return {
        "source": source,
        "status": "ok",
        "title": html.unescape(parser.title).strip(),
        "meta_description": html.unescape(parser.meta_description).strip(),
        "h1": html.unescape(parser.h1).strip(),
        "above_the_fold_text": body[:1800],
        "cta_texts": sorted({text.strip() for text in parser.cta_texts if text.strip()})[:12],
    }


def parse_frontmatter_snapshot(markdown: str, source_path: Path) -> dict[str, Any]:
    frontmatter: dict[str, Any] = {}
    body = markdown
    if markdown.startswith("---"):
        parts = markdown.split("---", 2)
        if len(parts) >= 3:
            body = parts[2]
            for line in parts[1].splitlines():
                if ":" not in line or line.strip().startswith("[") or line.strip().startswith("]"):
                    continue
                key, value = line.split(":", 1)
                value = value.strip().strip('"').strip("'")
                if value:
                    frontmatter[key.strip()] = value
    heading = ""
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            heading = stripped[2:].strip()
            break
    plain = re.sub(r"```.*?```", " ", body, flags=re.S)
    plain = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", plain)
    plain = re.sub(r"\[[^\]]+\]\([^)]*\)", lambda m: m.group(0).split("]", 1)[0].lstrip("["), plain)
    plain = re.sub(r"[#*_>`-]+", " ", plain)
    plain = re.sub(r"\s+", " ", plain).strip()
    return {
        "source": "local_source",
        "source_path": str(source_path),
        "status": "ok",
        "title": frontmatter.get("title", ""),
        "meta_description": frontmatter.get("description", ""),
        "h1": heading or frontmatter.get("title", ""),
        "above_the_fold_text": plain[:1800],
        "cta_texts": sorted(set(re.findall(r"(?i)\b(book now|book|reserve|call|schedule|request quote|get quote)\b", plain[:2500])))[:12],
    }


def discover_local_source(url: str | None, site_profile: dict[str, Any] | None = None) -> Path | None:
    if not url:
        return None
    parsed = urlparse(url)
    slug = Path(parsed.path).name
    if not slug:
        return None
    profile = site_profile or {}
    configured_roots = [Path(root).expanduser() for root in profile.get("source_roots", [])]
    project_root = profile.get("local_project_root")
    if project_root:
        configured_roots.append(Path(project_root).expanduser())
    search_roots = configured_roots or list((Path.home() / "Documents" / "Projects").glob("*"))
    candidates: list[Path] = []
    common_rel_paths = [
        Path("content/blogs") / f"{slug}.mdx",
        Path("content/blogs") / f"{slug}.md",
        Path("src/content/blogs") / f"{slug}.mdx",
        Path("app") / parsed.path.strip("/") / "page.tsx",
        Path("pages") / f"{slug}.tsx",
    ]
    for root in search_roots[:80]:
        if not root.exists() or not root.is_dir():
            continue
        for rel in common_rel_paths:
            path = root / rel
            if path.exists() and path.is_file():
                candidates.append(path)
    return candidates[0] if len(candidates) == 1 else None


def page_snapshot_for_url(url: str | None, site_profile: dict[str, Any] | None = None, live: bool = False) -> dict[str, Any]:
    source_path = discover_local_source(url, site_profile)
    if source_path:
        return parse_frontmatter_snapshot(source_path.read_text(errors="ignore"), source_path)
    if live and url:
        raw_html, meta = fetch_url_text(url, site_profile=site_profile)
        if raw_html:
            return parse_html_snapshot(raw_html, "live_fetch")
        return {"source": "live_fetch", **meta}
    return {"source": "none", "status": "unavailable", "reason": "no local source mapping and live fetch disabled"}


def parse_duckduckgo_results(raw_html: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    for match in re.finditer(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', raw_html, re.S):
        href = html.unescape(match.group(1))
        parsed_href = urlparse(href)
        if parsed_href.path.startswith("/l/"):
            params = dict(parse_qsl(parsed_href.query))
            href = unquote(params.get("uddg", href))
        elif href.startswith("//duckduckgo.com/l/"):
            params = dict(parse_qsl(urlparse("https:" + href).query))
            href = unquote(params.get("uddg", href))
        title = re.sub(r"<.*?>", "", match.group(2), flags=re.S)
        block = raw_html[match.end(): match.end() + 2500]
        snippet_match = re.search(r'class="result__snippet"[^>]*>(.*?)</(?:a|div)>', block, re.S)
        snippet_raw = snippet_match.group(1) if snippet_match else ""
        snippet = re.sub(r"<.*?>", "", snippet_raw, flags=re.S)
        domain = urlparse(href).netloc.lower().removeprefix("www.")
        if not domain:
            continue
        results.append({
            "title": html.unescape(re.sub(r"\s+", " ", title)).strip(),
            "url": href,
            "snippet": html.unescape(re.sub(r"\s+", " ", snippet)).strip(),
            "domain": domain,
        })
        if len(results) >= 8:
            break
    return results

def serp_snapshot_for_query(query: str | None, site_id: str, live: bool = False) -> dict[str, Any]:
    if not query:
        return {"source": "none", "status": "skipped", "reason": "no query available"}
    if not live:
        return {"source": "duckduckgo_html", "status": "skipped", "reason": "live SERP disabled"}
    url = "https://duckduckgo.com/html/?q=" + quote_plus(query)
    raw_html, meta = fetch_url_text(url)
    if not raw_html:
        return {"source": "duckduckgo_html", **meta}
    results = parse_duckduckgo_results(raw_html)
    if not results:
        return {"source": "duckduckgo_html", "status": "no_results_parsed", "query": query, "results": []}
    site_domain = site_id.lower().removeprefix("www.")
    own_positions = [idx + 1 for idx, result in enumerate(results) if site_domain in result.get("domain", "")]
    answer_like = any(re.search(r"\$\d|\b\d+\s*(?:-|to)\s*\$?\d+|per night|per day|average", " ".join([r.get("title", ""), r.get("snippet", "")]), re.I) for r in results[:5])
    return {
        "source": "duckduckgo_html",
        "status": "ok",
        "query": query,
        "results": results[:5],
        "own_domain_positions": own_positions,
        "answer_like_serp": answer_like,
        "competitor_domains": [r["domain"] for r in results[:5] if r.get("domain") and site_domain not in r["domain"]],
    }


def analyze_page_packaging(page_snapshot: dict[str, Any], query: str | None) -> dict[str, Any]:
    text = (page_snapshot.get("above_the_fold_text") or "").lower()
    title = (page_snapshot.get("title") or "").lower()
    description = (page_snapshot.get("meta_description") or "").lower()
    q = (query or "").lower()
    wants_price = any(term in q for term in INFORMATIONAL_SERP_TERMS)
    price_answer = bool(re.search(r"\$\d|\b\d+\s*(?:-|to)\s*\$?\d+|per night|per day", text[:1400], re.I))
    cta = bool(re.search(r"\b(book|reserve|call|schedule|get quote|request quote)\b", text[:1600], re.I)) or bool(page_snapshot.get("cta_texts"))
    query_terms = [term for term in re.findall(r"[a-z]{4,}", q) if term not in {"much", "does", "cost", "board", "with", "what"}]
    missing_terms = [term for term in query_terms if term not in title and term not in description and term not in text[:1400]]
    observations = []
    if wants_price and not price_answer:
        observations.append("above-the-fold text does not give a fast price/range answer")
    if not cta:
        observations.append("no obvious booking/call CTA detected above the fold")
    if missing_terms:
        observations.append(f"query terms not visible early: {', '.join(missing_terms[:5])}")
    if page_snapshot.get("status") != "ok":
        observations.append(f"page snapshot unavailable: {page_snapshot.get('reason') or page_snapshot.get('status')}")
    return {
        "status": "ok" if page_snapshot.get("status") == "ok" else "partial",
        "has_fast_price_answer_above_fold": price_answer if wants_price else None,
        "has_booking_cta_above_fold": cta,
        "missing_query_terms_above_fold": missing_terms[:8],
        "observations": observations or ["no obvious above-the-fold packaging issue detected by static analysis"],
    }


def matching_serp_result(serp: dict[str, Any], target: str | None) -> dict[str, Any] | None:
    if not target:
        return None
    parsed_target = urlparse(target)
    target_domain = parsed_target.netloc.lower().removeprefix("www.")
    target_path = parsed_target.path.rstrip("/")
    for result in serp.get("results") or []:
        parsed_result = urlparse(result.get("url") or "")
        result_domain = parsed_result.netloc.lower().removeprefix("www.")
        result_path = parsed_result.path.rstrip("/")
        if target_domain and target_domain == result_domain and target_path == result_path:
            return result
    return None


def deep_dive_diagnostic(issue: dict[str, Any], site_id: str, site_profile: dict[str, Any] | None = None, live: bool = False) -> dict[str, Any]:
    query = issue.get("primary_query")
    intent_class = issue.get("intent_class")
    target = issue.get("target") or issue.get("canonical_target") or issue.get("raw_target")
    if isinstance(target, str) and target.startswith("/"):
        target = f"https://www.{site_id}{target}"
    serp = serp_snapshot_for_query(query, site_id, live=live)
    page_snapshot = page_snapshot_for_url(target, site_profile, live=live)
    serp_result = matching_serp_result(serp, target)
    snippet_snapshot = page_snapshot
    if page_snapshot.get("status") != "ok" and serp_result:
        snippet_snapshot = {
            "source": "serp_result",
            "status": "ok",
            "title": serp_result.get("title"),
            "meta_description": serp_result.get("snippet"),
            "h1": None,
        }
    packaging = analyze_page_packaging(page_snapshot, query)
    zero_click_risk, zero_click_notes = zero_click_risk_for_query(query, intent_class)
    checks = {
        "serp_inspected": serp.get("status") == "ok" and bool(serp.get("results")),
        "current_snippet_inspected": snippet_snapshot.get("status") == "ok",
        "above_the_fold_inspected": packaging.get("status") == "ok",
        "zero_click_risk_accounted_for": True,
    }
    return {
        "status": "completed" if all(checks.values()) else "partial",
        "query": query,
        "target": target,
        "checks": checks,
        "serp": serp,
        "current_snippet": {
            "source": snippet_snapshot.get("source"),
            "source_path": snippet_snapshot.get("source_path"),
            "status": snippet_snapshot.get("status"),
            "title": snippet_snapshot.get("title"),
            "meta_description": snippet_snapshot.get("meta_description"),
            "h1": snippet_snapshot.get("h1"),
        },
        "above_the_fold": packaging,
        "zero_click_risk": {"level": zero_click_risk, "notes": zero_click_notes},
    }


def add_deep_dive_diagnostics(issues: list[dict[str, Any]], site_id: str, site_profile: dict[str, Any] | None = None, live: bool = False) -> list[dict[str, Any]]:
    enriched = []
    for issue in issues:
        updated = dict(issue)
        if issue.get("recommended_action_type") in {"snippet_content_packaging", "meta_tags", "page_improvement", "query_intent_mapping", "local_intent_ownership"}:
            updated["deep_dive"] = deep_dive_diagnostic(issue, site_id, site_profile, live=live)
        enriched.append(updated)
    return enriched


def context_values(value: Any) -> list[Any]:
    if value is None or value == "":
        return []
    if isinstance(value, (list, dict)) and not value:
        return []
    if isinstance(value, list):
        return [item for nested in value for item in context_values(nested)]
    if isinstance(value, dict):
        return [item for nested in value.values() for item in context_values(nested)]
    return [value]


def context_text(value: Any) -> str:
    return " ".join(str(item).lower() for item in context_values(value))


def page_role_entries(business_context: dict[str, Any] | None) -> list[tuple[str, str]]:
    page_roles = (business_context or {}).get("page_role_map") or {}
    entries: list[tuple[str, str]] = []
    if isinstance(page_roles, dict):
        for locator, role in page_roles.items():
            entries.append((str(locator), context_text(role)))
    elif isinstance(page_roles, list):
        for item in page_roles:
            if isinstance(item, dict):
                locator = item.get("url") or item.get("path") or item.get("page") or item.get("target")
                role = item.get("role") or item.get("page_role") or item.get("type") or item
                if locator:
                    entries.append((str(locator), context_text(role)))
            else:
                entries.append((str(item), str(item).lower()))
    return entries


def matching_page_role(reference_url: str | None, page_roles: Any) -> str:
    if not reference_url:
        return ""
    parsed = urlparse(reference_url)
    target_path = parsed.path.rstrip("/") or "/"
    target_url = reference_url.rstrip("/")
    pseudo_context = {"page_role_map": page_roles}
    for locator, role_text in page_role_entries(pseudo_context):
        locator_url = url_for_context_path(reference_url, locator).rstrip("/")
        locator_path = urlparse(locator_url).path.rstrip("/") or "/"
        if locator_url == target_url or locator_path == target_path:
            return role_text
    return ""


def business_context_local_label(business_context: dict[str, Any] | None) -> str:
    context = business_context or {}
    geography = str(context.get("primary_geography") or "").strip()
    if geography:
        return geography
    location_priorities = context.get("location_priorities")
    if isinstance(location_priorities, dict):
        priority_order = {"high": 0, "medium": 1, "low": 2}
        ranked_locations = sorted(
            location_priorities.items(),
            key=lambda item: priority_order.get(str((item[1] or {}).get("priority", "") if isinstance(item[1], dict) else "").lower(), 3),
        )
        if ranked_locations:
            return "/".join(str(location) for location, _details in ranked_locations[:3])
    locations = context.get("target_locations") or context.get("locations") or location_priorities or []
    values = context_values(locations)
    if values:
        return "/".join(str(value) for value in values[:3])
    return "local"

def url_for_context_path(reference_url: str | None, path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    parsed = urlparse(reference_url or "")
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc
    if not netloc:
        return path
    return urlunparse((scheme, netloc, path if path.startswith("/") else f"/{path}", "", "", ""))


def query_matches_any(query: str | None, terms: Any) -> bool:
    q = (query or "").lower()
    if not q:
        return False
    return any(str(term).lower() in q for term in context_values(terms) if term)


def context_page_candidates(business_context: dict[str, Any] | None, reference_url: str | None) -> dict[str, str | None]:
    local_research = None
    transactional = None
    support = None
    for locator, role_text in page_role_entries(business_context):
        url = url_for_context_path(reference_url, locator)
        if local_research is None and "local" in role_text and any(term in role_text for term in ["commercial", "research", "price", "cost"]):
            local_research = url
        if transactional is None and "transactional" in role_text:
            transactional = url
        if support is None and ("support" in role_text or "informational" in role_text):
            support = url
    return {"local_research": local_research, "transactional": transactional, "support": support}


def business_context_says_national_deprioritized(business_context: dict[str, Any] | None) -> bool:
    priority = (business_context or {}).get("target_customer_priority") or {}
    deprioritized = priority.get("deprioritized", []) if isinstance(priority, dict) else []
    text = context_text(deprioritized)
    return "national" in text or "outside service area" in text or "non-local" in text


def booking_intent_terms(hierarchy: Any) -> tuple[list[Any], list[Any]]:
    if isinstance(hierarchy, dict):
        return context_values(hierarchy.get("highest_priority", [])), context_values(hierarchy.get("supporting_only", []))
    ordered = context_values(hierarchy)
    if not ordered:
        return [], []
    high_priority = ordered[:1]
    supporting = ordered[1:]
    informational_markers = ("cost", "price", "how much", "average", "guide", "research", "compare")
    for term in ordered:
        if any(marker in str(term).lower() for marker in informational_markers) and term not in supporting:
            supporting.append(term)
    return high_priority, supporting

def apply_business_context_to_issue(issue: dict[str, Any], business_context: dict[str, Any] | None, site_id: str | None = None) -> dict[str, Any]:
    if not business_context:
        return issue
    query = issue.get("primary_query")
    hierarchy = business_context.get("booking_intent_hierarchy") or {}
    high_priority_terms, supporting_terms = booking_intent_terms(hierarchy)
    page_roles = business_context.get("page_role_map") or {}
    target = issue.get("target") or issue.get("canonical_target") or issue.get("raw_target")
    reference_url = target or (business_context or {}).get("target_url") or (f"https://www.{site_id}" if site_id else None)
    role_text = matching_page_role(target, page_roles)
    is_support_query = query_matches_any(query, supporting_terms)
    is_high_priority_query = query_matches_any(query, high_priority_terms)
    is_support_page = "support" in role_text or "informational" in role_text
    national_deprioritized = business_context_says_national_deprioritized(business_context)
    candidates = context_page_candidates(business_context, reference_url)
    context_support_page = candidates.get("support")

    if issue.get("recommended_action_type") in {"snippet_content_packaging", "meta_tags", "query_intent_mapping"} and is_support_query and not is_high_priority_query and (is_support_page or context_support_page or national_deprioritized):
        source_support_page = target or context_support_page or reference_url
        preferred_owner = candidates.get("local_research") or candidates.get("transactional") or source_support_page
        updated = dict(issue)
        updated["recommended_action_type"] = "local_intent_ownership"
        locality = business_context_local_label(business_context)
        updated["title"] = f"Resolve {locality} intent ownership for '{query}'"
        updated["target"] = preferred_owner
        updated["canonical_target"] = preferred_owner
        updated["source_target"] = source_support_page
        updated["consolidation_targets"] = {
            "source_support_page": source_support_page,
            "preferred_local_owner": preferred_owner,
            "conversion_target": candidates.get("transactional"),
        }
        updated["expected_click_delta"] = None
        updated["expected_impact"] = f"Clarify which {locality} page should own this intent; optimize for qualified local outcomes, not raw support-page CTR."
        updated.setdefault("operator_judgment_notes", [])
        ownership_notes = [
            "supporting intent should route qualified demand to the best local owner",
            "decide whether to consolidate, canonicalize, redirect, or internally link from the support page to the local owner",
        ]
        if national_deprioritized:
            ownership_notes = [
                "business context deprioritizes national informational clicks",
                "do not optimize the support page for broad national CTR unless it routes qualified local intent",
                *ownership_notes,
            ]
        updated["operator_judgment_notes"] = [*updated["operator_judgment_notes"], *ownership_notes]
        score_components = dict(updated.get("score_components", {}))
        score_components["business_context_goal_score"] = 1.0
        if national_deprioritized:
            score_components["national_click_discount"] = 0.25
        updated["score_components"] = score_components
        updated["business_context_adjustment"] = {
            "from_action_type": issue.get("recommended_action_type"),
            "reason": f"supporting query is not the direct business goal; prioritize {locality} ownership",
            "preferred_local_owner": preferred_owner,
            "source_support_page": source_support_page,
        }
        raw_priority = float(issue.get("priority_score", 0))
        if national_deprioritized:
            updated["priority_score"] = round(raw_priority * score_components["national_click_discount"], 3)
        return updated
    return issue


def apply_business_context(candidates: list[dict[str, Any]], business_context: dict[str, Any] | None, site_id: str | None = None) -> list[dict[str, Any]]:
    return [apply_business_context_to_issue(candidate, business_context, site_id=site_id) for candidate in candidates]


BUSINESS_IMPACT_CONTEXT_FIELDS = {
    "service_value_weights": "Relative revenue/margin value by service or product line",
    "target_customer_priority": "Priority customer segments (local buyers, high-margin segments, urgent-need customers, recurring customers, etc.)",
    "location_priorities": "Location-level priority/capacity/margin context",
    "conversion_events": "Organic conversion events or booking funnel signals",
    "booking_intent_hierarchy": "Which query intents are most likely to become bookings",
    "local_proof_points": "Local differentiators to use in snippets/content",
    "serp_competitor_positioning": "Competitor/SERP positioning for priority queries",
    "page_role_map": "Transactional vs informational role for important pages",
}


def business_context_gaps(business_context: dict[str, Any] | None) -> list[dict[str, str]]:
    context = business_context or {}
    gaps = []
    for field, reason in BUSINESS_IMPACT_CONTEXT_FIELDS.items():
        value = context.get(field)
        if value in (None, "", [], {}):
            gaps.append({"field": field, "why_it_matters": reason})
    return gaps


def business_context_questions(gaps: list[dict[str, str]]) -> list[str]:
    wanted = {gap["field"] for gap in gaps}
    questions = []
    if "service_value_weights" in wanted:
        questions.append("Rank services or product lines by business value/margin.")
    if "target_customer_priority" in wanted:
        questions.append("Which customer segments matter most: local buyers, high-margin services, recurring customers, urgent-need customers, enterprise accounts, etc.?")
    if "location_priorities" in wanted:
        questions.append("Which markets or service areas should SEO prioritize right now, and are any capacity-constrained?")
    if "conversion_events" in wanted:
        questions.append("What organic conversion signals should count: form starts, completed purchases/bookings, calls, quote requests, CRM events, GA4 events?")
    if "booking_intent_hierarchy" in wanted:
        questions.append("Give a rough intent ranking: e.g. high-intent local/service query > category query > cost/research query > broad informational query.")
    if "local_proof_points" in wanted:
        questions.append("What proof points should snippets emphasize: response time, certifications, warranty, reviews, pricing transparency, local coverage, multi-location coverage?")
    if "serp_competitor_positioning" in wanted:
        questions.append("For priority queries, who must we beat or differentiate from: direct competitors, marketplaces/directories, map-pack results, review sites, or national brands?")
    if "page_role_map" in wanted:
        questions.append("Which pages are transactional landing pages vs informational support pages?")
    return questions


def context_quality_check(business_context: dict[str, Any] | None) -> dict[str, Any]:
    gaps = business_context_gaps(business_context)
    missing = len(gaps)
    total = len(BUSINESS_IMPACT_CONTEXT_FIELDS)
    score = round((total - missing) / total, 3)
    status = "pass" if score >= 0.75 else "warning"
    return {
        "score": score,
        "status": status,
        "missing_fields": gaps,
        "questions": business_context_questions(gaps),
    }


def build_business_context_request(site_id: str, context_check: dict[str, Any]) -> dict[str, Any] | None:
    if context_check["score"] >= 0.75:
        return None
    return {
        "item_id": f"context_request_{site_id}_business_impact",
        "type": "business_context_request",
        "status": "pending_input",
        "priority": "high",
        "notes": "Complete business-impact context before approving SEO content, snippet, metadata, redirect, or internal-link actions.",
        "business_context_score": context_check["score"],
        "business_context_gaps": context_check["missing_fields"],
        "business_context_questions": context_check["questions"],
        "output_path": f"~/.toprank/business-context/{site_id}.json",
        "blocks_auto_approval": True,
    }


def build_payload(
    site_id: str,
    analysis: dict[str, Any],
    learned: dict[str, Any],
    goal: dict[str, Any] | None,
    business_context: dict[str, Any] | None = None,
    site_profile: dict[str, Any] | None = None,
    live_diagnostics: bool = False,
) -> dict[str, Any]:
    metrics = metric_snapshot_from_analysis(analysis)
    primary_metric = None
    if goal and goal.get("primary_metric"):
        primary_metric = goal["primary_metric"]
    if not primary_metric:
        primary_metric = DEFAULT_PRIMARY_METRIC if DEFAULT_PRIMARY_METRIC in metrics else next(iter(metrics.keys()), DEFAULT_PRIMARY_METRIC)

    context_check = context_quality_check(business_context)
    candidates = dedupe_candidates(apply_business_context(derive_candidate_issues(analysis), business_context, site_id=site_id))
    ranked = apply_prioritization(candidates, learned, primary_metric)
    top_issues = ranked[:3] if ranked else [
        make_issue(
            "No major issue surfaced from the automated weekly review.",
            "info",
            0.5,
            ["Use the canonical seo-analysis skill for deeper manual diagnosis if needed."],
            "manual_review",
            base_priority=0.3,
        )
    ]
    top_issues = [
        {
            **issue,
            "priority_score": issue.get("priority_score", round(issue.get("base_priority", 0.3), 3)),
            "learned_multiplier": issue.get("learned_multiplier", 1.0),
            "best_practice_alignment": best_practice_alignment_for_issue(issue),
        }
        for issue in top_issues
    ]
    top_issues = add_deep_dive_diagnostics(top_issues, site_id, site_profile, live=live_diagnostics)

    summary = analysis.get("summary") or {}
    non_brand_clicks = metrics.get(primary_metric)
    action_entries = []
    queue_items = []
    context_request = build_business_context_request(site_id, context_check)
    if context_request:
        queue_items.append(context_request)
    for idx, issue in enumerate(top_issues, start=1):
        action_id = f"weekly_action_{idx:02d}"
        action_type = issue["recommended_action_type"]
        expected_delta = issue.get("expected_click_delta")
        expected_impact = issue.get("expected_impact") or f"Address {action_type.replace('_', ' ')} opportunity surfaced in the weekly review."
        if isinstance(expected_delta, (int, float)) and expected_delta > 0:
            expected_impact = f"Estimated upside: ~{expected_delta:g} incremental clicks if the opportunity is fixed."
        elif isinstance(expected_delta, (int, float)) and expected_delta < 0:
            expected_impact = f"Regression signal: ~{abs(expected_delta):g} lost clicks vs prior period; investigate before changing content."
        action_entries.append(
            {
                "action_id": action_id,
                "title": issue["title"],
                "type": action_type,
                "priority_score": issue["priority_score"],
                "expected_impact": expected_impact,
                "requires_approval": action_type not in {"manual_review"},
                "reversibility": "high",
                "owner": "operator",
                "target": issue.get("target"),
                "raw_target": issue.get("raw_target"),
                "canonical_target": issue.get("canonical_target"),
                "score_components": issue.get("score_components", {}),
                "operator_judgment_notes": issue.get("operator_judgment_notes", []),
                "deep_dive": issue.get("deep_dive"),
                "business_context_adjustment": issue.get("business_context_adjustment"),
                "best_practice_alignment": issue.get("best_practice_alignment"),
                "consolidation_targets": issue.get("consolidation_targets"),
                "source_target": issue.get("source_target"),
                "needs_business_context": context_check["score"] < 0.75,
                "learned_multiplier": issue.get("learned_multiplier", 1.0),
            }
        )
        if idx == 1 and action_type != "manual_review":
            queue_items.append(
                {
                    "item_id": f"proposal_{site_id}_{action_type}_{analysis['period']['days']}d",
                    "type": "action_proposal",
                    "status": "pending_approval",
                    "notes": f"Approve, reject, or revise the weekly action: {issue['title']}",
                    "action_id": action_id,
                    "action_type": action_type,
                    "target": issue.get("target"),
                    "raw_target": issue.get("raw_target"),
                    "canonical_target": issue.get("canonical_target"),
                    "primary_metric": primary_metric,
                    "primary_direction": "higher_better" if "position" not in primary_metric else "lower_better",
                    "success_threshold_pct": 0.1,
                    "baseline_metrics": metrics,
                    "guardrail_metrics": [],
                    "follow_up_after_approval_days": 14,
                    "approval_required": True,
                    "score_components": issue.get("score_components", {}),
                    "operator_judgment_notes": issue.get("operator_judgment_notes", []),
                    "deep_dive": issue.get("deep_dive"),
                    "business_context_adjustment": issue.get("business_context_adjustment"),
                    "best_practice_alignment": issue.get("best_practice_alignment"),
                    "consolidation_targets": issue.get("consolidation_targets"),
                    "source_target": issue.get("source_target"),
                    "business_context_score": context_check["score"],
                    "business_context_gaps": context_check["missing_fields"],
                    "business_context_questions": context_check["questions"],
                    "approval_preconditions": ["complete_business_context"] if context_check["score"] < 0.75 else [],
                }
            )

    return {
        "trigger": {
            "type": "weekly_review",
            "notes": f"Automated weekly review for {site_id}.",
        },
        "state_snapshot": {
            "site_id": site_id,
            "summary": f"{summary.get('clicks', 0)} clicks, {summary.get('impressions', 0)} impressions, CTR {summary.get('ctr', 0)}%, position {summary.get('position', 0)}.",
            "open_issues": [
                {
                    "title": issue["title"],
                    "severity": issue["severity"],
                    "confidence": issue["confidence"],
                }
                for issue in top_issues
            ],
            "recent_actions": [],
            "metrics": metrics,
        },
        "audit": {
            "site_id": site_id,
            "summary": f"Automated weekly review surfaced {len(top_issues)} prioritized issue(s).",
            "issues": top_issues,
            "metrics": metrics,
        },
        "action_plan": {
            "site_id": site_id,
            "goal_id": goal.get("goal_id") if goal else None,
            "actions": action_entries,
        },
        "verification": {
            "site_id": site_id,
            "checks": [
                {"name": "gsc analysis available", "status": "pass", "notes": "Weekly review generated from Search Console data."},
                {"name": "action plan generated", "status": "pass", "notes": f"Primary metric for follow-up scoring: {primary_metric}."},
                {
                    "name": "recommendation quality gate",
                    "status": "pass" if top_issues[0].get("priority_score", 0) >= 0.35 else "warning",
                    "notes": "; ".join(top_issues[0].get("operator_judgment_notes", [])) or "Top action has explicit score components for operator review.",
                },
                {
                    "name": "deep dive diagnostics",
                    "status": "pass" if top_issues[0].get("deep_dive", {}).get("status") == "completed" else "warning",
                    "notes": "Top recommendation includes SERP, snippet, above-the-fold, and zero-click diagnostics before edit approval." if top_issues[0].get("deep_dive") else "No deep dive was needed for the top recommendation.",
                    "deep_dive_status": top_issues[0].get("deep_dive", {}).get("status"),
                    "checks": top_issues[0].get("deep_dive", {}).get("checks", {}),
                },
                {
                    "name": "best practice alignment",
                    "status": "pass" if top_issues[0].get("best_practice_alignment", {}).get("primary_area") not in {None, "", "unmapped"} else "warning",
                    "notes": top_issues[0].get("best_practice_alignment", {}).get("primary_area_label", "Top recommendation is not mapped to a MECE SEO best-practice lane."),
                    "reference": SEO_BEST_PRACTICE_REFERENCE,
                    "alignment": top_issues[0].get("best_practice_alignment", {}),
                },
                {
                    "name": "business impact context",
                    "status": context_check["status"],
                    "notes": f"Business-impact context completeness: {context_check['score']:.0%}. Missing: {', '.join(gap['field'] for gap in context_check['missing_fields']) or 'none'}.",
                    "questions": context_check["questions"],
                },
            ],
            "follow_up_due": None,
        },
        "queue_items": queue_items,
    }


def run_analysis(site_property: str, days: int, brand_terms: str | None) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile(prefix="toprank_weekly_review_", suffix=".json", delete=False) as tmp:
        output_path = Path(tmp.name)
    cmd = [sys.executable, str(ANALYZE_GSC), "--site", site_property, "--days", str(days), "--output", str(output_path)]
    if brand_terms:
        cmd.extend(["--brand-terms", brand_terms])
    completed = subprocess.run(cmd, check=True, text=True, capture_output=True)
    if completed.stdout:
        print(completed.stdout, file=sys.stderr, end="")
    if completed.stderr:
        print(completed.stderr, file=sys.stderr, end="")
    return json.loads(output_path.read_text())


def build_user_message(site_id: str, result: dict[str, Any], payload: dict[str, Any], context_request: dict[str, Any] | None) -> str:
    summary = payload.get("state_snapshot", {}).get("summary") or "Weekly review complete."
    actions = (payload.get("action_plan") or {}).get("actions") or []
    top_action = actions[0] if actions else {}
    queue_items = result.get("queue_items_written") or []
    proposal_path = next((path for path in queue_items if "/proposal_" in path), None)
    lines = [
        f"Weekly SEO review complete for `{site_id}`.",
        "",
        f"Run: `{result.get('run_dir')}`",
        f"Summary: {summary}",
    ]
    if top_action:
        lines.extend([
            "",
            "Top proposed next action:",
            f"- Type: `{top_action.get('type')}`",
            f"- Target: `{top_action.get('target')}`",
            f"- Why: {top_action.get('expected_impact')}",
            f"- Best-practice lane: `{(top_action.get('best_practice_alignment') or {}).get('primary_area_label', 'not mapped')}`",
            f"- Requires approval: {'yes' if top_action.get('requires_approval') else 'no'}",
        ])
        deep_dive = top_action.get("deep_dive") or {}
        checks = deep_dive.get("checks") or {}
        if deep_dive:
            lines.append(
                f"- Deep dive: {deep_dive.get('status')} "
                f"(SERP {'yes' if checks.get('serp_inspected') else 'no'}, "
                f"snippet {'yes' if checks.get('current_snippet_inspected') else 'no'}, "
                f"above-fold {'yes' if checks.get('above_the_fold_inspected') else 'no'})"
            )
    if proposal_path:
        lines.extend(["", f"Proposal file: `{proposal_path}`"])
    if context_request:
        questions = context_request.get("business_context_questions") or []
        score = context_request.get("business_context_score")
        percent = round(float(score or 0) * 100)
        lines.extend([
            "",
            f"Before I can recommend/approve edits, business context is only {percent}% complete. Please answer these, roughly is fine:",
        ])
        lines.extend(f"{idx}. {question}" for idx, question in enumerate(questions, start=1))
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site")
    parser.add_argument("--analysis-file")
    parser.add_argument("--gsc-property")
    parser.add_argument("--brand-terms")
    parser.add_argument("--days", type=int, default=28)
    args = parser.parse_args(argv[1:])

    root = workspace_root()
    site_id = normalize_site_id(args.site)
    site_root = root / "sites" / site_id
    profile = load_json(site_root / "site-profile.json", {})
    goals = load_json(site_root / "goals.json", {"active": [], "archived": []})
    learned = load_json(site_root / "learned-patterns.json", {"site_id": site_id, "observations": [], "priors": {}})
    active_goal = goals.get("active", [None])[0] if goals.get("active") else None

    if args.analysis_file:
        analysis = json.loads(Path(args.analysis_file).read_text())
    else:
        site_property = args.gsc_property or profile.get("gsc_property") or profile.get("canonical_url")
        if not site_property:
            raise SystemExit("No GSC property or canonical_url found for this site. Provide --gsc-property or update site-profile.json.")
        brand_terms = args.brand_terms if args.brand_terms is not None else ",".join(profile.get("brand_terms", []))
        analysis = run_analysis(site_property, args.days, brand_terms)

    analysis["_brand_terms"] = profile.get("brand_terms", [])
    business_context_path = Path.home() / ".toprank" / "business-context" / f"{site_id}.json"
    business_context = load_json(business_context_path, {})
    payload = build_payload(site_id, analysis, learned, active_goal, business_context, profile, live_diagnostics=True)
    result = persist_payload(args.site, payload, root=root)
    metric_item = next((item for item in payload.get("queue_items", []) if item.get("primary_metric")), None)
    result["primary_metric"] = metric_item["primary_metric"] if metric_item else None
    context_request = next((item for item in payload.get("queue_items", []) if item.get("type") == "business_context_request"), None)
    if context_request:
        result["business_context_request"] = {
            "status": context_request["status"],
            "business_context_score": context_request["business_context_score"],
            "output_path": context_request["output_path"],
            "questions": context_request["business_context_questions"],
        }
    result["user_message"] = build_user_message(site_id, result, payload, context_request)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
