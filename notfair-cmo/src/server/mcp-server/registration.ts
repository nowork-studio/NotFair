import { requireAdapter } from "@/server/adapters/registry";
import { getProject, listProjects } from "@/server/db/projects";
import { listProjectAgents } from "@/server/agent-meta";
import { mcpSpecByKey } from "@/server/mcp-catalog";
import { findMcpToken } from "@/server/mcp/tokens";
import { getOrCreateMcpServerSecret } from "./secret";
import type { HarnessAdapterId } from "@/server/adapters/types";

/**
 * Register notfair-cmo's outbound MCP server (`notfair-orchestration`) with
 * the project's harness adapter for a specific agent.
 *
 * In v0.1.0 we registered once globally with OpenClaw's mcp config. The
 * harness-adapter model writes MCP wiring into whichever config file the
 * chosen harness expects (Claude Code's `.mcp.json`, Codex's
 * `~/.codex/config.toml`), so registration is per-agent now.
 *
 * URL: `NOTFAIR_CMO_MCP_URL` if set, else
 * `http://127.0.0.1:${NOTFAIR_CMO_PORT||3326}/api/mcp/orchestration`.
 */

export const ORCHESTRATION_MCP_KEY = "notfair-orchestration";
export const BROWSER_MCP_KEY = "notfair-browser";

function notfairOriginPort(): string {
  return process.env.NOTFAIR_CMO_PORT?.trim() || "3326";
}

function defaultMcpUrl(): string {
  if (process.env.NOTFAIR_CMO_MCP_URL?.trim()) {
    return process.env.NOTFAIR_CMO_MCP_URL.trim();
  }
  return `http://127.0.0.1:${notfairOriginPort()}/api/mcp/orchestration`;
}

function defaultBrowserMcpUrl(): string {
  if (process.env.NOTFAIR_CMO_BROWSER_MCP_URL?.trim()) {
    return process.env.NOTFAIR_CMO_BROWSER_MCP_URL.trim();
  }
  return `http://127.0.0.1:${notfairOriginPort()}/api/mcp/browser`;
}

/**
 * One-shot per-process cleanup of legacy per-agent + dead-project rows in
 * `~/.codex/config.toml`. Per-project namespacing landed in 0.4.x; older
 * installs still have `[mcp_servers.notfair_<agentId>__...]` headers from
 * before the switch, which keep showing up when an agent introspects its
 * tools. Strip them once on the first registration we run after start.
 *
 * Claude Code's per-workspace `.mcp.json` doesn't have this problem, so
 * the prune is no-op for that adapter.
 */
let codexPruneRan = false;
async function maybePruneCodexOrphans(adapterId: HarnessAdapterId): Promise<void> {
  if (adapterId !== "codex-local" || codexPruneRan) return;
  codexPruneRan = true;
  try {
    const { pruneOrphanCodexNamespaces } = await import(
      "@/server/adapters/codex-local/mcp"
    );
    const slugs = new Set(
      listProjects({ includeArchived: true }).map((p) => p.slug),
    );
    const removed = await pruneOrphanCodexNamespaces(slugs);
    if (removed > 0) {
      console.info(
        `[mcp] pruned ${removed} orphan notfair_* section(s) from ~/.codex/config.toml`,
      );
    }
  } catch (err) {
    // Best-effort. A broken prune must not block actual registration.
    console.warn("[mcp] codex orphan prune failed:", err);
  }
}

export type InstallResult =
  | { ok: true; key: string; url: string }
  | { ok: false; key: string; url: string; error: string };

export async function registerOrchestrationForAgent(
  project_slug: string,
  agent_id: string,
): Promise<InstallResult> {
  return registerInternalMcpForAgent({
    project_slug,
    agent_id,
    key: ORCHESTRATION_MCP_KEY,
    url: defaultMcpUrl(),
  });
}

/**
 * Register the standalone browser MCP (notfair-browser) for an agent.
 * Same shared-secret auth + same harness adapter glue as orchestration;
 * separate URL + server name so agents see the surface as its own thing.
 */
export async function registerBrowserMcpForAgent(
  project_slug: string,
  agent_id: string,
): Promise<InstallResult> {
  return registerInternalMcpForAgent({
    project_slug,
    agent_id,
    key: BROWSER_MCP_KEY,
    url: defaultBrowserMcpUrl(),
  });
}

async function registerInternalMcpForAgent(args: {
  project_slug: string;
  agent_id: string;
  key: string;
  url: string;
}): Promise<InstallResult> {
  const { project_slug, agent_id, key, url } = args;
  const project = getProject(project_slug);
  if (!project) {
    return { ok: false, key, url, error: `Unknown project ${project_slug}` };
  }
  try {
    const adapter = requireAdapter(project.harness_adapter);
    await maybePruneCodexOrphans(adapter.id);
    await adapter.registerMcp({
      serverName: key,
      agentId: agent_id,
      projectSlug: project_slug,
      transport: {
        type: "http",
        url,
        headers: { Authorization: `Bearer ${getOrCreateMcpServerSecret()}` },
      },
    });
    return { ok: true, key, url };
  } catch (err) {
    return {
      ok: false,
      key,
      url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Register an external catalog MCP server (Google Ads, GSC, etc.) with the
 * project's harness adapter for a specific agent. Pulls the OAuth bearer
 * from the `mcp_tokens` table and the resource URL from the catalog spec.
 *
 * Called after a successful OAuth callback so the bearer becomes visible
 * to running agents without the user manually re-provisioning. Idempotent:
 * the adapter `registerMcp` overwrites the prior entry on rewrite.
 */
export async function registerCatalogMcpForAgent(
  project_slug: string,
  catalog_key: string,
  agent_id: string,
): Promise<InstallResult> {
  const spec = mcpSpecByKey(project_slug, catalog_key);
  if (!spec) {
    return {
      ok: false,
      key: catalog_key,
      url: "",
      error: `Unknown catalog key ${catalog_key}`,
    };
  }
  const project = getProject(project_slug);
  if (!project) {
    return {
      ok: false,
      key: catalog_key,
      url: spec.resource_url,
      error: `Unknown project ${project_slug}`,
    };
  }
  const token = findMcpToken(project_slug, catalog_key);
  if (!token) {
    return {
      ok: false,
      key: catalog_key,
      url: spec.resource_url,
      error: `No token stored for ${catalog_key} in project ${project_slug}`,
    };
  }
  try {
    const adapter = requireAdapter(project.harness_adapter);
    await maybePruneCodexOrphans(adapter.id);
    await adapter.registerMcp({
      serverName: catalog_key,
      agentId: agent_id,
      projectSlug: project_slug,
      transport: {
        type: "http",
        url: spec.resource_url,
        headers: { Authorization: `Bearer ${token.access_token_enc}` },
      },
    });
    return { ok: true, key: catalog_key, url: spec.resource_url };
  } catch (err) {
    return {
      ok: false,
      key: catalog_key,
      url: spec.resource_url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Convenience: register an external catalog MCP with EVERY agent in the
 * project. Called from the OAuth callback so a fresh token reaches all
 * project agents without re-provisioning. Best-effort per agent — one
 * failed registration doesn't abort the rest.
 */
export async function registerCatalogMcpForProject(
  project_slug: string,
  catalog_key: string,
): Promise<InstallResult[]> {
  const agents = await listProjectAgents(project_slug);
  const results: InstallResult[] = [];
  for (const agent of agents) {
    results.push(
      await registerCatalogMcpForAgent(project_slug, catalog_key, agent.agent_id),
    );
  }
  return results;
}

/**
 * No-op shim. The v0.1.0 cleanup removed leaked per-project rows from
 * OpenClaw's global mcp config; the new model has no such global registry.
 */
export async function cleanupLegacyOrchestrationRows(_slugs: string[]): Promise<void> {
  // intentionally empty
}

/**
 * Legacy global install. Kept as a no-op so older callers (CLI reinstall
 * command) don't break — orchestration MCP wiring is now per-agent and
 * happens at provision time via `registerOrchestrationForAgent`.
 */
export async function ensureOrchestrationMcpInstalled(): Promise<InstallResult> {
  return { ok: true, key: ORCHESTRATION_MCP_KEY, url: defaultMcpUrl() };
}
