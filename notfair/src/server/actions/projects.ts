"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  archiveProject,
  changeProjectSlug,
  createProject,
  deleteProjectRow,
  getProject,
  renameProject,
} from "@/server/db/projects";
import { slugify } from "@/lib/slug";
import {
  clearActiveProject,
  setActiveProject,
} from "@/server/active-project";
import { listProjectAgents, readAgentMeta } from "@/server/agent-meta";
import { relocateAgent } from "@/server/actions/agents";
import {
  cascadeDeleteProjectArtifacts,
  getProjectDeletionSummary,
  type ProjectDeletionSummary,
} from "@/server/agents/cascade-delete";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Throws on validation failure so form action signature is `(formData) => Promise<void>`.
// Pages can render `error.tsx` for fallback; for inline UI feedback, wire `useActionState`
// in a client wrapper later if needed.
export async function createProjectAction(formData: FormData): Promise<void> {
  const display_name = String(formData.get("display_name") ?? "").trim();
  if (!display_name) throw new Error("Please enter a workspace name.");

  const result = createProject({ display_name });
  if (!result.ok) throw new Error(result.reason);

  await setActiveProject(result.project.slug);
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Onboarding-flow variant of createProjectAction. Same create + async
 * provision (D6) but returns the slug to the caller instead of redirecting
 * to /. The client navigates to ?step=connect&slug=... after success.
 */
export async function createProjectForOnboardingAction(
  formData: FormData,
): Promise<ActionResult<{ slug: string; display_name: string }>> {
  const display_name = String(formData.get("display_name") ?? "").trim();
  if (!display_name) return { ok: false, error: "Please enter a workspace name." };

  const website_url = String(formData.get("website_url") ?? "").trim() || null;
  const codebase_path = String(formData.get("codebase_path") ?? "").trim() || null;
  const harness_raw = String(formData.get("harness_adapter") ?? "").trim();
  const { isHarnessAdapterId, DEFAULT_HARNESS_ADAPTER } = await import(
    "@/server/adapters/registry"
  );
  const harness_adapter = isHarnessAdapterId(harness_raw)
    ? harness_raw
    : DEFAULT_HARNESS_ADAPTER;

  const result = createProject({
    display_name,
    website_url,
    codebase_path,
    harness_adapter,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  await setActiveProject(result.project.slug);
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: {
      slug: result.project.slug,
      display_name: result.project.display_name,
    },
  };
}

export async function switchProjectAction(slug: string): Promise<ActionResult> {
  await setActiveProject(slug);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function archiveProjectAction(
  slug: string,
): Promise<ActionResult> {
  const project = archiveProject(slug);
  if (!project) return { ok: false, error: "Project not found." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function renameProjectAction(slug: string, display_name: string): Promise<ActionResult> {
  const updated = renameProject(slug, display_name);
  if (!updated) return { ok: false, error: "Project not found or name invalid." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export type RenameProjectFullInput = {
  current_slug: string;
  new_display_name: string;
};

export type RenameProjectFullData = {
  slug: string;
  display_name: string;
  /** True when the slug actually changed (a full cascade ran). */
  full_rename: boolean;
  /** Per-agent outcomes for the rename pass. */
  agents_relocated: string[];
  agents_failed: Array<{ agent_id: string; error: string }>;
};

/**
 * Rename a project — display name and (when the slugified name differs) URL
 * slug too. Display-name-only changes hit just the DB. Slug changes cascade:
 * relocate every agent in the project to the new slug (re-uses
 * `relocateAgent`, which itself is the shared helper that powers per-agent
 * rename), then migrate every DB row keyed off project_slug.
 *
 * After a full rename: agent_ids change from `<old>-<slug>` to `<new>-<slug>`,
 * workspace dirs move, session rows
 * relocate, and the active-project cookie repoints at the new slug.
 */
export async function renameProjectFullAction(
  input: RenameProjectFullInput,
): Promise<ActionResult<RenameProjectFullData>> {
  const current = getProject(input.current_slug);
  if (!current) return { ok: false, error: `Project '${input.current_slug}' not found.` };

  const newName = input.new_display_name.trim();
  if (!newName) return { ok: false, error: "Name cannot be empty." };

  const newSlugResult = slugify(newName);
  if (!newSlugResult.ok) {
    return { ok: false, error: `Invalid name: ${newSlugResult.reason}` };
  }
  const newSlug = newSlugResult.slug;
  const sameSlug = newSlug === current.slug;

  // Display-name-only change — cheap path.
  if (sameSlug) {
    if (newName === current.display_name) {
      return {
        ok: true,
        data: {
          slug: current.slug,
          display_name: current.display_name,
          full_rename: false,
          agents_relocated: [],
          agents_failed: [],
        },
      };
    }
    renameProject(current.slug, newName);
    revalidatePath("/", "layout");
    return {
      ok: true,
      data: {
        slug: current.slug,
        display_name: newName,
        full_rename: false,
        agents_relocated: [],
        agents_failed: [],
      },
    };
  }

  if (getProject(newSlug)) {
    return { ok: false, error: `A project with slug '${newSlug}' already exists.` };
  }

  // 1) Relocate every agent into the new project slug (keeping each agent's
  //    own slug + display name + clone provenance intact).
  const agents = await listProjectAgents(current.slug);
  const agentsRelocated: string[] = [];
  const agentsFailed: Array<{ agent_id: string; error: string }> = [];
  for (const a of agents) {
    try {
      const meta = readAgentMeta(a.agent_id);
      await relocateAgent({
        old_agent_id: a.agent_id,
        source_project_slug: current.slug,
        new_project_slug: newSlug,
        new_slug: a.slug,
        new_display_name: a.name,
        preserve_source_agent_id: meta?.source_agent_id,
        preserve_created_at: meta?.created_at,
      });
      agentsRelocated.push(a.agent_id);
    } catch (err) {
      agentsFailed.push({
        agent_id: a.agent_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2) Migrate DB rows. If a child-table update fails the rename is partial;
  //    surface a clear error but leave the moved agents in place (they're
  //    addressable under the new slug already).
  try {
    changeProjectSlug(current.slug, newSlug, newName);
  } catch (err) {
    return {
      ok: false,
      error: `DB migration failed after agent move: ${
        err instanceof Error ? err.message : String(err)
      }. Agents already moved; cleanup needed.`,
    };
  }

  // 2.5) Move the canonical PROJECT.md directory from old slug → new slug
  //      so the brief survives the rename. The per-agent sidecar copies
  //      get rewritten on the next identity sync; the canonical file is
  //      the source of truth they read from, so moving this is what
  //      matters.
  try {
    const { renameProjectBriefDir } = await import(
      "@/server/onboarding/project-brief"
    );
    await renameProjectBriefDir(current.slug, newSlug);
  } catch (err) {
    console.warn(
      `[rename-project] failed to move PROJECT.md dir from ${current.slug} to ${newSlug}:`,
      err,
    );
  }

  // 3) Repoint the active-project cookie if it was this one.
  const c = await cookies();
  if (c.get("notfair_active_project")?.value === current.slug) {
    await setActiveProject(newSlug);
  }

  revalidatePath("/", "layout");

  return {
    ok: true,
    data: {
      slug: newSlug,
      display_name: newName,
      full_rename: true,
      agents_relocated: agentsRelocated,
      agents_failed: agentsFailed,
    },
  };
}

export async function getProjectDeletionSummaryAction(
  slug: string,
): Promise<ActionResult<ProjectDeletionSummary>> {
  const project = getProject(slug);
  if (!project) return { ok: false, error: `Project '${slug}' not found.` };
  try {
    const summary = await getProjectDeletionSummary(slug);
    return { ok: true, data: summary };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type DeleteProjectData = {
  agents: string[];
  agentsFailed: Array<{ agentId: string; error: string }>;
  mcps: number;
  mcpsFailed: number;
};

export async function deleteProjectAction(
  slug: string,
  confirmedSlug: string,
): Promise<ActionResult<DeleteProjectData>> {
  if (slug !== confirmedSlug) {
    return { ok: false, error: "Confirmation slug does not match." };
  }
  const project = getProject(slug);
  if (!project) return { ok: false, error: `Project '${slug}' not found.` };

  const projectAgentEntries = await listProjectAgents(slug);
  const deletedAgents: string[] = projectAgentEntries.map((a) => a.agent_id);
  const agentsFailed: Array<{ agentId: string; error: string }> = [];
  // MCP token rows are wiped by the cascade below; count upfront for the
  // result summary.
  const { listProjectMcpTokens } = await import("@/server/mcp/tokens");
  const mcpsRevoked = listProjectMcpTokens(slug).length;
  const mcpsFailed = 0;


  // Single shot — drops every artifact tied to this project: agent workspace
  // dirs, scheduled_jobs + runs, sessions + transcripts, mcp_tokens. Adapter
  // MCP entries get unregistered too.
  try {
    await cascadeDeleteProjectArtifacts(slug);
  } catch (err) {
    console.error("[delete-project] cascade failed:", err);
    agentsFailed.push({
      agentId: "(project)",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 5) Canonical PROJECT.md directory at ~/.notfair/projects/<slug>/.
  //    The per-agent sidecar copies inside each workspace were already wiped
  //    by cascadeDeleteAgent's `rm -rf` on the workspace dir; this is the
  //    last surface that holds the project brief on disk. Without this,
  //    recreating a project with the same slug later would silently inherit
  //    the prior tenant's PROJECT.md (writeIdentityFile inlines it if it
  //    exists). Best-effort — a missing dir is a no-op.
  try {
    const { deleteProjectBriefDir } = await import(
      "@/server/onboarding/project-brief"
    );
    await deleteProjectBriefDir(slug);
  } catch (err) {
    console.warn(
      `[delete-project] failed to remove PROJECT.md dir for ${slug}:`,
      err,
    );
  }

  // 6) Local DB rows.
  deleteProjectRow(slug);

  // 7) Clear active-project cookie if it pointed at this one.
  const c = await cookies();
  if (c.get("notfair_active_project")?.value === slug) {
    await clearActiveProject();
  }

  revalidatePath("/", "layout");

  return {
    ok: true,
    data: {
      agents: deletedAgents,
      agentsFailed,
      mcps: mcpsRevoked,
      mcpsFailed,
    },
  };
}

/**
 * Set (or clear) the workspace's local codebase folder — the sanctioned
 * root for agent code changes (branch + PR protocol). Validates the path
 * is an existing directory, persists it, and re-renders every goal
 * agent's identity so the "Codebase" workspace fact updates immediately.
 */
export async function setProjectCodebasePathAction(input: {
  project_slug: string;
  codebase_path: string;
}): Promise<{ ok: true; codebase_path: string | null } | { ok: false; error: string }> {
  const slug = input.project_slug.trim();
  if (!slug) return { ok: false, error: "Missing project slug." };
  const raw = input.codebase_path.trim();

  let normalized: string | null = null;
  if (raw) {
    const { stat } = await import("node:fs/promises");
    try {
      const s = await stat(raw);
      if (!s.isDirectory()) {
        return { ok: false, error: `Not a folder: ${raw}` };
      }
    } catch {
      return { ok: false, error: `Folder not found: ${raw}` };
    }
    normalized = raw;
  }

  const { setProjectCodebasePath } = await import("@/server/db/projects");
  const updated = setProjectCodebasePath(slug, normalized);
  if (!updated) return { ok: false, error: "Project not found." };

  // Agents carry the codebase path in their identity's workspace facts.
  try {
    const { syncProjectAgents } = await import("@/server/goals/provision");
    await syncProjectAgents(slug);
  } catch (err) {
    console.warn("[settings] identity re-render after codebase change failed:", err);
  }

  revalidatePath("/", "layout");
  return { ok: true, codebase_path: updated.codebase_path };
}
