"""End-to-end contract tests for the live NotFair MCP-backed skills.

Local registration checks run in the normal suite. Set LIVE_MCP_E2E=1 to also
verify the production endpoint -> 401 challenge -> OAuth resource metadata
round trip without using or exposing an account credential.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest


ROOT = Path(__file__).parent.parent

UNIVERSAL_SERVER = "NotFair"
UNIVERSAL_ENDPOINT = "https://notfair.co/api/mcp/notfair_ads"

PLATFORM_SKILLS = {
    "paid-ads/paid-ads-x": ("~~x-ads", "x_ads_"),
    "paid-ads/paid-ads-linkedin": ("~~linkedin-ads", "linkedin_ads_"),
    "analytics/search-console": ("~~search-console", "search_console_"),
    "analytics/google-analytics": ("~~google-analytics", "google_analytics_"),
}

UNIVERSAL_PREFLIGHTS = {
    "google-ads/shared/preamble.md": "google_ads_listConnectedAccounts",
    "meta-ads/shared/preamble.md": "meta_ads_listAdAccounts",
}


def test_universal_mcp_is_the_only_registered_server_and_skills_use_platform_prefixes():
    config = json.loads((ROOT / ".mcp.json").read_text())
    plugin = json.loads((ROOT / ".claude-plugin/plugin.json").read_text())
    codex_plugin = json.loads((ROOT / ".codex-plugin/plugin.json").read_text())
    servers = config["mcpServers"]

    assert servers == {
        UNIVERSAL_SERVER: {"type": "http", "url": UNIVERSAL_ENDPOINT}
    }
    assert codex_plugin["name"] == "notfair"
    assert codex_plugin["skills"] == "./skills/"
    assert codex_plugin["mcpServers"] == "./.mcp.json"
    assert codex_plugin["version"] == plugin["version"]

    codex_wrappers = {path.name: path for path in (ROOT / "skills").iterdir()}
    assert len(codex_wrappers) == len(plugin["skills"])
    for skill in plugin["skills"]:
        canonical = (ROOT / skill).resolve()
        canonical_text = (canonical / "SKILL.md").read_text()
        skill_name = re.search(r"^name:\s*(.+)$", canonical_text, re.MULTILINE)
        assert skill_name, skill
        wrapper = codex_wrappers[skill_name.group(1).strip()]
        assert wrapper.is_dir() and not wrapper.is_symlink()
        wrapper_text = (wrapper / "SKILL.md").read_text()
        assert wrapper_text.split("---\n", 2)[1] == canonical_text.split("---\n", 2)[1]
        canonical_rel = canonical.relative_to(ROOT).as_posix()
        assert f"../../{canonical_rel}/SKILL.md" in wrapper_text

    for skill, (placeholder, platform_prefix) in PLATFORM_SKILLS.items():
        skill_path = ROOT / skill / "SKILL.md"
        assert skill_path.is_file()
        skill_text = skill_path.read_text()
        assert placeholder in skill_text
        assert platform_prefix in skill_text
        assert f"./{skill}" in plugin["skills"]

    for preamble, gated_account_tool in UNIVERSAL_PREFLIGHTS.items():
        preamble_text = (ROOT / preamble).read_text()
        preflight = "call `listConnectedPlatforms` **before**"
        disconnected_stop = f"do not call `{gated_account_tool}`"
        assert preflight in preamble_text
        assert disconnected_stop in preamble_text
        assert preamble_text.index(preflight) < preamble_text.index(disconnected_stop)


@pytest.mark.skipif(
    os.environ.get("LIVE_MCP_E2E") != "1",
    reason="Set LIVE_MCP_E2E=1 to verify production OAuth discovery",
)
def test_live_mcp_oauth_discovery_round_trip():
    endpoint = UNIVERSAL_ENDPOINT
    request = urllib.request.Request(
        endpoint,
        headers={"Accept": "application/json, text/event-stream"},
    )

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(request, timeout=20)

    response = exc_info.value
    assert response.code == 401
    challenge = response.headers["WWW-Authenticate"]
    match = re.search(r'resource_metadata="([^"]+)"', challenge or "")
    assert match, challenge

    body = json.loads(response.read())
    metadata_url = match.group(1)
    assert body["oauth"]["resource_metadata"] == metadata_url
    assert body["oauth"]["authorization_code_pkce"] is True

    with urllib.request.urlopen(metadata_url, timeout=20) as metadata_response:
        metadata = json.load(metadata_response)

    assert metadata["resource"] == endpoint
    assert metadata["authorization_servers"] == ["https://notfair.co"]
    assert metadata["resource_name"].startswith("NotFair ")

    authorization_server = metadata["authorization_servers"][0]
    authorization_metadata_url = (
        f"{authorization_server}/.well-known/oauth-authorization-server"
    )
    with urllib.request.urlopen(authorization_metadata_url, timeout=20) as response:
        authorization_metadata = json.load(response)

    assert authorization_metadata["issuer"] == authorization_server
    assert urllib.parse.urlparse(endpoint).netloc == urllib.parse.urlparse(
        authorization_metadata["issuer"]
    ).netloc
