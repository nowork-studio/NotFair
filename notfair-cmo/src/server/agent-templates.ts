import { stat } from "node:fs/promises";
import {
  initProgress,
  updateStep,
  type ProgressStep,
} from "@/server/onboarding/provisioning-progress";
import { readAgentMeta, writeAgentMeta } from "@/server/agent-meta";
import { provisionAgent, workspaceDirFor as agentWorkspaceDirFor } from "@/server/agents/provisioning";
import { getProject } from "@/server/db/projects";
import { getOrchestrationSkill } from "@/server/skills/orchestration-skill";
import { readProjectBrief } from "@/server/onboarding/project-brief";
import { DEFAULT_HARNESS_ADAPTER } from "@/server/adapters/registry";
import {
  registerBrowserMcpForAgent,
  registerOrchestrationForAgent,
} from "@/server/mcp-server/registration";

/**
 * Role-specific behavior for the CMO. Concise — the procedural how-to
 * (MCP tool surface, state machine, cron CLI, propose-cron rules) lives
 * once in `getOrchestrationSkill()` and is appended to every agent's
 * IDENTITY.md by writeIdentityFile.
 *
 * Keep this strictly about "who am I + what's my decision-making lens?".
 * Tool listings, schemas, cron syntax → skill file, not here.
 */
const CMO_ROLE = `## Your role: orchestrator

You think about strategy, decompose work into tasks, and delegate to
the specialist agents you coordinate. You do NOT do hands-on Google
Ads / SEO / content work yourself — your specialists do that.

Your output is SHORT prose; the user reads prose, and coordination
happens through the MCP tools (see the platform skill section below).
Never narrate "I'm going to create a task" — just call the tool and
the user sees the result on the kanban.

Shape of a typical turn (chat or scheduled heartbeat):

1. Brief situation read — 1-2 sentences pointing at the most actionable
   finding (a dollar number, a clear gap, a blocker).
2. One or more \`create_task\` calls to delegate ongoing work to the
   right specialist(s). 1-3 tasks per turn, not 10 — pick what matters.
3. Optional \`request_approval\` if the very next action is governed
   (spend / publish / new channel / bid change / audience change).
4. Close any task you yourself were assigned with \`submit_task_status\`.

When you're acting on a "(task assignment)" turn (typically the
onboarding audit):
- Acknowledge briefly (1-2 sentences).
- Do the planning / research work the brief asks for. The "delegate,
  don't do" rule applies to ONGOING ad operations after planning, not
  to research you need to plan well.
- Report findings inline (markdown, scannable).
- Delegate the ongoing follow-up via \`create_task\`.
- Close the audit task with \`submit_task_status\` status=done.

Style:
- Lead with the point. Be specific. Reference real numbers + channel realities.
- Don't waffle. Recommendations beat options. The user can push back.
- Don't chat-thread with the user about ad operations once the planning
  is done. If they ask ad-level details later, \`create_task\` for the
  specialist and let them handle it.
- Briefs should read the way a real marketing director would write them:
  state the goal, the context, the expected output, the constraints.`;

/**
 * Role-specific behavior for any non-CMO specialist (Google Ads, SEO,
 * future others). Domain-specific tool guidance (notfair-googleads,
 * GSC, etc.) is injected per-template after this block — this constant
 * is the shared "I'm a worker, here's how I behave" identity.
 */
const SPECIALIST_ROLE = `## Your role: specialist worker

You receive tasks from the CMO via chat messages that begin with
"(task assignment)" — they carry your project_slug, agent_id, task_id,
title, brief, and success criteria. Do the hands-on work using your
domain tools, then close the task out by calling \`submit_task_status\`.

Shape of a "(task assignment)" turn:

1. Acknowledge in 1-2 sentences — what you'll do and roughly how long.
2. Start working. Use your domain tools to actually do the thing — not
   describe what you'd do.
3. End the turn by calling \`submit_task_status\` with the task_id, the
   status, and a one-line summary (required for done / failed).

Any chat turn that does NOT begin with "(task assignment)" is the user
(or CMO) chatting with you about prior work. Respond normally; don't
fabricate a new task.

For governed writes (spend, content publish, new channel, bid change,
audience change), call \`request_approval\` BEFORE executing. The task
parks in \`blocked\`; you'll be woken on resolution with the decision
in context. Don't perform the gated action until then.

Style:
- Show your work — quote the dollar amounts, keyword strings, query
  IDs you're operating on. The user trusts numbers more than words.
- One thread of execution per turn. If your work branches, finish one
  thread + checkpoint via \`submit_task_status\` status=working before
  starting the next.`;

export type AgentTemplate = {
  key: "cmo" | "google_ads" | "meta_ads" | "seo";
  /**
   * Label for the ROLE this template represents (e.g. "CMO", "Google
   * Ads"). Used in the sidebar role pill + anywhere the UI says
   * "what kind of agent is this". Distinct from the agent's PERSONAL
   * name (e.g. "Greg"); the personal name lives on AgentMeta.
   */
  display_name: string;
  /**
   * Suggested personal name pre-filled into the onboarding form when
   * the user provisions this template. Short + memorable so the
   * sidebar reads like a team of named colleagues rather than a roster
   * of job titles. Users can override during onboarding; the choice
   * becomes immutable once the agent is created.
   */
  default_name: string;
  description: string;
  capabilities: string[];
  model: string;
  system_prompt: string;
  /**
   * True when this template is included in the default onboarding bundle
   * (provisioned on project create + always shown in the sidebar even
   * before disk writes finish). False = opt-in: the template exists for
   * future use, but nothing surfaces it until something explicitly
   * provisions a clone of it for a project.
   */
  default_onboarding: boolean;
  /**
   * MCP catalog key this specialist needs to do its job. When set:
   *   - The agent is provisioned conditionally — only when the matching
   *     MCP is connected for the project (see provisionSpecialistForMcp).
   *   - The agent's page shows a "Connect <platform>" blocker when the
   *     MCP token is missing (see resolveMcpBlocker).
   * CMO and other tools-less templates leave this undefined.
   */
  requires_mcp_key?: string;
};

export type AgentTemplateKey = AgentTemplate["key"];

/**
 * Subset of TEMPLATES included in the default onboarding bundle. Single
 * source of truth for "which agents does a freshly-created project get?".
 *
 * Only CMO ships by default now. The three specialists (Google Ads,
 * Meta Ads, SEO) are gated on the user connecting the matching MCP —
 * the connect step in onboarding triggers provisioning via
 * provisionSpecialistForMcp as each token lands. Google Search Console
 * isn't its own specialist — connecting GSC provisions the SEO agent,
 * which uses GSC alongside on-page / technical SEO work.
 */
export const DEFAULT_ONBOARDING_TEMPLATE_KEYS: AgentTemplateKey[] = ["cmo"];

/**
 * Template key → MCP catalog key mapping for the specialists that the
 * onboarding connect step gates provisioning on. Inverse lookup
 * (MCP key → template key) used by provisionSpecialistForMcp when an
 * OAuth callback lands and we need to decide which specialist to mint.
 *
 * Notice GSC maps to `seo` — there's no dedicated GSC agent. The SEO
 * specialist owns search-console work as part of its broader remit
 * (technical SEO, content, ranking analysis).
 */
export const SPECIALIST_TEMPLATE_BY_MCP_KEY: Record<string, AgentTemplateKey> = {
  "notfair-googleads": "google_ads",
  "notfair-metaads": "meta_ads",
  "notfair-googlesearchconsole": "seo",
};

export function templateForKey(key: string): AgentTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key || t.key.replace(/_/g, "-") === key);
}

export function templateForUrlSlug(slug: string): AgentTemplate | undefined {
  // URL slugs use hyphens (google-ads), template keys use underscores (google_ads).
  return TEMPLATES.find(
    (t) => t.key === slug || t.key.replace(/_/g, "-") === slug,
  );
}

export function urlSlugForTemplate(key: AgentTemplateKey): string {
  return key.replace(/_/g, "-");
}

export const TEMPLATES: AgentTemplate[] = [
  {
    key: "cmo",
    display_name: "CMO",
    default_name: "Greg",
    description: "Chief Marketing Officer. Owns strategy and orchestrates the specialist agents.",
    capabilities: [
      "Talk through marketing strategy and prioritization",
      "Propose experiments + 30-day plans",
      "Delegate work to specialist agents (Google Ads, SEO)",
      "Schedule recurring jobs via openclaw cron",
      "Coordinate signals across channels",
    ],
    model: "openai-codex/gpt-5.5",
    system_prompt: `You are the CMO for a marketing project on the notfair-cmo platform.

${CMO_ROLE}`,
    default_onboarding: true,
  },
  {
    key: "google_ads",
    display_name: "Google Ads Specialist",
    default_name: "Ana",
    description: "Runs Google Ads campaigns, keywords, bids, budgets, search terms, negatives.",
    capabilities: [
      "Audit account health + identify wasted spend",
      "Propose + apply bid changes",
      "Manage keywords, ad groups, negative lists",
      "Pull performance metrics + surface anomalies",
      "Schedule recurring bid/metric jobs",
      "Uses notfair-googleads MCP when account connected",
    ],
    model: "openai-codex/gpt-5.5",
    system_prompt: `You are a Google Ads specialist agent on the notfair-cmo platform.

${SPECIALIST_ROLE}

## Your domain tools

When the notfair-googleads MCP is connected to this project, use its
\`runScript\` tool for everything — \`ads.gaql\` for single GAQL queries,
\`ads.gaqlParallel\` to fan out audits across surfaces in one call. Cast
a wide net on the first pass; filter in-script for free.

You also have the platform's \`exec\` tool for shell, \`read/edit/write\`
for files in your workspace, and the orchestration MCP for coordination.`,
    default_onboarding: false,
    requires_mcp_key: "notfair-googleads",
  },
  {
    key: "meta_ads",
    display_name: "Meta Ads Specialist",
    default_name: "Mia",
    description: "Runs Meta Ads (Facebook + Instagram) campaigns, ad sets, creative, audiences.",
    capabilities: [
      "Audit ad-account spend, ROAS, CPM, frequency",
      "Diagnose ad-set delivery + audience overlap",
      "Surface creative fatigue + winners",
      "Propose budget shifts + bid changes",
      "Schedule recurring performance + pacing checks",
      "Uses notfair-metaads MCP when account connected",
    ],
    model: "openai-codex/gpt-5.5",
    system_prompt: `You are a Meta Ads (Facebook + Instagram) specialist agent on the notfair-cmo platform.

${SPECIALIST_ROLE}

## Your domain tools

When the notfair-metaads MCP is connected to this project, use its
\`runScript\` tool for reads — \`ads.graph\` for single Graph API calls,
\`ads.graphParallel\` to fan out across insights / adsets / creatives /
account in one pass, and \`ads.insights\` for the conventional insights
pull with sensible defaults. Cast a wide net on the first call; filter
in-script for free.

Domain conventions you should respect:
- Refer to spend in account currency, not abstract units. Always quote
  numbers (spend, ROAS, CPM, CTR, freq) when reporting findings.
- Default to the last 30 days for performance reads unless the brief
  asks for a different window. Use date_preset \`last_30d\` for
  consistency.
- Audience overlap, creative fatigue, and CPM spikes are the three
  things to look for in a "what's wrong" pass; ROAS by ad set + by
  creative are the two things to look at in a "what's working" pass.

You also have the platform's \`exec\` tool for shell, \`read/edit/write\`
for files in your workspace, and the orchestration MCP for coordination.`,
    default_onboarding: false,
    requires_mcp_key: "notfair-metaads",
  },
  {
    key: "seo",
    display_name: "SEO Specialist",
    default_name: "Sam",
    description:
      "Organic search — Search Console performance, technical SEO, content recommendations.",
    capabilities: [
      "Pull Search Console performance (queries, pages, devices, countries)",
      "Surface query and page movers week-over-week",
      "Identify pages losing impressions or rankings",
      "Diagnose indexing issues + coverage gaps",
      "Audit on-page + technical SEO",
      "Propose content ideas based on keyword movers",
      "Schedule recurring ranking / click summaries",
      "Uses notfair-googlesearchconsole MCP when property connected",
    ],
    model: "openai-codex/gpt-5.5",
    system_prompt: `You are the SEO specialist agent on the notfair-cmo platform.

${SPECIALIST_ROLE}

## Your domain tools

Your primary data source is the **notfair-googlesearchconsole** MCP
(connected during onboarding). The selected GSC property
(e.g. \`sc-domain:example.com\` or \`https://example.com/\`) is
persisted on the project; every call you make should target that
property unless the brief explicitly asks for another.

Use the MCP to pull organic search performance (impressions, clicks,
average position) sliced by query, page, country, device, or date.
Combine that with on-page audits, technical SEO checks, schema
recommendations, and internal-link analysis when the brief asks for
broader SEO work.

Domain conventions you should respect:
- Always quote impressions, clicks, CTR, and average position when
  reporting Search Console findings. The user trusts numbers more than
  adjectives.
- Default to the last 28 days for performance reads unless the brief
  asks otherwise. That window aligns with Search Console's native
  default and survives one-off Sunday spikes.
- Lead with **movers**, not absolutes — surface queries and pages that
  moved week-over-week (impressions or position) rather than the static
  top-10 lists the user has already seen.
- Pages losing impressions + dropping in position are the high-signal
  finding; pages with high impressions but low CTR are the high-leverage
  one. Frame recommendations around which is which.

You also have the platform's \`exec\` tool for shell, \`read/edit/write\`
for files in your workspace, and the orchestration MCP for coordination.`,
    default_onboarding: false,
    requires_mcp_key: "notfair-googlesearchconsole",
  },
];

/**
 * Provision the specialist agent that matches a newly-connected MCP. Called
 * from the OAuth callback right after `setMcpBearer` lands a token. Looks
 * up the template via SPECIALIST_TEMPLATE_BY_MCP_KEY, then calls
 * ensureProjectAgents with that single template.
 *
 * Idempotent: if the agent already exists (user reconnected after a
 * disconnect, or token was set via a non-OAuth path that already
 * triggered provisioning), ensureProjectAgents returns it in `existed`
 * and writes no files.
 *
 * No-op when:
 *   - The catalog_key isn't one of the recommended specialists (e.g.
 *     Stripe / Supabase MCPs from the "More" tile — those don't get an
 *     agent).
 *   - The project doesn't exist (defensive — shouldn't happen via the
 *     OAuth callback path which only runs after the project is created).
 */
export async function provisionSpecialistForMcp(
  project_slug: string,
  catalog_key: string,
): Promise<EnsureAgentsResult | null> {
  const template_key = SPECIALIST_TEMPLATE_BY_MCP_KEY[catalog_key];
  if (!template_key) return null;
  if (!getProject(project_slug)) return null;
  return ensureProjectAgents(project_slug, [template_key]);
}

export function agentNameFor(
  project_slug: string,
  template_key: AgentTemplate["key"],
  name: string,
): string {
  // OpenClaw agent name format: <project-slug>-<role>-<slugified-name>
  // (e.g. `acme-cmo-greg`). Encoding the personal name in the backend
  // id keeps the agent_id and URL slug in lockstep: the URL slug is
  // exactly `<role>-<slugified-name>`, the project-prefix dropped.
  return `${project_slug}-${agentUrlSlug(template_key, name)}`;
}

/**
 * URL slug for a template agent — `<role>-<slugified-name>`. The personal
 * name is the user-chosen "Greg" / "Ana" etc; the role is the template
 * key (cmo, google_ads → google-ads). Examples:
 *
 *   role=cmo,        name=Greg      → "cmo-greg"
 *   role=google_ads, name="Ana Q4"  → "google-ads-ana-q4"
 *
 * This slug appears in URLs (`/agents/cmo-greg/tasks`) and is what
 * resolveAgentBySlug looks up. It is computed — never stored — so a
 * future rename of an agent's name (currently not allowed) would just
 * flow through here. Because names are immutable post-creation, the
 * slug is effectively immutable too.
 */
export function agentUrlSlug(
  template_key: AgentTemplate["key"],
  name: string,
): string {
  const role = template_key.replace(/_/g, "-");
  return `${role}-${slugifyName(name)}`;
}

/**
 * Lowercase, hyphen-only, no leading/trailing dashes. Trims to a sane
 * length so a misbehaving name input can't blow up the URL.
 */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export type EnsureAgentsResult = {
  created: string[];
  existed: string[];
  failed: Array<{ name: string; error: string }>;
};

/**
 * Idempotently provision OpenClaw agents for a project.
 *
 * Pass `scope` to provision only a subset (per D4: onboarding ships with CMO
 * + Google Ads only; SEO becomes opt-in later). Omit `scope` to provision
 * every template — preserved for back-compat with existing call sites like
 * the reprovision endpoint.
 *
 * `names` is an optional partial map of template_key → user-chosen personal
 * name (e.g. { cmo: "Greg", google_ads: "Ana" }). Names are immutable post-
 * creation — when the meta sidecar already has a `name`, we keep it and
 * IGNORE this argument for that agent. Templates with no entry here fall
 * back to the template's `default_name`.
 *
 * The result includes `failed`: when a subprocess fails for one agent, the
 * loop logs + continues (partial provisioning is recoverable) and the
 * caller can decide whether `failed.length > 0` is fatal for their flow.
 */
export async function ensureProjectAgents(
  project_slug: string,
  scope?: AgentTemplateKey[],
  names?: Partial<Record<AgentTemplateKey, string>>,
): Promise<EnsureAgentsResult> {
  const created: string[] = [];
  const existed: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  const templates = scope
    ? TEMPLATES.filter((t) => scope.includes(t.key))
    : TEMPLATES;

  // Publish per-template progress so the onboarding setup screen can
  // render a live "Setting up CMO… / Setting up Google Ads agent…"
  // checklist instead of a single opaque spinner.
  const progressSteps: ProgressStep[] = templates.map<ProgressStep>((t) => ({
    key: t.key,
    // display_name carries the full role label now (e.g. "Google Ads
    // Specialist"), so no suffix kludge.
    label: `Setting up ${t.display_name}`,
    status: "pending",
  }));
  initProgress(project_slug, progressSteps);

  // Adapter for this project (chosen at onboarding). All harness-specific
  // workspace writes route through it.
  const project = getProject(project_slug);
  const harnessAdapter = project?.harness_adapter ?? DEFAULT_HARNESS_ADAPTER;

  // Project brief is shared across every agent in the project; read once.
  const brief = await readProjectBrief(project_slug).catch(() => null);
  const skill = getOrchestrationSkill();

  for (const template of templates) {
    updateStep(project_slug, template.key, { status: "in_progress" });
    const personalName = names?.[template.key] ?? template.default_name;
    const agentId = agentNameFor(project_slug, template.key, personalName);
    const already = await agentExists(agentId);

    try {
      const identityMd = renderIdentity({
        template,
        project_slug,
        agent_id: agentId,
        skill,
        brief,
      });
      await provisionAgent({
        projectSlug: project_slug,
        agentId,
        displayName: personalName,
        templateKey: template.key,
        identityMd,
        skillMd: skill,
        projectMd: brief ?? undefined,
        harnessAdapter,
      });
      // Wire notfair-orchestration MCP for this agent so create_task /
      // submit_task_status / request_approval etc. are callable. Best-effort.
      try {
        await registerOrchestrationForAgent(project_slug, agentId);
      } catch (err) {
        console.warn(
          `[provision] orchestration MCP registration failed for ${agentId}:`,
          err,
        );
      }
      // Wire notfair-browser MCP for this agent so browser_open /
      // browser_snapshot / browser_click etc. are callable. Best-effort —
      // an agent without browser access still has all task tooling.
      try {
        await registerBrowserMcpForAgent(project_slug, agentId);
      } catch (err) {
        console.warn(
          `[provision] browser MCP registration failed for ${agentId}:`,
          err,
        );
      }
      // Also wire any external catalog MCPs the project already has tokens
      // for (e.g. Google Ads was connected before this agent was created).
      // Without this, a new agent in an established project sees the
      // orchestration MCP but not the catalog ones the others can see.
      try {
        const { listProjectMcpTokens } = await import("@/server/mcp/tokens");
        const { registerCatalogMcpForAgent } = await import(
          "@/server/mcp-server/registration"
        );
        const tokens = listProjectMcpTokens(project_slug);
        for (const t of tokens) {
          await registerCatalogMcpForAgent(project_slug, t.server_name, agentId);
        }
      } catch (err) {
        console.warn(
          `[provision] catalog MCP registration failed for ${agentId}:`,
          err,
        );
      }
      if (already) {
        const existing = readAgentMeta(agentId);
        const finalName = existing?.name ?? personalName;
        await writeAgentMeta({
          agent_id: agentId,
          project_slug,
          name: finalName,
          template_key: template.key,
          created_at: existing?.created_at ?? new Date().toISOString(),
        });
        existed.push(agentId);
      } else {
        await writeAgentMeta({
          agent_id: agentId,
          project_slug,
          name: personalName,
          template_key: template.key,
          created_at: new Date().toISOString(),
        });
        created.push(agentId);
      }
      updateStep(project_slug, template.key, { status: "done" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to provision agent ${agentId}:`, err);
      failed.push({ name: agentId, error: message });
      updateStep(project_slug, template.key, { status: "failed", error: message });
    }
  }

  // Adapter-specific MCP registration for the notfair-orchestration server
  // happens in src/server/mcp-server/registration.ts now (called from the
  // onboarding/provision routes). Schema-side scaffolding only here.

  return { created, existed, failed };
}

/**
 * Render the full IDENTITY.md body for an agent. Pure — caller writes it via
 * the adapter so the harness sees the file under whichever name it expects
 * (CLAUDE.md for Claude Code, AGENTS.md for Codex).
 */
function renderIdentity(input: {
  template: AgentTemplate;
  project_slug: string;
  agent_id: string;
  skill: string;
  brief: string | null;
}): string {
  const identityBlock = `\n## Your runtime identity\n\nWhen calling notfair-orchestration MCP tools, pass these exact values:\n\n- \`project_slug\`: \`${input.project_slug}\`\n- \`agent_id\`: \`${input.agent_id}\`\n\nDo NOT invent other values. Every orchestration tool call requires both.\n`;
  const projectContextSection = input.brief
    ? `\n## Project context\n\nShared across every agent in this project — derived during onboarding\nand kept in sync via the \`set_project_brief\` MCP tool. Treat this as\nthe authoritative description of who the user is and what they sell.\n\n${input.brief.trim()}\n`
    : "";
  return `# ${input.template.display_name}

${input.template.description}
${identityBlock}${projectContextSection}
${input.template.system_prompt}

---

${input.skill}`;
}

/**
 * Re-render IDENTITY.md / SKILL.md / PROJECT.md for every agent in a project
 * via the project's harness adapter. Called by the `set_project_brief` MCP
 * handler after the canonical PROJECT.md is updated, so specialists pick up
 * the new context without waiting for the next ensureProjectAgents pass.
 */
export async function syncProjectBriefToAgents(
  project_slug: string,
): Promise<{ synced: string[]; failed: Array<{ name: string; error: string }> }> {
  const { listProjectAgents } = await import("./agent-meta");
  const synced: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  const project = getProject(project_slug);
  const harnessAdapter = project?.harness_adapter ?? DEFAULT_HARNESS_ADAPTER;
  const brief = await readProjectBrief(project_slug).catch(() => null);
  const skill = getOrchestrationSkill();
  const entries = await listProjectAgents(project_slug);

  for (const entry of entries) {
    if (!entry.template_key) {
      synced.push(entry.agent_id);
      continue;
    }
    const template = TEMPLATES.find((t) => t.key === entry.template_key);
    if (!template) {
      failed.push({ name: entry.agent_id, error: `Unknown template '${entry.template_key}'` });
      continue;
    }
    try {
      const identityMd = renderIdentity({
        template,
        project_slug,
        agent_id: entry.agent_id,
        skill,
        brief,
      });
      await provisionAgent({
        projectSlug: project_slug,
        agentId: entry.agent_id,
        displayName: entry.name,
        templateKey: entry.template_key,
        identityMd,
        skillMd: skill,
        projectMd: brief ?? undefined,
        harnessAdapter,
      });
      synced.push(entry.agent_id);
    } catch (err) {
      failed.push({
        name: entry.agent_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { synced, failed };
}

/**
 * Check if an agent workspace has been provisioned. Replaces the OpenClaw
 * `agents list` grep — we now own the workspace dir, so a stat suffices.
 */
export async function agentExists(name: string): Promise<boolean> {
  try {
    const dir = agentWorkspaceDirFor(name);
    const s = await stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}
