#!/usr/bin/env python3
"""Shared helpers for the Toprank OpenClaw runtime workspace."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TERMINAL_QUEUE_STATUSES = {"done", "processed"}


def workspace_root() -> Path:
    configured = os.environ.get("TOPRANK_OPENCLAW_HOME")
    return Path(configured or (Path.home() / ".toprank" / "openclaw")).expanduser()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def timestamp_slug() -> str:
    return now_iso().replace(":", "-")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text())


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def bootstrap_workspace(root: Path | None = None) -> Path:
    root = (root or workspace_root()).expanduser()
    (root / "sites").mkdir(parents=True, exist_ok=True)

    portfolio = root / "portfolio.json"
    schedule = root / "schedule.json"

    if not portfolio.exists():
        save_json(portfolio, {"schema_version": "1", "portfolio_id": "default", "sites": []})
    if not schedule.exists():
        save_json(schedule, {"schema_version": "1", "upcoming": []})
    return root


def site_root(site_id: str, root: Path | None = None) -> Path:
    root = bootstrap_workspace(root)
    return root / "sites" / site_id


def ensure_site_dirs(site_id: str, root: Path | None = None) -> Path:
    site = site_root(site_id, root)
    for subdir in ["queue", "proposals", "runs", "feedback"]:
        (site / subdir).mkdir(parents=True, exist_ok=True)
    return site


def update_learned_patterns(
    site_id: str,
    *,
    action_type: str | None,
    primary_metric: str | None,
    outcome: str,
    primary_change: float | None,
    confidence: float | None,
    notes: str | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    site = ensure_site_dirs(site_id, root)
    path = site / "learned-patterns.json"
    payload = load_json(path, {"site_id": site_id, "observations": [], "priors": {}})
    payload.setdefault("site_id", site_id)
    payload.setdefault("observations", [])
    priors = payload.setdefault("priors", {})

    key = f"{action_type or 'unknown'}::{primary_metric or 'unknown'}"
    prior = priors.setdefault(
        key,
        {
            "action_type": action_type or "unknown",
            "primary_metric": primary_metric or "unknown",
            "sample_size": 0,
            "wins": 0,
            "neutral": 0,
            "losses": 0,
            "inconclusive": 0,
            "avg_primary_change": 0.0,
            "confidence": 0.0,
            "last_outcome": None,
            "last_updated_at": None,
        },
    )

    prior["sample_size"] += 1
    if outcome == "win":
        prior["wins"] += 1
    elif outcome == "loss":
        prior["losses"] += 1
    elif outcome == "neutral":
        prior["neutral"] += 1
    else:
        prior["inconclusive"] += 1

    if primary_change is not None:
        previous_count = prior["sample_size"] - 1
        previous_avg = float(prior.get("avg_primary_change", 0.0))
        prior["avg_primary_change"] = round(((previous_avg * previous_count) + float(primary_change)) / max(prior["sample_size"], 1), 4)
    if confidence is not None:
        previous_count = prior["sample_size"] - 1
        previous_conf = float(prior.get("confidence", 0.0))
        prior["confidence"] = round(((previous_conf * previous_count) + float(confidence)) / max(prior["sample_size"], 1), 4)

    prior["last_outcome"] = outcome
    prior["last_updated_at"] = now_iso()

    payload["observations"].append(
        {
            "generated_at": now_iso(),
            "action_type": action_type or "unknown",
            "primary_metric": primary_metric or "unknown",
            "outcome": outcome,
            "primary_change": primary_change,
            "confidence": confidence,
            "notes": notes,
        }
    )
    save_json(path, payload)
    return payload


def upsert_schedule_items(items: list[dict[str, Any]], root: Path | None = None) -> list[dict[str, Any]]:
    root = bootstrap_workspace(root)
    schedule_path = root / "schedule.json"
    schedule = load_json(schedule_path, {"schema_version": "1", "upcoming": []})
    upcoming = schedule.setdefault("upcoming", [])
    written: list[dict[str, Any]] = []

    for item in items:
        item_id = item.get("item_id")
        if not item_id:
            continue
        site_id = item.get("site_id")
        existing = next(
            (
                entry
                for entry in upcoming
                if entry.get("item_id") == item_id and (site_id is None or entry.get("site_id") == site_id)
            ),
            None,
        )
        if existing is None:
            upcoming.append(item)
            written.append(item)
        else:
            existing.update(item)
            written.append(existing)

    save_json(schedule_path, schedule)
    return written


def reconcile_schedule_from_queue(root: Path | None = None, schedule: dict[str, Any] | None = None) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Restore scheduled work from per-site queue files.

    Queue files are the durable per-site task records. `schedule.json` is an
    index used by the runner, so a missing schedule entry should not make a
    pending queue item disappear from backend processing.
    """
    root = bootstrap_workspace(root)
    if schedule is None:
        schedule = load_json(root / "schedule.json", {"schema_version": "1", "upcoming": []})
    upcoming = schedule.setdefault("upcoming", [])
    restored: list[dict[str, Any]] = []

    existing_by_key = {
        (entry.get("site_id"), entry.get("item_id")): entry
        for entry in upcoming
        if entry.get("site_id") and entry.get("item_id")
    }

    sites_dir = root / "sites"
    if not sites_dir.exists():
        return schedule, restored

    for queue_path in sites_dir.glob("*/queue/*.json"):
        try:
            item = load_json(queue_path, {})
        except json.JSONDecodeError:
            continue
        if not isinstance(item, dict):
            continue
        if not item.get("due_at"):
            continue
        status = item.get("status", "pending")
        if status in TERMINAL_QUEUE_STATUSES:
            continue

        site_id = item.get("site_id") or queue_path.parents[1].name
        item_id = item.get("item_id") or queue_path.stem
        item["site_id"] = site_id
        item["item_id"] = item_id
        key = (site_id, item_id)
        existing = existing_by_key.get(key)
        if existing is None:
            upcoming.append(dict(item))
            existing_by_key[key] = upcoming[-1]
            restored.append(upcoming[-1])
        elif existing.get("status") not in TERMINAL_QUEUE_STATUSES:
            existing.update(item)

    return schedule, restored


def upsert_portfolio_site(
    site_id: str,
    *,
    display_name: str | None = None,
    business_weight: float = 1.0,
    cadence: str = "weekly",
    status: str = "active",
    root: Path | None = None,
) -> dict[str, Any]:
    root = bootstrap_workspace(root)
    portfolio_path = root / "portfolio.json"
    portfolio = load_json(portfolio_path, {"schema_version": "1", "portfolio_id": "default", "sites": []})
    sites = portfolio.setdefault("sites", [])

    existing = next((item for item in sites if item.get("site_id") == site_id), None)
    record = {
        "site_id": site_id,
        "display_name": display_name or site_id,
        "business_weight": business_weight,
        "cadence": cadence,
        "status": status,
    }

    if existing is None:
        sites.append(record)
    else:
        existing.update(record)
        record = existing

    save_json(portfolio_path, portfolio)
    return record
