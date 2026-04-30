#!/usr/bin/env python3
"""List due or upcoming follow-up items from the Toprank OpenClaw schedule."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from runtime import bootstrap_workspace, load_json, now_iso, reconcile_schedule_from_queue, save_json, workspace_root


def parse_iso(value: str | None) -> datetime:
    if not value:
        return datetime.max.replace(tzinfo=timezone.utc)
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site")
    parser.add_argument("--include-future", action="store_true")
    parser.add_argument("--as-of", default=now_iso())
    args = parser.parse_args(argv[1:])

    root = bootstrap_workspace(workspace_root())
    schedule_path = root / "schedule.json"
    schedule = load_json(schedule_path, {"upcoming": []})
    schedule, restored_from_queue = reconcile_schedule_from_queue(root, schedule)
    save_json(schedule_path, schedule)
    cutoff = parse_iso(args.as_of)

    items = []
    for item in schedule.get("upcoming", []):
        if item.get("status") in {"done", "processed"}:
            continue
        if args.site and item.get("site_id") != args.site:
            continue
        due_at = parse_iso(item.get("due_at"))
        if args.include_future or due_at <= cutoff:
            items.append(item)

    items.sort(key=lambda item: item.get("due_at") or "")
    result = {
        "generated_at": now_iso(),
        "as_of": args.as_of,
        "site_filter": args.site,
        "count": len(items),
        "items": items,
        "restored_from_queue": restored_from_queue,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
