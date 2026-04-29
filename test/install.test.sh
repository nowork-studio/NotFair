#!/usr/bin/env bash
# test/install.test.sh — plugin structure validation tests
#
# Usage:
#   ./test/install.test.sh
#
# Validates that the toprank repo has the correct Claude Code plugin structure.

set -eo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

# ─── Helpers ─────────────────────────────────────────────────

pass() { echo "    PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "    FAIL  $1"; FAIL=$((FAIL + 1)); }

assert_file() {
  local path="$1" label="$2"
  [ -f "$path" ] && pass "$label" || fail "$label — expected file at $path"
}

assert_dir() {
  local path="$1" label="$2"
  [ -d "$path" ] && pass "$label" || fail "$label — expected directory at $path"
}

assert_json_field() {
  local path="$1" field="$2" label="$3"
  python3 -c "import json; d=json.load(open('$path')); assert '$field' in d" 2>/dev/null \
    && pass "$label" || fail "$label — field '$field' not in $path"
}

assert_contains() {
  local path="$1" needle="$2" label="$3"
  grep -q "$needle" "$path" 2>/dev/null && pass "$label" || fail "$label — '$needle' not in $path"
}

assert_not_contains() {
  local path="$1" needle="$2" label="$3"
  ! grep -q "$needle" "$path" 2>/dev/null && pass "$label" || fail "$label — '$needle' found in $path (should not be)"
}

# Skill paths relative to repo root (name:path pairs)
SKILL_ENTRIES=(
  "ads:google-ads/ads"
  "ads-audit:google-ads/ads-audit"
  "ads-copy:google-ads/ads-copy"
  "ads-landing:google-ads/ads-landing"
  "seo-analysis:seo/seo-analysis"
  "content-writer:seo/content-writer"
  "keyword-research:seo/keyword-research"
  "meta-tags-optimizer:seo/meta-tags-optimizer"
  "schema-markup-generator:seo/schema-markup-generator"
  "setup-cms:seo/setup-cms"
  "seo-page:seo/seo-page"
  "broken-link-checker:seo/broken-link-checker"
  "geo-optimizer:seo/geo-optimizer"
  "toprank-upgrade:toprank-upgrade-skill"
  "gemini:gemini"
)

skill_name() { echo "${1%%:*}"; }
skill_path() { echo "${1#*:}"; }

# ─── Test 1: Plugin metadata exists and is valid ─────────────

echo ""
echo "=== 1. Plugin metadata ==="

assert_file "$REPO_ROOT/.claude-plugin/plugin.json" "plugin.json exists"
assert_file "$REPO_ROOT/.claude-plugin/marketplace.json" "marketplace.json exists"
assert_file "$REPO_ROOT/.mcp.json" ".mcp.json exists"

assert_json_field "$REPO_ROOT/.claude-plugin/plugin.json" "name" "plugin.json has name"
assert_json_field "$REPO_ROOT/.claude-plugin/plugin.json" "version" "plugin.json has version"
assert_json_field "$REPO_ROOT/.claude-plugin/plugin.json" "skills" "plugin.json has skills"

assert_json_field "$REPO_ROOT/.claude-plugin/marketplace.json" "plugins" "marketplace.json has plugins"

# Plugin version matches VERSION file
PLUGIN_VERSION=$(python3 -c "import json; print(json.load(open('$REPO_ROOT/.claude-plugin/plugin.json'))['version'])")
FILE_VERSION=$(cat "$REPO_ROOT/VERSION" | tr -d '[:space:]')
[ "$PLUGIN_VERSION" = "$FILE_VERSION" ] \
  && pass "plugin.json version ($PLUGIN_VERSION) matches VERSION file" \
  || fail "version mismatch: plugin.json=$PLUGIN_VERSION, VERSION=$FILE_VERSION"

# marketplace.json versions must also match
MKT_META_VERSION=$(python3 -c "import json; print(json.load(open('$REPO_ROOT/.claude-plugin/marketplace.json'))['metadata']['version'])")
MKT_PLUGIN_VERSION=$(python3 -c "import json; print(json.load(open('$REPO_ROOT/.claude-plugin/marketplace.json'))['plugins'][0]['version'])")
[ "$MKT_META_VERSION" = "$FILE_VERSION" ] \
  && pass "marketplace.json metadata.version matches VERSION" \
  || fail "version mismatch: marketplace metadata=$MKT_META_VERSION, VERSION=$FILE_VERSION"
[ "$MKT_PLUGIN_VERSION" = "$FILE_VERSION" ] \
  && pass "marketplace.json plugins[0].version matches VERSION" \
  || fail "version mismatch: marketplace plugin=$MKT_PLUGIN_VERSION, VERSION=$FILE_VERSION"

# plugin.json skills array count matches actual skills
PLUGIN_SKILL_COUNT=$(python3 -c "import json; print(len(json.load(open('$REPO_ROOT/.claude-plugin/plugin.json'))['skills']))")
[ "$PLUGIN_SKILL_COUNT" -eq "${#SKILL_ENTRIES[@]}" ] \
  && pass "plugin.json skills count ($PLUGIN_SKILL_COUNT) matches expected (${#SKILL_ENTRIES[@]})" \
  || fail "plugin.json has $PLUGIN_SKILL_COUNT skills, expected ${#SKILL_ENTRIES[@]}"

# ─── Test 2: All skills exist with SKILL.md ──────────────────

echo ""
echo "=== 2. Skill directories ==="

for entry in "${SKILL_ENTRIES[@]}"; do
  skill=$(skill_name "$entry")
  path=$(skill_path "$entry")
  assert_dir "$REPO_ROOT/$path" "skill directory: $skill ($path)"
  assert_file "$REPO_ROOT/$path/SKILL.md" "SKILL.md exists: $skill"
done

# Guard: actual SKILL.md count must match
actual_skill_count=$(find "$REPO_ROOT/google-ads" "$REPO_ROOT/seo" "$REPO_ROOT/toprank-upgrade-skill" "$REPO_ROOT/gemini" -name "SKILL.md" | wc -l | tr -d ' ')
if [ "$actual_skill_count" -ne "${#SKILL_ENTRIES[@]}" ]; then
  fail "Expected ${#SKILL_ENTRIES[@]} SKILL.md files but found $actual_skill_count"
else
  pass "skill count matches ($actual_skill_count)"
fi

# ─── Test 3: Legacy structure removed, helper bin retained ─────────

echo ""
echo "=== 3. Legacy structure + helpers ==="

[ ! -f "$REPO_ROOT/setup" ] \
  && pass "setup script removed" \
  || fail "setup script still exists (should be deleted)"

assert_dir "$REPO_ROOT/bin" "bin/ helper directory exists"
assert_file "$REPO_ROOT/bin/toprank-config" "bin/toprank-config exists"
assert_file "$REPO_ROOT/bin/toprank-update-check" "bin/toprank-update-check exists"
assert_file "$REPO_ROOT/bin/toprank-change-watch" "bin/toprank-change-watch exists"

[ ! -d "$REPO_ROOT/skills" ] \
  && pass "skills/ flat directory removed" \
  || fail "skills/ directory still exists (skills should be in google-ads/, seo/, toprank-upgrade-skill/, gemini/)"

[ ! -d "$REPO_ROOT/.agents" ] \
  && pass ".agents/ directory removed" \
  || fail ".agents/ directory still exists (stale OpenAI agent configs)"

# ─── Test 4: Shared preambles exist ─────────────────────────

echo ""
echo "=== 4. Shared preambles ==="

assert_file "$REPO_ROOT/google-ads/shared/preamble.md" "Google Ads shared preamble exists"
assert_file "$REPO_ROOT/seo/shared/preamble.md" "SEO shared preamble exists"

# Ads skills reference the shared preamble (not inline MCP detection)
for skill in ads ads-audit ads-copy; do
  assert_contains "$REPO_ROOT/google-ads/$skill/SKILL.md" "../shared/preamble.md" \
    "$skill references shared preamble"
  assert_not_contains "$REPO_ROOT/google-ads/$skill/SKILL.md" "mcp__notfair__listConnectedAccounts" \
    "$skill does not inline MCP detection (notfair prefix)"
  assert_not_contains "$REPO_ROOT/google-ads/$skill/SKILL.md" "mcp__adsagent__listConnectedAccounts" \
    "$skill does not inline MCP detection (legacy adsagent prefix)"
done

# SEO skills that need GSC reference the shared preamble
for skill in seo-analysis setup-cms; do
  assert_contains "$REPO_ROOT/seo/$skill/SKILL.md" "../shared/preamble.md" \
    "$skill references shared preamble"
done

# ─── Test 5: MCP server configuration ───────────────────────

echo ""
echo "=== 5. MCP server config ==="

assert_contains "$REPO_ROOT/.mcp.json" "\"notfair\"" ".mcp.json registers the notfair server (tool prefix mcp__notfair__*)"
assert_contains "$REPO_ROOT/.mcp.json" "\"type\": \"http\"" ".mcp.json uses native HTTP transport (no mcp-remote bridge)"
assert_contains "$REPO_ROOT/.mcp.json" "notfair.co/api/mcp" ".mcp.json points at NotFair MCP endpoint"

# ─── Test 6: Connectors section in README ─────────────────────

echo ""
echo "=== 6. Connectors ==="

assert_contains "$REPO_ROOT/README.md" "~~google-ads" "README.md has Google Ads connector placeholder"
assert_contains "$REPO_ROOT/README.md" "~~search-console" "README.md has Search Console connector placeholder"

# ─── Test 7: Reference docs exist ───────────────────────────

echo ""
echo "=== 7. Reference documents ==="

assert_dir "$REPO_ROOT/google-ads/ads/references" "ads references directory"
assert_dir "$REPO_ROOT/google-ads/ads-audit/references" "ads-audit references directory"
assert_dir "$REPO_ROOT/google-ads/ads-copy/references" "ads-copy references directory"
assert_dir "$REPO_ROOT/seo/seo-analysis/references" "seo-analysis references directory"

# ─── Test 8: Eval files exist for all skills ─────────────────

echo ""
echo "=== 8. Eval files ==="

for entry in "${SKILL_ENTRIES[@]}"; do
  skill=$(skill_name "$entry")
  path=$(skill_path "$entry")
  assert_file "$REPO_ROOT/$path/evals/evals.json" "$skill evals exist"
done

# ─── Test 9: Frontmatter has argument-hint ───────────────────

echo ""
echo "=== 9. Argument hints ==="

for entry in "${SKILL_ENTRIES[@]}"; do
  skill=$(skill_name "$entry")
  path=$(skill_path "$entry")
  assert_contains "$REPO_ROOT/$path/SKILL.md" "argument-hint" \
    "$skill has argument-hint in frontmatter"
done

# ─── Results ──────────────────────────────────────────────────

echo ""
echo "─────────────────────────────"
echo "  $PASS passed  |  $FAIL failed"
echo "─────────────────────────────"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
