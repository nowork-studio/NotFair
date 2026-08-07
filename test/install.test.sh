#!/usr/bin/env bash
# test/install.test.sh — plugin structure validation tests
#
# Usage:
#   ./test/install.test.sh
#
# Validates that the notfair repo has the correct Claude Code plugin structure.

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

# Skill paths relative to repo root (name:path pairs). Names mirror the
# SKILL.md frontmatter `name:` field, which becomes the slash command tail
# after the `notfair:` plugin prefix (e.g. `name: upgrade` → `/notfair:upgrade`).
SKILL_ENTRIES=(
  "paid-ads:paid-ads/paid-ads"
  "paid-ads-guide:paid-ads/paid-ads-guide"
  "paid-ads-setup:paid-ads/paid-ads-setup"
  "paid-ads-integrations:paid-ads/paid-ads-integrations"
  "paid-ads-launch:paid-ads/paid-ads-launch"
  "paid-ads-review:paid-ads/paid-ads-review"
  "paid-ads-optimize:paid-ads/paid-ads-optimize"
  "paid-ads-creative:paid-ads/paid-ads-creative"
  "paid-ads-linkedin:paid-ads/paid-ads-linkedin"
  "paid-ads-tiktok:paid-ads/paid-ads-tiktok"
  "paid-ads-amazon:paid-ads/paid-ads-amazon"
  "paid-ads-chatgpt:paid-ads/paid-ads-chatgpt"
  "google-ads:google-ads/manage"
  "google-ads-audit:google-ads/audit"
  "google-ads-copy:google-ads/copy"
  "google-ads-assets:google-ads/assets"
  "google-ads-landing:google-ads/landing"
  "meta-ads:meta-ads/manage"
  "meta-ads-audit:meta-ads/audit"
  "meta-ads-creative:meta-ads/creative"
  "seo-analysis:seo/seo-analysis"
  "content-writer:seo/content-writer"
  "content-planner:seo/content-planner"
  "keyword-research:seo/keyword-research"
  "meta-tags-optimizer:seo/meta-tags-optimizer"
  "schema-markup-generator:seo/schema-markup-generator"
  "setup-cms:seo/setup-cms"
  "seo-page:seo/seo-page"
  "broken-link-checker:seo/broken-link-checker"
  "geo-optimizer:seo/geo-optimizer"
  "local-seo:seo/local-seo"
  "hreflang-international:seo/hreflang-international"
  "sitemap-audit:seo/sitemap-audit"
  "image-seo:seo/image-seo"
  "ecommerce-seo:seo/ecommerce-seo"
  "programmatic-seo:seo/programmatic-seo"
  "competitor-pages:seo/competitor-pages"
  "sxo:seo/sxo"
  "seo-drift:seo/seo-drift"
  "backlink-audit:seo/backlink-audit"
  "upgrade:notfair-upgrade-skill"
  "gemini:gemini"
)

skill_name() { echo "${1%%:*}"; }
skill_path() { echo "${1#*:}"; }

# Eval fixtures are an explicit quality layer, not a requirement of the plugin
# manifest. Some established skills predate the fixture convention. Keep this
# list intentional so the installer test validates every registered skill while
# still requiring fixtures for skills that ship them.
EVAL_SKILL_ENTRIES=(
  "google-ads:google-ads/manage"
  "google-ads-audit:google-ads/audit"
  "google-ads-copy:google-ads/copy"
  "google-ads-assets:google-ads/assets"
  "google-ads-landing:google-ads/landing"
  "meta-ads-creative:meta-ads/creative"
  "seo-analysis:seo/seo-analysis"
  "content-writer:seo/content-writer"
  "content-planner:seo/content-planner"
  "keyword-research:seo/keyword-research"
  "meta-tags-optimizer:seo/meta-tags-optimizer"
  "schema-markup-generator:seo/schema-markup-generator"
  "setup-cms:seo/setup-cms"
  "seo-page:seo/seo-page"
  "broken-link-checker:seo/broken-link-checker"
  "geo-optimizer:seo/geo-optimizer"
  "upgrade:notfair-upgrade-skill"
  "gemini:gemini"
)

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

# Plugin name in plugin.json must be 'notfair' (post-0.24.0 rename)
PLUGIN_NAME=$(python3 -c "import json; print(json.load(open('$REPO_ROOT/.claude-plugin/plugin.json'))['name'])")
[ "$PLUGIN_NAME" = "notfair" ] \
  && pass "plugin.json name is 'notfair'" \
  || fail "plugin.json name is '$PLUGIN_NAME', expected 'notfair'"

# marketplace.json plugin entry name must also be 'notfair'
MKT_PLUGIN_NAME=$(python3 -c "import json; print(json.load(open('$REPO_ROOT/.claude-plugin/marketplace.json'))['plugins'][0]['name'])")
[ "$MKT_PLUGIN_NAME" = "notfair" ] \
  && pass "marketplace.json plugins[0].name is 'notfair'" \
  || fail "marketplace.json plugins[0].name is '$MKT_PLUGIN_NAME', expected 'notfair'"

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
actual_skill_count=$(find "$REPO_ROOT/paid-ads" "$REPO_ROOT/google-ads" "$REPO_ROOT/seo" "$REPO_ROOT/meta-ads" "$REPO_ROOT/notfair-upgrade-skill" "$REPO_ROOT/gemini" -name "SKILL.md" | wc -l | tr -d ' ')
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
assert_file "$REPO_ROOT/bin/notfair-config" "bin/notfair-config exists"
assert_file "$REPO_ROOT/bin/notfair-update-check" "bin/notfair-update-check exists"
assert_file "$REPO_ROOT/bin/notfair-change-watch" "bin/notfair-change-watch exists"

# Old toprank-* bin names must not coexist (0.24.0 rename should be clean)
[ ! -f "$REPO_ROOT/bin/toprank-config" ] \
  && pass "legacy bin/toprank-config removed" \
  || fail "bin/toprank-config still exists (should have been git-mv'd to notfair-config)"

# Old toprank-upgrade-skill/ directory must not coexist
[ ! -d "$REPO_ROOT/toprank-upgrade-skill" ] \
  && pass "legacy toprank-upgrade-skill/ removed" \
  || fail "toprank-upgrade-skill/ still exists (should have been git-mv'd to notfair-upgrade-skill/)"

[ ! -d "$REPO_ROOT/skills" ] \
  && pass "skills/ flat directory removed" \
  || fail "skills/ directory still exists (skills should be in google-ads/, seo/, meta-ads/, notfair-upgrade-skill/, gemini/)"

[ ! -d "$REPO_ROOT/.agents" ] \
  && pass ".agents/ directory removed" \
  || fail ".agents/ directory still exists (stale OpenAI agent configs)"

# ─── Test 4: Shared preambles exist ─────────────────────────

echo ""
echo "=== 4. Shared preambles ==="

assert_file "$REPO_ROOT/google-ads/shared/preamble.md" "Google Ads shared preamble exists"
assert_file "$REPO_ROOT/meta-ads/shared/preamble.md" "Meta Ads shared preamble exists"
assert_file "$REPO_ROOT/seo/shared/preamble.md" "SEO shared preamble exists"

# Ads skills reference the shared preamble (not inline MCP detection)
for skill in manage audit copy assets; do
  assert_contains "$REPO_ROOT/google-ads/$skill/SKILL.md" "../shared/preamble.md" \
    "google-ads/$skill references shared preamble"
  assert_not_contains "$REPO_ROOT/google-ads/$skill/SKILL.md" "mcp__notfair__listConnectedAccounts" \
    "google-ads/$skill does not inline MCP detection (notfair prefix)"
done

assert_contains "$REPO_ROOT/meta-ads/creative/SKILL.md" "../shared/preamble.md" \
  "meta-ads/creative references shared preamble"

# SEO skills that need GSC reference the shared preamble
for skill in seo-analysis setup-cms; do
  assert_contains "$REPO_ROOT/seo/$skill/SKILL.md" "../shared/preamble.md" \
    "$skill references shared preamble"
done

# ─── Test 5: MCP server configuration ───────────────────────

echo ""
echo "=== 5. MCP server config ==="

assert_contains "$REPO_ROOT/.mcp.json" "\"NotFair-GoogleAds\"" ".mcp.json registers the NotFair-GoogleAds server"
assert_contains "$REPO_ROOT/.mcp.json" "\"type\": \"http\"" ".mcp.json uses native HTTP transport (no mcp-remote bridge)"
assert_contains "$REPO_ROOT/.mcp.json" "notfair.co/api/mcp/google_ads" ".mcp.json points at NotFair-GoogleAds MCP endpoint"

# ─── Test 6: Connectors section in README ─────────────────────

echo ""
echo "=== 6. Connectors ==="

assert_contains "$REPO_ROOT/README.md" "~~google-ads" "README.md has Google Ads connector placeholder"
assert_contains "$REPO_ROOT/README.md" "~~search-console" "README.md has Search Console connector placeholder"

# ─── Test 7: Reference docs exist ───────────────────────────

echo ""
echo "=== 7. Reference documents ==="

assert_dir "$REPO_ROOT/google-ads/manage/references" "google-ads references directory"
assert_dir "$REPO_ROOT/google-ads/audit/references" "google-ads-audit references directory"
assert_dir "$REPO_ROOT/google-ads/copy/references" "google-ads-copy references directory"
assert_dir "$REPO_ROOT/seo/seo-analysis/references" "seo-analysis references directory"

# ─── Test 8: Eval fixtures exist where shipped ───────────────

echo ""
echo "=== 8. Eval files ==="

for entry in "${EVAL_SKILL_ENTRIES[@]}"; do
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
