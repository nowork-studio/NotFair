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
    "demand_seed_content": "demand_intent_targeting",
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


def total_declining_click_loss(analysis: dict[str, Any]) -> float:
    comparison = analysis.get("comparison") or {}
    page_loss = 0.0
    query_loss = 0.0
    for page in comparison.get("declining_pages") or []:
        page_loss += max(float(page.get("clicks_prev") or 0) - float(page.get("clicks_now") or 0), 0.0)
    for query in comparison.get("declining_queries") or []:
        query_loss += max(float(query.get("clicks_prev") or 0) - float(query.get("clicks_now") or 0), 0.0)
    # Page and query declines are different slices of the same GSC clicks. Summing
    # them double-counts the same traffic loss and can falsely trigger recovery mode.
    return round(max(page_loss, query_loss), 1)


def infer_site_stage(analysis: dict[str, Any], metrics: dict[str, float], business_context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Classify the SEO operating mode so the weekly review picks the right playbook.

    Seed-stage sites should not be told "manual review only" just because GSC is
    sparse. Harvest/recover/defend sites have enough signal for GSC-led actions.
    """
    configured = (business_context or {}).get("site_stage") or (business_context or {}).get("seo_stage")
    valid = {"seed", "harvest", "defend", "recover"}
    if isinstance(configured, str) and configured.lower() in valid:
        return {
            "stage": configured.lower(),
            "source": "business_context",
            "reason": f"Business context explicitly sets SEO stage to {configured.lower()}.",
        }

    period_days = int((analysis.get("period") or {}).get("days") or 28)
    suffix = f"_{period_days}d"
    organic_clicks = float(metrics.get(f"organic_clicks{suffix}", 0.0))
    organic_impressions = float(metrics.get(f"organic_impressions{suffix}", 0.0))
    non_brand_clicks = float(metrics.get(f"non_brand_clicks{suffix}", 0.0))
    non_brand_impressions = float(metrics.get(f"non_brand_impressions{suffix}", 0.0))
    branded_clicks = float(metrics.get(f"branded_clicks{suffix}", 0.0))
    lost_clicks = total_declining_click_loss(analysis)

    signals = {
        "organic_clicks": organic_clicks,
        "organic_impressions": organic_impressions,
        "non_brand_clicks": non_brand_clicks,
        "non_brand_impressions": non_brand_impressions,
        "branded_clicks": branded_clicks,
        "declining_click_loss": lost_clicks,
        "period_days": period_days,
    }
    if lost_clicks >= 25:
        return {"stage": "recover", "source": "heuristic", "reason": f"Meaningful recent organic loss detected (~{lost_clicks:g} lost clicks).", "signals": signals}
    if organic_impressions < 1000 or organic_clicks < 50:
        return {"stage": "seed", "source": "heuristic", "reason": "GSC volume is too sparse for harvest-mode optimization; create demand-capture assets first.", "signals": signals}
    if non_brand_impressions >= 1000 or organic_impressions >= 5000:
        return {"stage": "harvest", "source": "heuristic", "reason": "Enough impression volume exists to harvest CTR/ranking/internal-link opportunities.", "signals": signals}
    return {"stage": "defend", "source": "heuristic", "reason": "Moderate organic presence; protect brand/service coverage while looking for qualified expansion bets.", "signals": signals}


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

    if action_type == "content_refresh":
        notes.append("Content has lost ranking position; refresh with current data, intent alignment, and competitive comparison before republishing.")
    elif action_type in {"meta_tags", "snippet_content_packaging"}:
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


GENERIC_BRAND_STOPWORDS = {"the", "a", "an", "inc", "llc", "ltd", "co", "company", "official", "website"}
GENERIC_BRAND_SERVICE_TERMS = {"boarding", "board", "daycare", "grooming", "groom", "training", "sitting", "sitter", "pet", "dog", "cat"}


def is_generic_branded_query(query: str | None, brand_terms: list[str] | None) -> bool:
    """True for pure navigational brand searches like "paws vip".

    Branded service searches ("paws vip dog boarding", "example grooming seattle")
    can still be business-relevant for service pages, but pure brand navigational
    searches usually belong to the homepage / GBP / directory SERP, so low CTR on
    a secondary service page is not an actionable snippet opportunity.
    """
    if not is_branded_query(query, brand_terms):
        return False
    normalized = re.sub(r"[^a-z0-9]+", " ", (query or "").lower()).strip()
    for term in sorted((brand_terms or []), key=len, reverse=True):
        term_norm = re.sub(r"[^a-z0-9]+", " ", term.lower()).strip()
        if term_norm:
            normalized = re.sub(rf"\b{re.escape(term_norm)}\b", " ", normalized)
    residual = " ".join(token for token in normalized.split() if token not in GENERIC_BRAND_STOPWORDS)
    if not residual:
        return True
    action_terms = LOCAL_INTENT_TERMS | COMMERCIAL_SERVICE_TERMS | INFORMATIONAL_SERP_TERMS | GENERIC_BRAND_SERVICE_TERMS
    return not any(term in residual for term in action_terms)


SERVICE_PAGE_PATTERNS = re.compile(r"/(?:locations?|services?|pricing|booking|book|reserve|contact|about|faq|gallery|rates?|review|team|careers?|apply|shop|products?|dogs?-(?:boarding?|daycare|sitting?|grooming|training)|pet-(?:boarding?|daycare|sitting?|grooming|training))")


def is_service_page(url: str | None) -> bool:
    """True if the URL looks like a service/business page, not a blog or content article."""
    if not url:
        return False
    path = urlparse(url).path.rstrip("/") or "/"
    if re.search(r"/(?:blogs?|blog|news|articles?|posts?|journal|category|tag/|author/)", path):
        return False
    if bool(SERVICE_PAGE_PATTERNS.search(path)):
        return True
    # Short paths with no subdirectory are likely service pages (e.g. /dog-boarding, /)
    return path.count("/") <= 2


def goal_alignment_for_query(query: str | None, brand_terms: list[str] | None) -> tuple[float, list[str]]:
    if is_branded_query(query, brand_terms):
        return 0.35, ["branded/navigational query; lower priority for non-brand growth"]
    return 1.0, []


def classify_regression_pattern(top_query: dict[str, Any]) -> tuple[str, str, list[str]]:
    """Classify a losing query into an action type and best-practice area.

    Examines which metric moved first to determine the root cause:

    - Position drop + impression drop + CTR ~stable → ranking loss → content_refresh
    - CTR drop + position stable + impressions ~stable → SERP displacement → snippet_content_packaging
    - Impression drop + position stable + CTR stable → demand fade → query_intent_mapping
    - Mixed/ambiguous → page_improvement (defer to operator)
    """
    pos_now = top_query.get("position_now")
    pos_prev = top_query.get("position_prev")
    pos_delta = None
    if pos_now is not None and pos_prev is not None:
        pos_delta = pos_now - pos_prev  # positive = rank dropped (higher number = worse)

    ctr_now = top_query.get("ctr_now") or 0
    ctr_prev = top_query.get("ctr_prev") or 0
    ctr_delta = ctr_now - ctr_prev

    impr_now = top_query.get("impressions_now", 0)
    impr_prev = top_query.get("impressions_prev", 0)
    impr_delta = impr_now - impr_prev
    impr_decline_pct = (impr_delta / max(impr_prev, 1)) * 100 if impr_prev > 0 else 0

    notes = []

    # Rank position drop is the strongest signal
    if pos_delta is not None and pos_delta >= 1.5:
        notes.append(f"Position dropped {pos_delta:+.1f} positions; likely ranking loss or competitive displacement")
        return "content_refresh", "content_usefulness_trust", notes

    if pos_delta is not None and pos_delta >= 0.5:
        notes.append(f"Position drifted {pos_delta:+.1f} positions; mild ranking regression")
        return "content_refresh", "content_usefulness_trust", notes

    # CTR drop with stable position → SERP displacement
    if ctr_delta < -2.0 and impr_decline_pct > -30:
        notes.append(f"CTR dropped {ctr_delta:+.1f}% while position held; likely SERP feature displacement")
        return "snippet_content_packaging", "on_page_relevance_serp_packaging", notes

    if ctr_delta < -1.0 and pos_delta is not None and abs(pos_delta) < 0.5:
        notes.append(f"Mild CTR decline {ctr_delta:+.1f}% with stable position; possible SERP layout change")
        return "snippet_content_packaging", "on_page_relevance_serp_packaging", notes

    # Impression drop without position or CTR change → demand fade / intent shift
    if impr_decline_pct < -40 and ctr_delta > -1.0 and (pos_delta is None or abs(pos_delta) < 0.5):
        notes.append(f"Impressions declined {impr_decline_pct:.0f}% without ranking or CTR change; possible intent shift or demand fade")
        return "query_intent_mapping", "demand_intent_targeting", notes

    # Mixed signals — keep as page_improvement
    notes.append("Mixed or ambiguous regression signals; operator investigation required")
    return "page_improvement", "content_usefulness_trust", notes


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

    # Decompose with top-losing-queries from query-page GSC data
    top_losing_queries = page.get("top_losing_queries", [])
    if top_losing_queries:
        top_losing_queries = [q for q in top_losing_queries if q.get("absolute_click_loss", 0) > 0]

    primary_query: str | None = None
    diagnostic_query: str | None = None
    query_decomposition: dict[str, Any] | None = None
    approval_blockers: list[str] = []
    if top_losing_queries:
        top = top_losing_queries[0]
        total_lost = top.get("absolute_click_loss", 0)
        share_of_loss = total_lost / max(lost_clicks, 1)
        top_name = top.get("query", "")
        diagnostic_query = top_name or None
        explained_loss = sum(float(q.get("absolute_click_loss") or 0) for q in top_losing_queries[:5])
        explained_loss_share = explained_loss / max(lost_clicks, 1)
        query_decomposition = {
            "top_query_loss_share": round(share_of_loss, 3),
            "top_5_explained_loss_share": round(explained_loss_share, 3),
            "top_5_explained_lost_clicks": round(explained_loss, 1),
            "is_distributed": share_of_loss < 0.3,
        }

        if share_of_loss >= 0.3:
            # Dominant losing query — reclassify action type based on regression pattern
            primary_query = top_name
            classified_type, classified_area, classify_notes = classify_regression_pattern(top)
            action_type = classified_type
            notes.extend(classify_notes)
            notes.append(f"Top query '{primary_query}' drives {share_of_loss:.0%} of lost clicks ({total_lost:g} of {lost_clicks:g})")
        else:
            # Distributed across queries — keep page_improvement but attach context
            notes.append(f"Top query '{top_name}' drives {share_of_loss:.0%} of lost clicks; decline is distributed")
            notes.append("Distributed decline; diagnose SERP changes and content freshness across multiple queries")
            actionability_score = 0.35 if explained_loss_share >= 0.5 else 0.2
            notes.append("No dominant losing query; this is a diagnostic signal, not an approval-ready edit")
            approval_blockers.append("distributed regression has no dominant primary query")

    if context["has_tracking_params"]:
        action_type = "canonical_or_tracking_investigation"
        actionability_score = 0.45
        notes.append("treat as attribution/canonical investigation before editing page content")
        title_target = context["canonical_target"] or raw_target
    if lost_clicks < 25:
        notes.append("low absolute click loss; percentage drop may overstate impact")

    url_quality = float(context["url_quality_score"])
    score = impact_score * confidence * actionability_score * url_quality

    extra_kwargs: dict[str, Any] = {
        "target": raw_target,
        "base_priority": impact_score,
        "expected_click_delta": round(-lost_clicks, 1),
        "priority_score": round(score, 3),
        "score_components": {
            "expected_impact": round(impact_score, 3),
            "confidence_score": confidence,
            "goal_alignment_score": 1.0,
            "actionability_score": actionability_score,
            "url_quality_score": url_quality,
        },
        "operator_judgment_notes": notes,
        "top_losing_queries": top_losing_queries,
    }
    if primary_query:
        extra_kwargs["primary_query"] = primary_query
    if diagnostic_query and diagnostic_query != primary_query:
        extra_kwargs["diagnostic_query"] = diagnostic_query
    if query_decomposition:
        extra_kwargs["query_decomposition"] = query_decomposition
    if approval_blockers:
        extra_kwargs["approval_blockers"] = approval_blockers

    return make_issue(
        f"Traffic dropped on {title_target}",
        severity_from_score(score),
        confidence,
        [
            f"Clicks changed {change_pct}% vs prior period.",
            f"Current clicks: {clicks_now:g} | previous clicks: {clicks_prev:g} | lost clicks: {lost_clicks:g}",
        ],
        action_type,
        **extra_kwargs,
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
    # For service pages, goal_alignment considers the page's role, not just the top
    # underperforming query. Branded service searches ("example boarding") can be
    # valuable; pure brand navigational searches ("example") should not become
    # secondary-page CTR edit proposals.
    generic_branded_service_gap = is_service_page(raw_target) and is_generic_branded_query(query, brand_terms)
    approval_blockers: list[str] = []
    if generic_branded_service_gap:
        goal_alignment_score = 0.35
        actionability_score = min(actionability_score, 0.35)
        goal_notes = [
            "generic branded query; low CTR on a secondary service page is usually navigational SERP behavior, not a snippet/content fix",
        ]
        approval_blockers.append("generic branded query needs SERP ownership diagnosis, not a page edit")
    elif is_service_page(raw_target) and is_branded_query(query, brand_terms):
        goal_alignment_score = 1.0
        goal_notes = ["service page; goal alignment based on page role, not gap query"]
    else:
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
            **({"generic_brand_discount": 0.35} if generic_branded_service_gap else {}),
        },
        operator_judgment_notes=[*action_notes, *intent_notes, *goal_notes],
        approval_blockers=approval_blockers,
    )


def approval_readiness_for_issue(issue: dict[str, Any]) -> dict[str, Any]:
    blockers = [str(blocker) for blocker in issue.get("approval_blockers", []) if blocker]
    if issue.get("recommended_action_type") == "manual_review":
        blockers.append("manual review only")
    actionability = (issue.get("score_components") or {}).get("actionability_score")
    if isinstance(actionability, (int, float)) and actionability < 0.5:
        blockers.append("actionability below approval threshold")
    if issue.get("recommended_action_type") == "page_improvement" and issue.get("diagnostic_query") and not issue.get("primary_query"):
        blocker = "diagnostic query is only a fallback; no primary query owns the loss"
        if blocker not in blockers:
            blockers.append(blocker)
    deduped = list(dict.fromkeys(blockers))
    return {"approval_ready": not deduped, "approval_blockers": deduped}


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

    # Build lookup for query-page decompositions (from GSC comparison analysis)
    page_query_lookup: dict[str, list[dict[str, Any]]] = {}
    for decomp in (comparison.get("page_query_decompositions") or []):
        page_url = decomp.get("page", "")
        losing_queries = decomp.get("top_losing_queries", [])
        if page_url and losing_queries:
            page_query_lookup[page_url] = losing_queries

    for page in declining_pages[:8]:
        page_url = page.get("page", "")
        top_losing = page_query_lookup.get(page_url, [])
        page["top_losing_queries"] = top_losing
        issues.extend([decline_issue(page)])
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
    query = issue.get("primary_query") or issue.get("diagnostic_query")
    query_source = "primary_query" if issue.get("primary_query") else ("diagnostic_query" if issue.get("diagnostic_query") else None)
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
        "query_source": query_source,
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
        if issue.get("recommended_action_type") in {"snippet_content_packaging", "meta_tags", "page_improvement", "query_intent_mapping", "local_intent_ownership", "content_refresh"}:
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


def weighted_terms_match_score(text: str, weighted_terms: Any, default: float = 1.0) -> tuple[float, str | None]:
    """Return the strongest business value weight whose term appears in text.

    Supports either {"term": 1.4} or [{"term": "x", "weight": 1.4}].
    """
    haystack = (text or "").lower()
    best = (default, None)
    if isinstance(weighted_terms, dict):
        iterable = weighted_terms.items()
    elif isinstance(weighted_terms, list):
        iterable = []
        for item in weighted_terms:
            if isinstance(item, dict):
                term = item.get("term") or item.get("service") or item.get("product") or item.get("query")
                weight = item.get("weight") or item.get("value") or item.get("score")
                iterable.append((term, weight))
            else:
                iterable.append((item, default))
    else:
        iterable = []
    for term, raw_weight in iterable:
        if not term:
            continue
        try:
            weight = float(raw_weight)
        except (TypeError, ValueError):
            weight = default
        if str(term).lower() in haystack and weight > best[0]:
            best = (weight, str(term))
    return best


def conversion_event_weight_for_issue(issue: dict[str, Any], business_context: dict[str, Any] | None) -> tuple[float, str | None]:
    events = (business_context or {}).get("conversion_events") or []
    target = str(issue.get("target") or issue.get("canonical_target") or issue.get("raw_target") or "").lower()
    query = str(issue.get("primary_query") or issue.get("diagnostic_query") or "").lower()
    title = str(issue.get("title") or "").lower()
    text = " ".join([target, query, title])
    best_weight = 1.0
    best_event = None
    iterable = events.values() if isinstance(events, dict) else events
    for event in iterable:
        if isinstance(event, str):
            event = {"name": event}
        if not isinstance(event, dict):
            continue
        name = str(event.get("name") or event.get("event") or event.get("id") or "conversion")
        paths = context_values(event.get("paths") or event.get("page_paths") or event.get("landing_pages") or event.get("targets") or [])
        terms = context_values(event.get("queries") or event.get("intent_terms") or event.get("terms") or [])
        target_path = urlparse(target).path.rstrip("/") or "/"
        path_match = False
        for path in paths:
            if not path:
                continue
            raw_path = str(path).lower().rstrip("/") or "/"
            parsed_path = urlparse(raw_path).path.rstrip("/") or raw_path
            if target_path == parsed_path or target.endswith(raw_path):
                path_match = True
                break
        match = path_match or any(str(term).lower() in text for term in terms if term)
        if not match and not paths and not terms:
            match = any(token in text for token in ["book", "quote", "contact", "signup", "connect", "demo"])
        if not match:
            continue
        try:
            weight = float(event.get("weight") or event.get("value_weight") or event.get("business_value") or 1.15)
        except (TypeError, ValueError):
            weight = 1.15
        if weight > best_weight:
            best_weight = weight
            best_event = name
    return best_weight, best_event


def page_role_conversion_weight(issue: dict[str, Any], business_context: dict[str, Any] | None) -> tuple[float, str]:
    target = issue.get("target") or issue.get("canonical_target") or issue.get("raw_target")
    role = matching_page_role(target, (business_context or {}).get("page_role_map") or {})
    target_path = urlparse(target or "").path.rstrip("/") or "/"
    if not role and target_path != "/" and is_service_page(target):
        role = "service/transactional page inferred from URL"
    role_text = role.lower()
    if any(token in role_text for token in ["transactional", "booking", "signup", "quote", "lead", "conversion"]):
        return 1.35, role or "transactional page"
    if any(token in role_text for token in ["local", "commercial", "service", "pricing"]):
        return 1.15, role or "commercial page"
    if any(token in role_text for token in ["support", "informational", "blog", "guide", "docs"]):
        return 0.7, role or "supporting informational page"
    return 1.0, role or "unknown"


def stage_conversion_multiplier(site_stage: dict[str, Any], issue: dict[str, Any]) -> tuple[float, list[str]]:
    stage = (site_stage or {}).get("stage")
    action_type = issue.get("recommended_action_type")
    notes: list[str] = []
    if stage == "seed":
        if action_type == "demand_seed_content":
            notes.append("seed-stage site: prioritize creating qualified demand-capture assets before optimizing sparse GSC noise")
            return 1.25, notes
        notes.append("seed-stage site: GSC evidence is sparse, so require external demand validation")
        return 0.85, notes
    if stage == "recover" and action_type in {"content_refresh", "page_improvement", "snippet_content_packaging"}:
        notes.append("recover-stage site: recent losses get extra priority")
        return 1.15, notes
    if stage == "harvest" and action_type in {"meta_tags", "snippet_content_packaging", "internal_links", "local_intent_ownership"}:
        notes.append("harvest-stage site: enough impressions exist to optimize existing qualified demand")
        return 1.1, notes
    return 1.0, notes


def conversion_opportunity_for_issue(issue: dict[str, Any], business_context: dict[str, Any] | None, site_stage: dict[str, Any]) -> dict[str, Any]:
    query = str(issue.get("primary_query") or issue.get("diagnostic_query") or "")
    target = str(issue.get("target") or issue.get("canonical_target") or issue.get("raw_target") or "")
    title = str(issue.get("title") or "")
    combined = " ".join([query, target, title])
    service_weight, matched_service = weighted_terms_match_score(combined, (business_context or {}).get("service_value_weights"), default=1.0)
    role_weight, role = page_role_conversion_weight(issue, business_context)
    event_weight, matched_event = conversion_event_weight_for_issue(issue, business_context)
    intent_weight = float((issue.get("score_components") or {}).get("business_intent_score") or 1.0)
    if is_branded_query(query, (business_context or {}).get("brand_terms") or []):
        intent_weight = min(intent_weight, 0.85)
    stage_weight, stage_notes = stage_conversion_multiplier(site_stage, issue)
    has_context = bool(business_context)
    context_weight = 1.0 if has_context else 0.95
    multiplier = clamp(service_weight * role_weight * event_weight * intent_weight * stage_weight * context_weight, 0.35, 2.25)
    notes = []
    if matched_service:
        notes.append(f"matched high-value service/product: {matched_service}")
    if matched_event:
        notes.append(f"maps to conversion event: {matched_event}")
    if role != "unknown":
        notes.append(f"page role: {role}")
    if not has_context:
        notes.append("business context missing; conversion weighting is conservative")
    notes.extend(stage_notes)
    return {
        "multiplier": round(multiplier, 3),
        "service_value_weight": round(service_weight, 3),
        "matched_service": matched_service,
        "page_role_weight": round(role_weight, 3),
        "page_role": role,
        "conversion_event_weight": round(event_weight, 3),
        "matched_conversion_event": matched_event,
        "intent_weight": round(intent_weight, 3),
        "stage_weight": round(stage_weight, 3),
        "stage": (site_stage or {}).get("stage"),
        "notes": notes,
    }


def apply_conversion_weighting(candidates: list[dict[str, Any]], business_context: dict[str, Any] | None, site_stage: dict[str, Any]) -> list[dict[str, Any]]:
    weighted = []
    for candidate in candidates:
        updated = dict(candidate)
        opportunity = conversion_opportunity_for_issue(updated, business_context, site_stage)
        raw_priority = float(updated.get("priority_score", updated.get("base_priority", 0.5)))
        updated["raw_priority_score"] = round(raw_priority, 3)
        updated["conversion_opportunity"] = opportunity
        updated["priority_score"] = round(raw_priority * float(opportunity["multiplier"]), 3)
        score_components = dict(updated.get("score_components") or {})
        score_components["conversion_multiplier"] = opportunity["multiplier"]
        score_components["conversion_weighted_priority_score"] = updated["priority_score"]
        updated["score_components"] = score_components
        notes = list(updated.get("operator_judgment_notes") or [])
        notes.extend(opportunity.get("notes") or [])
        updated["operator_judgment_notes"] = list(dict.fromkeys(notes))
        weighted.append(updated)
    return weighted


def seed_demand_issue(site_id: str, analysis: dict[str, Any], site_profile: dict[str, Any] | None, business_context: dict[str, Any] | None, site_stage: dict[str, Any]) -> dict[str, Any]:
    summary = analysis.get("summary") or {}
    top_pages = analysis.get("top_pages") or []
    top_queries = analysis.get("top_queries") or []
    canonical = (site_profile or {}).get("canonical_url") or f"https://{site_id}"
    visible_pages = [str(page.get("page")) for page in top_pages[:5] if page.get("page")]
    visible_queries = [str(query.get("query")) for query in top_queries[:8] if query.get("query")]
    context = business_context or {}
    conversion_events = context_values(context.get("conversion_events"))[:5]
    recommended_deliverable = {
        "artifact_type": "seed_content_portfolio_brief",
        "goal": "Create qualified organic demand where GSC does not yet have enough data to optimize.",
        "minimum_bets": 3,
        "demand_sources": [
            "Google Ads/search-term data",
            "Keyword Planner",
            "competitor SERPs",
            "customer/sales language",
            "existing product/integration docs",
        ],
        "page_bet_types": [
            "high-intent integration/setup page",
            "comparison or alternative page",
            "use-case landing page",
            "problem/solution page with conversion CTA",
        ],
        "required_fields_per_bet": ["slug", "target_query_cluster", "intent", "conversion_event", "title", "h1", "CTA", "measurement_plan"],
        "known_gsc_pages": visible_pages,
        "visible_gsc_queries": visible_queries,
        "known_conversion_events": conversion_events,
        "success_metric": "qualified organic impressions/clicks plus mapped conversion events by landing page",
    }
    return make_issue(
        f"Seed qualified organic demand for {site_id}",
        "warning",
        0.62,
        [
            f"Only {summary.get('clicks', 0):g} clicks and {summary.get('impressions', 0):g} impressions in the current GSC window.",
            "Sparse GSC means the operator should generate validated demand-capture bets instead of reporting no issue.",
        ],
        "demand_seed_content",
        target=canonical,
        base_priority=0.55,
        priority_score=0.55,
        expected_click_delta=None,
        expected_impact="Prepare an approval-ready portfolio of 3–5 high-intent organic landing/content bets, then measure first impressions/clicks/conversions.",
        approval_artifact_type="seed_content_portfolio_brief",
        recommended_deliverable=recommended_deliverable,
        site_stage=site_stage,
        score_components={
            "expected_impact": 0.55,
            "confidence_score": 0.62,
            "goal_alignment_score": 1.0,
            "actionability_score": 0.85,
            "url_quality_score": 1.0,
        },
        operator_judgment_notes=[
            "seed mode: use external demand sources because GSC has too little volume",
            "human approval is still required before publishing new pages or content",
        ],
    )

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
    site_stage = infer_site_stage(analysis, metrics, business_context)
    candidates = dedupe_candidates(apply_business_context(derive_candidate_issues(analysis), business_context, site_id=site_id))
    candidates = apply_conversion_weighting(candidates, business_context, site_stage)
    ranked = apply_prioritization(candidates, learned, primary_metric)
    if site_stage.get("stage") == "seed":
        # Sparse-GSC sites need demand creation first. Keep noisy GSC-derived items as
        # supporting diagnostics, but do not let a single low-volume CTR gap become
        # the approval proposal ahead of the seed content portfolio.
        seed_issue = seed_demand_issue(site_id, analysis, site_profile, business_context, site_stage)
        seed_ranked = apply_prioritization(apply_conversion_weighting([seed_issue], business_context, site_stage), learned, primary_metric)
        top_issues = [*seed_ranked, *ranked[:2]]
    elif ranked:
        top_issues = ranked[:3]
    else:
        top_issues = [
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
    proposal_written = False
    for idx, issue in enumerate(top_issues, start=1):
        action_id = f"weekly_action_{idx:02d}"
        action_type = issue["recommended_action_type"]
        readiness = approval_readiness_for_issue(issue)
        issue["approval_ready"] = readiness["approval_ready"]
        issue["approval_blockers"] = readiness["approval_blockers"]
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
                "conversion_opportunity": issue.get("conversion_opportunity"),
                "raw_priority_score": issue.get("raw_priority_score"),
                "site_stage": site_stage,
                "best_practice_alignment": issue.get("best_practice_alignment"),
                "primary_query": issue.get("primary_query"),
                "diagnostic_query": issue.get("diagnostic_query"),
                "query_decomposition": issue.get("query_decomposition"),
                "top_losing_queries": issue.get("top_losing_queries", []),
                "approval_ready": issue.get("approval_ready", False),
                "approval_blockers": issue.get("approval_blockers", []),
                "consolidation_targets": issue.get("consolidation_targets"),
                "source_target": issue.get("source_target"),
                "approval_artifact_type": issue.get("approval_artifact_type"),
                "recommended_deliverable": issue.get("recommended_deliverable"),
                "needs_business_context": context_check["score"] < 0.75,
                "learned_multiplier": issue.get("learned_multiplier", 1.0),
            }
        )
        if not proposal_written and issue.get("approval_ready") and action_type != "manual_review":
            proposal_written = True
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
                    "conversion_opportunity": issue.get("conversion_opportunity"),
                    "raw_priority_score": issue.get("raw_priority_score"),
                    "site_stage": site_stage,
                    "best_practice_alignment": issue.get("best_practice_alignment"),
                    "primary_query": issue.get("primary_query"),
                    "diagnostic_query": issue.get("diagnostic_query"),
                    "query_decomposition": issue.get("query_decomposition"),
                    "top_losing_queries": issue.get("top_losing_queries", []),
                    "approval_ready": issue.get("approval_ready", False),
                    "approval_blockers": issue.get("approval_blockers", []),
                    "consolidation_targets": issue.get("consolidation_targets"),
                    "source_target": issue.get("source_target"),
                    "approval_artifact_type": issue.get("approval_artifact_type"),
                    "recommended_deliverable": issue.get("recommended_deliverable"),
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
            "site_stage": site_stage,
        },
        "audit": {
            "site_id": site_id,
            "summary": f"Automated weekly review surfaced {len(top_issues)} prioritized issue(s).",
            "issues": top_issues,
            "metrics": metrics,
            "site_stage": site_stage,
        },
        "action_plan": {
            "site_id": site_id,
            "goal_id": goal.get("goal_id") if goal else None,
            "site_stage": site_stage,
            "actions": action_entries,
        },
        "verification": {
            "site_id": site_id,
            "checks": [
                {"name": "gsc analysis available", "status": "pass", "notes": "Weekly review generated from Search Console data."},
                {"name": "action plan generated", "status": "pass", "notes": f"Primary metric for follow-up scoring: {primary_metric}."},
                {"name": "site stage playbook", "status": "pass", "notes": site_stage.get("reason", "Site stage inferred."), "site_stage": site_stage},
                {
                    "name": "recommendation quality gate",
                    "status": "pass" if top_issues[0].get("approval_ready") else "warning",
                    "notes": "; ".join(top_issues[0].get("approval_blockers") or top_issues[0].get("operator_judgment_notes", [])) or "Top action has explicit score components for operator review.",
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
    site_stage = (payload.get("action_plan") or {}).get("site_stage") or {}
    lines = [
        f"Weekly SEO review complete for `{site_id}`.",
        "",
        f"Run: `{result.get('run_dir')}`",
        f"Summary: {summary}",
    ]
    if site_stage:
        lines.append(f"Stage: `{site_stage.get('stage')}` — {site_stage.get('reason')}")
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
        conversion = top_action.get("conversion_opportunity") or {}
        if conversion:
            lines.append(f"- Conversion weighting: {conversion.get('multiplier')}× ({'; '.join(conversion.get('notes') or []) or 'no notes'})")
        if top_action.get("approval_artifact_type"):
            lines.append(f"- Approval artifact: `{top_action.get('approval_artifact_type')}`")
        if top_action.get("approval_ready") is False:
            blockers = top_action.get("approval_blockers") or []
            lines.append(f"- Approval-ready: no{'; ' + '; '.join(blockers) if blockers else ''}")
        deep_dive = top_action.get("deep_dive") or {}
        checks = deep_dive.get("checks") or {}
        if deep_dive:
            lines.append(
                f"- Deep dive: {deep_dive.get('status')} "
                f"(SERP {'yes' if checks.get('serp_inspected') else 'no'}, "
                f"snippet {'yes' if checks.get('current_snippet_inspected') else 'no'}, "
                f"above-fold {'yes' if checks.get('above_the_fold_inspected') else 'no'})"
            )
        # Surface top-losing-query decomposition if available
        top_losing = top_action.get("top_losing_queries", [])
        if top_losing:
            top_query = top_losing[0]
            lines.append(
                f"- Top losing query: `{top_query.get('query', '?')}` "
                f"(lost {top_query.get('absolute_click_loss', 0):g} clicks, "
                f"pos {top_query.get('position_prev', '?')}→{top_query.get('position_now', '?')}, "
                f"CTR {top_query.get('ctr_prev', '?')}%→{top_query.get('ctr_now', '?')}%)"
            )
    if proposal_path:
        lines.extend(["", f"Proposal file: `{proposal_path}`"])
    elif top_action:
        lines.extend(["", "No approval proposal was queued; the review surfaced diagnostics only."])
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
