#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
SKILL_TARGET_DIR="${OPENCLAW_SKILLS_DIR:-$OPENCLAW_HOME/skills}"

link_or_warn() {
  local src="$1"
  local dest="$2"
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    echo "warning: $dest exists and is not a symlink; leaving it unchanged" >&2
    return 0
  fi
  ln -sfn "$src" "$dest"
}

mkdir -p "$SKILL_TARGET_DIR"
python3 "$REPO_ROOT/openclaw/bin/bootstrap_workspace.py" >/dev/null

for skill_dir in "$REPO_ROOT"/openclaw/skills/*; do
  name="$(basename "$skill_dir")"
  target="$SKILL_TARGET_DIR/$name"
  rm -rf "$target"
  mkdir -p "$target"
  cp -R "$skill_dir"/. "$target"/
  echo "copied $name -> $target"
done

# OpenClaw skill discovery rejects symlinks that escape ~/.openclaw/skills.
# The wrapper skills are copied above, then their repo-relative support paths are
# preserved with stable links for `{baseDir}/../../shared`, `{baseDir}/../../bin`,
# and `{baseDir}/../../../seo`.
link_or_warn "$REPO_ROOT/openclaw/shared" "$OPENCLAW_HOME/shared"
link_or_warn "$REPO_ROOT/openclaw/bin" "$OPENCLAW_HOME/bin"
link_or_warn "$REPO_ROOT/seo" "$HOME/seo"

echo
echo "OpenClaw skills installed."
echo "Runtime home: ${TOPRANK_OPENCLAW_HOME:-$HOME/.toprank/openclaw}"
echo "Skills dir: $SKILL_TARGET_DIR"
