#!/usr/bin/env python3
"""Run an automated weekly review for a site using GSC analysis output."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
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
    actionability_score = 0.95
    url_quality = float(url_context(raw_target)["url_quality_score"])
    query = gap.get("query")
    goal_alignment_score, goal_notes = goal_alignment_for_query(query, brand_terms)
    score = impact_score * confidence * goal_alignment_score * actionability_score * url_quality
    evidence = [
        f"{impressions:g} impressions with CTR {ctr}%.",
        f"Average position {position:g}; conservative expected CTR {expected_ctr}% suggests ~{incremental_clicks:.0f} incremental-click upside.",
    ]
    if query:
        evidence.append(f"Underperforming query: {query}")
    return make_issue(
        f"High-impression page with low CTR: {raw_target}",
        severity_from_score(score),
        confidence,
        evidence,
        "meta_tags",
        target=raw_target,
        base_priority=impact_score,
        expected_click_delta=round(incremental_clicks, 1),
        priority_score=round(score, 3),
        score_components={
            "expected_impact": round(impact_score, 3),
            "confidence_score": confidence,
            "goal_alignment_score": goal_alignment_score,
            "actionability_score": actionability_score,
            "url_quality_score": url_quality,
        },
        operator_judgment_notes=["clear snippet/title lever with measurable upside", *goal_notes],
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
    goal_alignment_score, goal_notes = goal_alignment_for_query(opp.get("query"), brand_terms)
    score = impact_score * confidence * goal_alignment_score * actionability_score
    return make_issue(
        f"Query-level CTR opportunity: {opp.get('query')}",
        severity_from_score(score),
        confidence,
        [
            f"{impressions:g} impressions with CTR {ctr}%.",
            f"Average position {position:g}; conservative expected CTR {expected_ctr}% suggests ~{incremental_clicks:.0f} incremental-click upside.",
        ],
        "meta_tags",
        base_priority=impact_score,
        expected_click_delta=round(incremental_clicks, 1),
        priority_score=round(score, 3),
        score_components={
            "expected_impact": round(impact_score, 3),
            "confidence_score": confidence,
            "goal_alignment_score": goal_alignment_score,
            "actionability_score": actionability_score,
            "url_quality_score": 1.0,
        },
        operator_judgment_notes=["query-level signal; map to a page before editing", *goal_notes],
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

def build_payload(site_id: str, analysis: dict[str, Any], learned: dict[str, Any], goal: dict[str, Any] | None) -> dict[str, Any]:
    metrics = metric_snapshot_from_analysis(analysis)
    primary_metric = None
    if goal and goal.get("primary_metric"):
        primary_metric = goal["primary_metric"]
    if not primary_metric:
        primary_metric = DEFAULT_PRIMARY_METRIC if DEFAULT_PRIMARY_METRIC in metrics else next(iter(metrics.keys()), DEFAULT_PRIMARY_METRIC)

    candidates = derive_candidate_issues(analysis)
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
        }
        for issue in top_issues
    ]

    summary = analysis.get("summary") or {}
    non_brand_clicks = metrics.get(primary_metric)
    action_entries = []
    queue_items = []
    for idx, issue in enumerate(top_issues, start=1):
        action_id = f"weekly_action_{idx:02d}"
        action_type = issue["recommended_action_type"]
        expected_delta = issue.get("expected_click_delta")
        expected_impact = f"Address {action_type.replace('_', ' ')} opportunity surfaced in the weekly review."
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
    subprocess.run(cmd, check=True)
    return json.loads(output_path.read_text())


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
    payload = build_payload(site_id, analysis, learned, active_goal)
    result = persist_payload(args.site, payload, root=root)
    result["primary_metric"] = payload["queue_items"][0]["primary_metric"] if payload.get("queue_items") else None
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
