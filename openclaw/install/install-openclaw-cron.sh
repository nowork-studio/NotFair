#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Install OpenClaw cron wiring for the Toprank OpenClaw SEO Operator.

Usage:
  ./openclaw/install/install-openclaw-cron.sh [options]

Options:
  --to <dest>              Delivery destination, e.g. Telegram chat id. If omitted, jobs use --no-deliver.
  --channel <channel>      Delivery channel for --to. Default: telegram.
  --thread-id <id>         Optional Telegram forum topic/thread id.
  --account <id>           Optional channel account id.
  --model <model>          Optional OpenClaw model override. Omit unless you know the allowlist accepts it.
  --timezone <tz>          Cron timezone. Default: America/Los_Angeles.
  --weekly-time <HH:MM>    Local time for weekly reviews. Default: 06:30.
  --scheduler-every <dur>  Scheduler interval. Default: 1h.
  --sites <csv>            Comma-separated sites. Default: active sites from ~/.toprank/openclaw/portfolio.json.
  --runtime-home <path>    Toprank runtime home. Default: ~/.toprank/openclaw.
  --repo-root <path>       Toprank repo root. Default: auto-detected from this script.
  -h, --help              Show this help.

Examples:
  ./openclaw/install/install-openclaw-cron.sh --to "-1001234567890" --thread-id 28
  ./openclaw/install/install-openclaw-cron.sh --no-deliver is not needed; omit --to instead.
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNTIME_HOME="${TOPRANK_OPENCLAW_HOME:-$HOME/.toprank/openclaw}"
CHANNEL="telegram"
TO=""
THREAD_ID=""
ACCOUNT=""
MODEL=""
TIMEZONE="America/Los_Angeles"
WEEKLY_TIME="06:30"
SCHEDULER_EVERY="1h"
SITES_CSV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TO="$2"; shift 2 ;;
    --channel) CHANNEL="$2"; shift 2 ;;
    --thread-id) THREAD_ID="$2"; shift 2 ;;
    --account) ACCOUNT="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --timezone|--tz) TIMEZONE="$2"; shift 2 ;;
    --weekly-time) WEEKLY_TIME="$2"; shift 2 ;;
    --scheduler-every) SCHEDULER_EVERY="$2"; shift 2 ;;
    --sites) SITES_CSV="$2"; shift 2 ;;
    --runtime-home) RUNTIME_HOME="$2"; shift 2 ;;
    --repo-root) REPO_ROOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if ! command -v openclaw >/dev/null 2>&1; then
  echo "ERROR: openclaw CLI not found in PATH." >&2
  exit 1
fi

if [[ ! -x "$REPO_ROOT/openclaw/bin/run_scheduler.py" ]]; then
  echo "ERROR: Toprank repo root looks wrong: $REPO_ROOT" >&2
  exit 1
fi

if [[ ! "$WEEKLY_TIME" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  echo "ERROR: --weekly-time must be HH:MM, got $WEEKLY_TIME" >&2
  exit 1
fi

minute="${WEEKLY_TIME#*:}"
hour="${WEEKLY_TIME%:*}"
hour="$((10#$hour))"
minute="$((10#$minute))"

delivery_args=()
if [[ -n "$TO" ]]; then
  delivery_args=(--announce --channel "$CHANNEL" --to "$TO" --best-effort-deliver)
  [[ -n "$THREAD_ID" ]] && delivery_args+=(--thread-id "$THREAD_ID")
  [[ -n "$ACCOUNT" ]] && delivery_args+=(--account "$ACCOUNT")
else
  delivery_args=(--no-deliver)
fi

read_sites() {
  if [[ -n "$SITES_CSV" ]]; then
    tr ',' '\n' <<<"$SITES_CSV" | sed 's/^ *//;s/ *$//' | grep -v '^$'
    return 0
  fi
  python3 - "$RUNTIME_HOME/portfolio.json" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1]).expanduser()
if not path.exists():
    raise SystemExit(f"portfolio.json not found: {path}")
data = json.loads(path.read_text())
for site in data.get("sites", []):
    site_id = site.get("site_id")
    if site_id and site.get("status", "active") == "active" and site_id != "example.com":
        print(site_id)
PY
}

job_exists() {
  local name="$1"
  openclaw cron list --json 2>/dev/null | python3 -c 'import json, sys; name = sys.argv[1]; data = json.load(sys.stdin); raise SystemExit(0 if any(job.get("name") == name for job in data.get("jobs", [])) else 1)' "$name"
}

add_job_if_missing() {
  local name="$1"
  shift
  if job_exists "$name"; then
    echo "exists: $name"
    return 0
  fi
  openclaw cron add --name "$name" "$@"
}

scheduler_msg="Run the Toprank OpenClaw scheduler. Execute exactly: TOPRANK_OPENCLAW_HOME=\"$RUNTIME_HOME\" python3 \"$REPO_ROOT/openclaw/bin/run_scheduler.py\". Parse the JSON. If processed, manual_attention, and restored_from_queue are all empty, reply exactly NO_REPLY. If any are non-empty, summarize what changed and include any item_id/site_id that needs attention. If the command fails, report the blocker."

scheduler_args=(
  --every "$SCHEDULER_EVERY"
  --session isolated
  --light-context
  --message "$scheduler_msg"
  --tools exec
)
[[ -n "$MODEL" ]] && scheduler_args+=(--model "$MODEL")
scheduler_args+=("${delivery_args[@]}")

add_job_if_missing "Toprank OpenClaw Scheduler" "${scheduler_args[@]}"

sites=()
while IFS= read -r site; do
  sites+=("$site")
done < <(read_sites)
if [[ ${#sites[@]} -eq 0 ]]; then
  echo "No active sites found. Add sites with openclaw/bin/onboard_site.py, or pass --sites." >&2
  exit 1
fi

for i in "${!sites[@]}"; do
  site="${sites[$i]}"
  # Cron day-of-week: 1=Monday. Spread sites across weekdays, then wrap.
  dow=$(( (i % 5) + 1 ))
  cron_expr="$minute $hour * * $dow"
  weekly_msg="Run the automated Toprank weekly SEO review for $site. Execute exactly: TOPRANK_OPENCLAW_HOME=\"$RUNTIME_HOME\" python3 \"$REPO_ROOT/openclaw/bin/weekly_review.py\" \"$site\". Then inspect the generated run_dir from stdout. Summarize the top issue, proposed next action, whether it requires approval, and the artifact path. Do not edit websites, CMS, repos, or publish anything. If the command fails, report the blocker."

  weekly_args=(
    --cron "$cron_expr"
    --tz "$TIMEZONE"
    --exact
    --session isolated
    --light-context
    --message "$weekly_msg"
    --tools exec
  )
  [[ -n "$MODEL" ]] && weekly_args+=(--model "$MODEL")
  weekly_args+=("${delivery_args[@]}")

  add_job_if_missing "Toprank Weekly Review — $site" "${weekly_args[@]}"
done

echo
echo "Installed/verified Toprank OpenClaw cron jobs:"
openclaw cron list | grep -i 'Toprank' || true
