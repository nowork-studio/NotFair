#!/usr/bin/env python3
"""Run an automated weekly review for a site using GSC analysis output."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
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


def make_issue(title: str, severity: str, confidence: float, evidence: list[str], action_type: str, target: str | None = None, base_priority: float = 0.5) -> dict[str, Any]:
    issue = {
        "title": title,
        "severity": severity,
        "confidence": round(confidence, 2),
        "evidence": evidence,
        "recommended_action_type": action_type,
        "base_priority": round(base_priority, 3),
    }
    if target:
        issue["target"] = target
    return issue


def derive_candidate_issues(data: dict[str, Any]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    comparison = data.get("comparison") or {}
    ctr_gaps = data.get("ctr_gaps_by_page") or []
    cannibalization = data.get("cannibalization") or []
    ctr_opps = data.get("ctr_opportunities") or []
    declining_pages = comparison.get("declining_pages") or []
    declining_queries = comparison.get("declining_queries") or []

    if declining_pages:
        page = declining_pages[0]
        issues.append(
            make_issue(
                f"Traffic dropped on {page.get('page')}",
                "critical",
                0.84,
                [
                    f"Clicks changed {page.get('change_pct')}% vs prior period.",
                    f"Current clicks: {page.get('clicks_now')} | previous clicks: {page.get('clicks_prev')}",
                ],
                "page_improvement",
                target=page.get("page"),
                base_priority=0.95,
            )
        )

    if ctr_gaps:
        gap = ctr_gaps[0]
        issues.append(
            make_issue(
                f"High-impression page with low CTR: {gap.get('page')}",
                "warning",
                0.78,
                [
                    f"{gap.get('impressions')} impressions with CTR {gap.get('ctr')}%.",
                    f"Average position {gap.get('position')} suggests snippet improvements may help.",
                ],
                "meta_tags",
                target=gap.get("page"),
                base_priority=0.8,
            )
        )

    if cannibalization:
        cannibal = cannibalization[0]
        issues.append(
            make_issue(
                f"Cannibalization on query '{cannibal.get('query')}'",
                "warning",
                0.73,
                [
                    f"Winner page: {cannibal.get('winner_page')}",
                    f"Competing pages: {', '.join(cannibal.get('loser_pages', []))}",
                ],
                "internal_links",
                target=cannibal.get("winner_page"),
                base_priority=0.72,
            )
        )

    if ctr_opps:
        opp = ctr_opps[0]
        issues.append(
            make_issue(
                f"Query-level CTR opportunity: {opp.get('query')}",
                "info",
                0.68,
                [
                    f"{opp.get('impressions')} impressions with CTR {opp.get('ctr')}%.",
                    f"Average position {opp.get('position')}.",
                ],
                "meta_tags",
                base_priority=0.64,
            )
        )

    if declining_queries:
        query = declining_queries[0]
        issues.append(
            make_issue(
                f"Query demand fell for '{query.get('query')}'",
                "warning",
                0.66,
                [
                    f"Clicks changed {query.get('change_pct')}% vs prior period.",
                    f"Current clicks: {query.get('clicks_now')} | previous clicks: {query.get('clicks_prev')}",
                ],
                "content_refresh",
                base_priority=0.62,
            )
        )

    return issues


def apply_prioritization(candidates: list[dict[str, Any]], learned: dict[str, Any], primary_metric: str) -> list[dict[str, Any]]:
    severity_weight = {"critical": 1.0, "warning": 0.75, "info": 0.45}
    ranked = []
    for item in candidates:
        multiplier = learned_multiplier(learned, item["recommended_action_type"], primary_metric)
        score = item.get("base_priority", 0.5) * severity_weight.get(item.get("severity", "warning"), 0.6) * multiplier * (0.6 + item.get("confidence", 0.5))
        enriched = dict(item)
        enriched["priority_score"] = round(score, 3)
        enriched["learned_multiplier"] = multiplier
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
        action_entries.append(
            {
                "action_id": action_id,
                "title": issue["title"],
                "type": action_type,
                "priority_score": issue["priority_score"],
                "expected_impact": f"Address {action_type.replace('_', ' ')} opportunity surfaced in the weekly review.",
                "requires_approval": action_type not in {"manual_review"},
                "reversibility": "high",
                "owner": "operator",
                "target": issue.get("target"),
                "learned_multiplier": issue.get("learned_multiplier", 1.0),
            }
        )
        if idx == 1 and action_type != "manual_review":
            queue_items.append(
                {
                    "item_id": f"followup_{site_id}_{action_type}_{analysis['period']['days']}d",
                    "type": "feedback_check",
                    "status": "pending",
                    "due_at": future_iso(14),
                    "notes": f"Review the impact of the weekly action: {issue['title']}",
                    "action_type": action_type,
                    "target": issue.get("target"),
                    "primary_metric": primary_metric,
                    "primary_direction": "higher_better" if "position" not in primary_metric else "lower_better",
                    "success_threshold_pct": 0.1,
                    "baseline_metrics": metrics,
                    "guardrail_metrics": [],
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

    payload = build_payload(site_id, analysis, learned, active_goal)
    result = persist_payload(args.site, payload, root=root)
    result["primary_metric"] = payload["queue_items"][0]["primary_metric"] if payload.get("queue_items") else None
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
