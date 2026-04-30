#!/usr/bin/env python3
"""Process due items from the Toprank OpenClaw schedule."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from persist_run import persist_payload
from runtime import bootstrap_workspace, load_json, now_iso, reconcile_schedule_from_queue, save_json, update_learned_patterns, workspace_root
from score_feedback import score_item


def parse_iso(value: str | None) -> datetime:
    if not value:
        return datetime.max.replace(tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def update_queue_file(root: Path, item: dict, **updates) -> str | None:
    item_id = item.get("item_id")
    site_id = item.get("site_id")
    if not item_id or not site_id:
        return None
    queue_path = root / "sites" / site_id / "queue" / f"{item_id}.json"
    if not queue_path.exists():
        return None
    payload = load_json(queue_path, {})
    payload.update(updates)
    save_json(queue_path, payload)
    return str(queue_path)


def build_feedback_payload(item: dict, root: Path, score: dict | None = None) -> dict:
    site_id = item["site_id"]
    latest = load_json(root / "sites" / site_id / "latest-state.json", {"summary": "No recent state summary.", "open_issues": []})
    summary = item.get("notes") or latest.get("summary") or "Scheduled follow-up review."
    action_id = item.get("item_id", "feedback_check")
    score = score or score_item(item)
    outcome = score.get("outcome", "inconclusive")
    reason = score.get("reason", "no scoring reason available")
    score_summary = f"Feedback outcome: {outcome}. Reason: {reason}."
    if score.get("primary_metric"):
        score_summary += f" Primary metric `{score['primary_metric']}` changed {score.get('primary_change', 0):+.1%}."
    return {
        "trigger": {
            "type": "scheduled_followup",
            "notes": summary,
            "source_item_id": action_id,
        },
        "state_snapshot": {
            "site_id": site_id,
            "summary": f"Follow-up checkpoint due for {site_id}. {score_summary}",
            "open_issues": latest.get("open_issues", []),
            "recent_actions": latest.get("recent_actions", []),
        },
        "audit": {
            "site_id": site_id,
            "summary": f"Scheduled feedback review for {site_id}. {score_summary}",
            "issues": [
                {
                    "title": "A scheduled follow-up reached its review window.",
                    "severity": "info" if outcome in {"win", "neutral", "inconclusive"} else "warning",
                    "confidence": score.get("confidence", 0.6),
                    "evidence": [summary, score_summary],
                    "recommended_action_type": "feedback_review",
                }
            ],
        },
        "action_plan": {
            "site_id": site_id,
            "actions": [
                {
                    "action_id": f"feedback_review_{action_id}",
                    "title": "Review post-change performance and decide whether to continue, revise, or stop the intervention.",
                    "type": "feedback_review",
                    "priority_score": 0.7,
                    "expected_impact": "Turns a pending follow-up into a concrete review task.",
                    "requires_approval": False,
                    "reversibility": "high",
                    "owner": "operator",
                }
            ],
        },
        "feedback": {
            "site_id": site_id,
            "action_id": action_id,
            "window_days": 14,
            "outcome": outcome,
            "summary": score_summary,
            "score": score,
        },
        "learning_log": {
            "site_id": site_id,
            "observations": [
                {
                    "pattern": f"followup_{outcome}",
                    "confidence": score.get("confidence", 0.55),
                    "notes": score_summary,
                }
            ],
        },
        "verification": {
            "site_id": site_id,
            "checks": [
                {
                    "name": "follow-up materialized",
                    "status": "pass",
                    "notes": "A scheduled follow-up run artifact was created.",
                },
                {
                    "name": "outcome available",
                    "status": "pass" if outcome != "inconclusive" else "warning",
                    "notes": score_summary if outcome != "inconclusive" else "Metric data is still incomplete, so the follow-up remains inconclusive.",
                },
            ],
            "follow_up_due": None,
        },
    }


def mark_for_attention(root: Path, item: dict, reason: str) -> dict:
    item["status"] = "ready_for_attention"
    item["surfaced_at"] = now_iso()
    item["attention_reason"] = reason
    update_queue_file(
        root,
        item,
        status="ready_for_attention",
        surfaced_at=item["surfaced_at"],
        attention_reason=reason,
    )
    return {
        "item_id": item.get("item_id"),
        "site_id": item.get("site_id"),
        "type": item.get("type"),
        "reason": reason,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site")
    parser.add_argument("--as-of", default=now_iso())
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv[1:])

    root = bootstrap_workspace(workspace_root())
    schedule_path = root / "schedule.json"
    schedule = load_json(schedule_path, {"schema_version": "1", "upcoming": []})
    schedule, restored_from_queue = reconcile_schedule_from_queue(root, schedule)
    upcoming = schedule.setdefault("upcoming", [])
    as_of_dt = parse_iso(args.as_of)

    processed = []
    manual_attention = []

    for item in upcoming:
        if item.get("status", "pending") not in {"pending", "ready_for_attention"}:
            continue
        if args.site and item.get("site_id") != args.site:
            continue
        if parse_iso(item.get("due_at")) > as_of_dt:
            continue

        if item.get("type") == "feedback_check":
            if args.dry_run:
                score = score_item(item)
                if score.get("outcome") == "inconclusive":
                    manual_attention.append(
                        {
                            "item_id": item.get("item_id"),
                            "site_id": item.get("site_id"),
                            "type": item.get("type"),
                            "reason": score.get("reason", "feedback scoring was inconclusive"),
                            "dry_run": True,
                        }
                    )
                else:
                    processed.append(
                        {
                            "item_id": item.get("item_id"),
                            "site_id": item.get("site_id"),
                            "outcome": score.get("outcome"),
                            "dry_run": True,
                        }
                    )
                continue
            score = score_item(item)
            if score.get("outcome") == "inconclusive":
                manual_attention.append(mark_for_attention(root, item, score.get("reason", "feedback scoring was inconclusive")))
                continue
            payload = build_feedback_payload(item, root, score)
            result = persist_payload(item["site_id"], payload, root=root)
            feedback_outcome = payload.get("feedback", {}).get("outcome", "inconclusive")
            item["status"] = "processed"
            item["processed_at"] = now_iso()
            item["result_run_dir"] = result["run_dir"]
            update_queue_file(root, item, status="done", processed_at=item["processed_at"], result_run_dir=result["run_dir"])

            feedback_path = root / "sites" / item["site_id"] / "feedback" / f"{item['item_id']}.json"
            feedback_payload = {
                "site_id": item["site_id"],
                "item_id": item["item_id"],
                "processed_at": item["processed_at"],
                "result_run_dir": result["run_dir"],
                "status": feedback_outcome,
                "notes": payload.get("feedback", {}).get("summary") or item.get("notes"),
                "score": payload.get("feedback", {}).get("score"),
            }
            save_json(feedback_path, feedback_payload)
            update_learned_patterns(
                item["site_id"],
                action_type=item.get("action_type"),
                primary_metric=payload.get("feedback", {}).get("score", {}).get("primary_metric"),
                outcome=feedback_outcome,
                primary_change=payload.get("feedback", {}).get("score", {}).get("primary_change"),
                confidence=payload.get("feedback", {}).get("score", {}).get("confidence"),
                notes=payload.get("feedback", {}).get("summary") or item.get("notes"),
                root=root,
            )
            processed.append({"item_id": item.get("item_id"), "site_id": item.get("site_id"), "result_run_dir": result["run_dir"], "outcome": feedback_outcome})
        else:
            manual_attention.append(mark_for_attention(root, item, f"unsupported schedule item type: {item.get('type')}"))

    if not args.dry_run:
        save_json(schedule_path, schedule)

    result = {
        "generated_at": now_iso(),
        "as_of": args.as_of,
        "processed": processed,
        "manual_attention": manual_attention,
        "restored_from_queue": restored_from_queue,
        "dry_run": args.dry_run,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
