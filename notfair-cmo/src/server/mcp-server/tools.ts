import { z } from "zod";

import {
  APPROVAL_ACTION_TYPE_VALUES,
  handleAddTaskComment,
  handleAskUser,
  handleCancelTask,
  handleCreateTask,
  handleGetApproval,
  handleGetProject,
  handleGetTask,
  handleListApprovalActionTypes,
  handleListApprovalsForTask,
  handleListMyApprovals,
  handleListMyTasks,
  handleListPendingApprovals,
  handleListProjectAgents,
  handleListTaskComments,
  handleListTaskStatuses,
  handleListTasks,
  handleRequestApproval,
  handleSetProjectBrief,
  handleTaskStatus,
  handleUpdateTask,
  TASK_STATUS_VALUES,
} from "@/server/orchestration/handlers";
import type { TaskStatus } from "@/types";

import { BROWSER_TOOLS } from "./browser-tools";

/**
 * Tool definitions exposed by notfair-cmo's MCP server to OpenClaw-side
 * agents. The MCP server is **globally installed** (one OpenClaw row,
 * shared across every project), so every tool takes a required
 * `project_slug` argument the caller MUST fill in. We never derive
 * project from the bearer because every project's agents use the same
 * bearer — that's the whole point of "globally shared." The agent learns
 * its `project_slug` + `agent_id` from its IDENTITY.md prompt header and
 * from the task kickoff message.
 *
 * Schema enforcement (zod) prevents the kind of drift that stranded
 * `superpublic-test-1`: an agent emitting `status: closed` instead of a
 * valid enum. The provider rejects invalid values before the model emits
 * them; we double-check server-side so a misbehaving runtime can't slip
 * past.
 */

// ── Shared scaffolding ─────────────────────────────────────────────────

export type ToolHandlerContext = {
  /** Reserved for future per-agent bearer scoping. Unused today. */
  agentId?: string;
};

export type ToolResult =
  | { ok: true; content: { type: "text"; text: string }[] }
  | { ok: false; error: string };

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (input: unknown, ctx: ToolHandlerContext) => Promise<ToolResult>;
};

function invalid(err: z.ZodError): ToolResult {
  return {
    ok: false,
    error: `Invalid arguments: ${err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
  };
}

function txt(text: string): ToolResult {
  return { ok: true, content: [{ type: "text", text }] };
}

// ── Tool: submit_task_status ───────────────────────────────────────────

const submitTaskStatusInput = z.object({
  project_slug: z
    .string()
    .min(1)
    .describe(
      "The project this task belongs to. From your IDENTITY.md prompt header / kickoff message.",
    ),
  agent_id: z
    .string()
    .min(1)
    .describe(
      "Your agent_id (e.g. `superpublic-google-ads`). From IDENTITY.md. Used to enforce 'only the assignee can update'.",
    ),
  task_id: z
    .string()
    .min(1)
    .describe("UUID or display_id of the task you were assigned."),
  status: z
    .enum(TASK_STATUS_VALUES)
    .describe(
      "working = still progressing, done = task complete, blocked = waiting on user/CMO/approval, failed = couldn't complete.",
    ),
  summary: z
    .string()
    .optional()
    .describe(
      "One-paragraph progress note. Required when status is 'done' or 'failed'.",
    ),
});

async function handleSubmitTaskStatus(input: unknown): Promise<ToolResult> {
  const parsed = submitTaskStatusInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, task_id, status, summary } = parsed.data;
  const r = handleTaskStatus(
    { task_id, status, summary },
    { project_slug, agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(`task ${r.data.task_id} updated to ${r.data.status}.`);
}

// ── Tool: create_task ──────────────────────────────────────────────────

const createTaskInput = z.object({
  project_slug: z
    .string()
    .min(1)
    .describe("The project you are operating in. From your IDENTITY.md."),
  assigner_agent_id: z
    .string()
    .min(1)
    .describe(
      "Your own agent_id — the one creating the task (e.g. `demo-cmo`). From IDENTITY.md.",
    ),
  assignee: z
    .string()
    .min(1)
    .describe(
      "Template key of the assignee (e.g. `google_ads`, `seo`). Must be a specialist provisioned in this project; CMO can't assign to itself.",
    ),
  title: z
    .string()
    .min(1)
    .describe("Short label shown on task cards."),
  brief: z
    .string()
    .min(1)
    .describe(
      "Full request body. PRD-style description with context, target outcome, constraints.",
    ),
  success_criteria: z
    .string()
    .optional()
    .describe("Measurable definition of done."),
});

async function handleCreateTaskTool(input: unknown): Promise<ToolResult> {
  const parsed = createTaskInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, assigner_agent_id, assignee, title, brief, success_criteria } = parsed.data;
  const r = await handleCreateTask(
    { assignee, title, brief, success_criteria },
    { project_slug, agent_id: assigner_agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(
    `task ${r.data.display_id} ("${r.data.title}") created for ${r.data.agent_id}. Status: ${r.data.status}.`,
  );
}

// ── Tool: request_approval ─────────────────────────────────────────────

const requestApprovalInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  agent_id: z.string().min(1).describe("Your own agent_id."),
  task_id: z
    .string()
    .optional()
    .describe(
      "Task this approval is gating, if any. Setting this parks the task in `blocked` until resolved.",
    ),
  action_summary: z
    .string()
    .min(1)
    .describe("One-line description of what you want to do."),
  action_type: z
    .enum(APPROVAL_ACTION_TYPE_VALUES)
    .describe(
      "Category of the action. Used by auto-approval policies and to label the inbox card.",
    ),
  cost_estimate_usd: z
    .number()
    .optional()
    .describe(
      "Estimated monthly cost in USD. Required for spend / bid_change / new_channel.",
    ),
  reasoning: z
    .string()
    .optional()
    .describe(
      "Why you want to do this. Shown in the approval card; the more concrete the better.",
    ),
});

async function handleRequestApprovalTool(input: unknown): Promise<ToolResult> {
  const parsed = requestApprovalInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, task_id, action_summary, action_type, cost_estimate_usd, reasoning } = parsed.data;
  const r = await handleRequestApproval(
    { task_id, action_summary, action_type, cost_estimate_usd, reasoning },
    { project_slug, agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const suffix = r.data.auto_resolved
    ? ` (auto-${r.data.status} by policy)`
    : "";
  return txt(
    `approval ${r.data.approval_id} created${suffix}. status=${r.data.status}.`,
  );
}

// ── Tool: add_task_comment ─────────────────────────────────────────────

const addTaskCommentInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  agent_id: z.string().min(1).describe("Your own agent_id."),
  task_id: z.string().min(1).describe("Task you're commenting on."),
  body: z.string().min(1).describe("Comment text. Visible in /activity."),
});

async function handleAddTaskCommentTool(input: unknown): Promise<ToolResult> {
  const parsed = addTaskCommentInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, task_id, body } = parsed.data;
  const r = handleAddTaskComment(
    { task_id, body },
    { project_slug, agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(`comment added to task ${r.data.task_id}.`);
}

// ── Tool: ask_user_question ────────────────────────────────────────────

const askUserInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  agent_id: z.string().min(1).describe("Your own agent_id."),
  question: z.string().min(1).describe("The question to surface to the user."),
  task_id: z
    .string()
    .optional()
    .describe("Optional — anchor the question to a task."),
  options: z
    .string()
    .optional()
    .describe("Optional comma-separated multiple-choice hints (rendered as buttons)."),
});

async function handleAskUserTool(input: unknown): Promise<ToolResult> {
  const parsed = askUserInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, question, task_id, options } = parsed.data;
  const r = handleAskUser(
    { question, task_id, options },
    { project_slug, agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  // The task is now parked in `blocked`; the agent should end its turn
  // and wait for the user's answer to be delivered via a [SYSTEM] wake-up
  // turn. Surface the question_id so the agent can correlate.
  const taskClause = r.data.task_id
    ? ` on task ${r.data.task_id}. The task is now blocked until the user answers; end your turn.`
    : ".";
  return txt(
    `question ${r.data.question_id} recorded${taskClause}`,
  );
}

// ── Tool: get_task ─────────────────────────────────────────────────────

const getTaskInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  task_id: z.string().min(1).describe("UUID or display_id."),
});

async function handleGetTaskTool(input: unknown): Promise<ToolResult> {
  const parsed = getTaskInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleGetTask(
    { task_id: parsed.data.task_id },
    { project_slug: parsed.data.project_slug, agent_id: "" },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify(r.data));
}

// ── Tool: list_my_tasks ────────────────────────────────────────────────

const TASK_STATUS_FILTER_VALUES = [
  "proposed",
  "approved",
  "working",
  "blocked",
  "done",
  "failed",
  "cancelled",
  "in_flight",
  "all",
] as const;

const listMyTasksInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  agent_id: z.string().min(1).describe("Your own agent_id."),
  status: z
    .enum(TASK_STATUS_FILTER_VALUES)
    .optional()
    .describe(
      "Filter by status. 'in_flight' (default) = proposed|approved|running|blocked; 'all' = no filter.",
    ),
});

async function handleListMyTasksTool(input: unknown): Promise<ToolResult> {
  const parsed = listMyTasksInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, status } = parsed.data;
  const filter = status as
    | TaskStatus
    | "in_flight"
    | "all"
    | undefined;
  const r = handleListMyTasks(
    { status: filter },
    { project_slug, agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify({ tasks: r.data, count: r.data.length }));
}

// ── Tool: list_tasks (project-wide) ────────────────────────────────────

const listTasksInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  status: z
    .enum([
      "proposed",
      "approved",
      "working",
      "blocked",
      "done",
      "failed",
      "cancelled",
    ])
    .optional()
    .describe("Optional status filter."),
});

async function handleListTasksTool(input: unknown): Promise<ToolResult> {
  const parsed = listTasksInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleListTasks(
    { status: parsed.data.status as TaskStatus | undefined },
    { project_slug: parsed.data.project_slug, agent_id: "" },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify({ tasks: r.data, count: r.data.length }));
}

// ── Tool: update_task ──────────────────────────────────────────────────

const updateTaskInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  agent_id: z.string().min(1).describe("Your own agent_id."),
  task_id: z.string().min(1).describe("UUID or display_id of the task to update."),
  title: z.string().optional().describe("New title."),
  brief: z.string().optional().describe("New brief / description."),
  success_criteria: z.string().optional().describe("New success criteria."),
});

async function handleUpdateTaskTool(input: unknown): Promise<ToolResult> {
  const parsed = updateTaskInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, task_id, title, brief, success_criteria } = parsed.data;
  const r = handleUpdateTask(
    { task_id, title, brief, success_criteria },
    { project_slug, agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(`task ${r.data.display_id} updated.`);
}

// ── Tool: cancel_task ──────────────────────────────────────────────────

const cancelTaskInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  agent_id: z.string().min(1).describe("Your own agent_id."),
  task_id: z.string().min(1).describe("UUID or display_id of the task to cancel."),
  reason: z
    .string()
    .optional()
    .describe("Why you're cancelling. Stored on the task's error_message."),
});

async function handleCancelTaskTool(input: unknown): Promise<ToolResult> {
  const parsed = cancelTaskInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, task_id, reason } = parsed.data;
  const r = handleCancelTask(
    { task_id, reason },
    { project_slug, agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(`task ${r.data.display_id} cancelled.`);
}

// ── Tool: get_project ──────────────────────────────────────────────────

const getProjectInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
});

async function handleGetProjectTool(input: unknown): Promise<ToolResult> {
  const parsed = getProjectInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleGetProject(
    {},
    { project_slug: parsed.data.project_slug, agent_id: "" },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify(r.data));
}

// ── Tool: list_project_agents ──────────────────────────────────────────

const listProjectAgentsInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
});

async function handleListProjectAgentsTool(input: unknown): Promise<ToolResult> {
  const parsed = listProjectAgentsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = await handleListProjectAgents(
    {},
    { project_slug: parsed.data.project_slug, agent_id: "" },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify({ agents: r.data, count: r.data.length }));
}

// ── Tool: list_task_comments ───────────────────────────────────────────

const listTaskCommentsInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  task_id: z.string().min(1).describe("Task whose comment thread you want."),
  limit: z.number().optional().describe("Max comments to return (default 50)."),
});

async function handleListTaskCommentsTool(input: unknown): Promise<ToolResult> {
  const parsed = listTaskCommentsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleListTaskComments(
    { task_id: parsed.data.task_id, limit: parsed.data.limit },
    { project_slug: parsed.data.project_slug, agent_id: "" },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify({ comments: r.data, count: r.data.length }));
}

// ── Tool: get_approval ─────────────────────────────────────────────────

const getApprovalInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  approval_id: z.string().min(1).describe("Approval UUID."),
});

async function handleGetApprovalTool(input: unknown): Promise<ToolResult> {
  const parsed = getApprovalInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleGetApproval(
    { approval_id: parsed.data.approval_id },
    { project_slug: parsed.data.project_slug, agent_id: "" },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify(r.data));
}

// ── Tool: list_my_approvals ────────────────────────────────────────────

const listMyApprovalsInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  agent_id: z.string().min(1).describe("Your own agent_id."),
});

async function handleListMyApprovalsTool(input: unknown): Promise<ToolResult> {
  const parsed = listMyApprovalsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleListMyApprovals(
    {},
    { project_slug: parsed.data.project_slug, agent_id: parsed.data.agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify({ approvals: r.data, count: r.data.length }));
}

// ── Tool: list_pending_approvals ───────────────────────────────────────

const listPendingApprovalsInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
});

async function handleListPendingApprovalsTool(input: unknown): Promise<ToolResult> {
  const parsed = listPendingApprovalsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleListPendingApprovals(
    {},
    { project_slug: parsed.data.project_slug, agent_id: "" },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify({ approvals: r.data, count: r.data.length }));
}

// ── Tool: list_approvals_for_task ──────────────────────────────────────

const listApprovalsForTaskInput = z.object({
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  task_id: z.string().min(1).describe("Task whose approvals you want."),
});

async function handleListApprovalsForTaskTool(
  input: unknown,
): Promise<ToolResult> {
  const parsed = listApprovalsForTaskInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleListApprovalsForTask(
    { task_id: parsed.data.task_id },
    { project_slug: parsed.data.project_slug, agent_id: "" },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify({ approvals: r.data, count: r.data.length }));
}

// ── Tool: list_task_statuses (enum discovery) ──────────────────────────
// No project_slug — this is a static enum, not project-scoped state. Agents
// query it once to learn the workflow.

const listTaskStatusesInput = z.object({});

async function handleListTaskStatusesTool(input: unknown): Promise<ToolResult> {
  const parsed = listTaskStatusesInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleListTaskStatuses();
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify({ statuses: r.data }));
}

// ── Tool: list_approval_action_types ───────────────────────────────────

const listApprovalActionTypesInput = z.object({});

async function handleListApprovalActionTypesTool(
  input: unknown,
): Promise<ToolResult> {
  const parsed = listApprovalActionTypesInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const r = handleListApprovalActionTypes();
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify({ action_types: r.data }));
}

// ── Tool: set_project_brief ────────────────────────────────────────────

const setProjectBriefInput = z.object({
  project_slug: z
    .string()
    .min(1)
    .describe(
      "The project this brief belongs to. From your IDENTITY.md prompt header.",
    ),
  agent_id: z
    .string()
    .min(1)
    .describe(
      "Your agent_id (e.g. `acme-cmo`). From IDENTITY.md. The CMO is the expected caller — specialists should not write to PROJECT.md.",
    ),
  body: z
    .string()
    .min(1)
    .describe(
      "Full PROJECT.md content as markdown. Replaces any prior body. Capped at 64 KB. Aim for a 90-second read: what we sell, who we sell to, positioning, voice, key constraints.",
    ),
});

async function handleSetProjectBriefTool(input: unknown): Promise<ToolResult> {
  const parsed = setProjectBriefInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, body } = parsed.data;
  const r = await handleSetProjectBrief(
    { body },
    { project_slug, agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(`PROJECT.md written; synced to project agents.`);
}

// ── Tool: schedule_recurring_work ─────────────────────────────────────

const scheduleRecurringWorkInput = z.object({
  project_slug: z
    .string()
    .min(1)
    .describe("Your project_slug from IDENTITY.md."),
  agent_id: z
    .string()
    .min(1)
    .describe(
      "Your agent_id (e.g. `demo1-google-ads-ana`). The cron will fire as a task assignment to this agent.",
    ),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "must be kebab-case lowercase")
    .describe(
      "Short kebab-case identifier for this scheduled job. Should describe the work, not the schedule. Good: `daily-bid-opt`, `weekly-quality-score`. Bad: `9am-cron`.",
    ),
  cron_expr: z
    .string()
    .min(1)
    .describe(
      "Standard 5-field cron expression (minute hour day month day-of-week). Example: `0 9 * * 1` = 9am every Monday. Interpreted as UTC; embed timezone offset in the hour field if needed.",
    ),
  message: z
    .string()
    .min(1)
    .describe(
      "The prompt the scheduled job will send to the agent on each tick. Treat it as instructions to your future self — be specific about what to do and what to report.",
    ),
});

async function handleScheduleRecurringWorkTool(
  input: unknown,
): Promise<ToolResult> {
  const parsed = scheduleRecurringWorkInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, name, cron_expr, message } = parsed.data;

  // Verify the calling agent belongs to the project they're scoping.
  const project = await import("@/server/db/projects").then((m) =>
    m.getProject(project_slug),
  );
  if (!project) return { ok: false, error: `Unknown project '${project_slug}'.` };
  const { listProjectAgents } = await import("@/server/agent-meta");
  const projectAgents = await listProjectAgents(project_slug);
  if (!projectAgents.some((a) => a.agent_id === agent_id)) {
    return {
      ok: false,
      error: `Agent '${agent_id}' is not part of project '${project_slug}'.`,
    };
  }

  // Validate the cron expression by trying to parse it.
  try {
    const { CronExpressionParser } = await import("cron-parser");
    CronExpressionParser.parse(cron_expr, { tz: "UTC" });
  } catch (err) {
    return {
      ok: false,
      error: `Invalid cron_expr: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const { createScheduledJob } = await import("@/server/scheduler");
    const job = createScheduledJob({
      project_slug,
      agent_id,
      name,
      cron_expr,
      message,
      enabled: true,
    });
    return txt(
      JSON.stringify({
        id: job.id,
        name: job.name,
        cron_expr: job.cron_expr,
        next_run_at: job.next_run_at,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint")) {
      return {
        ok: false,
        error: `A scheduled job named '${name}' already exists for this agent. Pick a different name or list existing jobs first.`,
      };
    }
    return { ok: false, error: msg };
  }
}

// ── Registry ───────────────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  {
    name: "submit_task_status",
    description:
      "Report progress on the task you were assigned. Call at the END of any turn that finishes work, blocks, or fails. Replaces the legacy `<task_status>` text block — same semantics, strict enum.",
    inputSchema: submitTaskStatusInput,
    handler: handleSubmitTaskStatus,
  },
  {
    name: "create_task",
    description:
      "Spawn a new task and assign it to a specialist. CMO uses this to delegate; specialists can use it to chain follow-up work. The task auto-starts (proposed → running) so the assignee picks it up immediately.",
    inputSchema: createTaskInput,
    handler: handleCreateTaskTool,
  },
  {
    name: "request_approval",
    description:
      "Ask the user (or an auto-approve policy) to sign off on a governed action before you execute it. Required before any spend change, content publish, new channel, bid change, or audience change. Setting `task_id` parks the task in `blocked` until the user (or policy) resolves it; on approve the agent receives a wake-up message to proceed.",
    inputSchema: requestApprovalInput,
    handler: handleRequestApprovalTool,
  },
  {
    name: "add_task_comment",
    description:
      "Leave a note on a task — for the CMO to see, or to record your reasoning. Visible in /activity. Use this for cross-agent communication that doesn't need user attention.",
    inputSchema: addTaskCommentInput,
    handler: handleAddTaskCommentTool,
  },
  {
    name: "ask_user_question",
    description:
      "Surface a question to the user (not the CMO). Use sparingly — only when the answer can't come from the CMO, your tools, or the brief. Provide `options` for multiple-choice.",
    inputSchema: askUserInput,
    handler: handleAskUserTool,
  },
  {
    name: "get_task",
    description:
      "Fetch a task by id (UUID or display_id). Use this to re-anchor when your context window rotates and you've lost the brief, or to check the latest state of a task you previously touched.",
    inputSchema: getTaskInput,
    handler: handleGetTaskTool,
  },
  {
    name: "list_my_tasks",
    description:
      "List tasks assigned to YOU (filtered to your project). Default returns in-flight tasks (proposed | approved | running | blocked). Use this to see what's on your plate.",
    inputSchema: listMyTasksInput,
    handler: handleListMyTasksTool,
  },
  {
    name: "list_tasks",
    description:
      "List ALL tasks in the project — across every agent. Optional status filter. Use this to understand cross-agent activity or, as the CMO, to plan.",
    inputSchema: listTasksInput,
    handler: handleListTasksTool,
  },
  {
    name: "update_task",
    description:
      "Edit a task's title, brief, or success criteria. Used by the CMO to clarify a delegation after the fact. Doesn't change task status — use submit_task_status / cancel_task for that.",
    inputSchema: updateTaskInput,
    handler: handleUpdateTaskTool,
  },
  {
    name: "cancel_task",
    description:
      "Mark a task `cancelled`. Use when the work is no longer relevant or has been superseded. Optional `reason` is stored on error_message.",
    inputSchema: cancelTaskInput,
    handler: handleCancelTaskTool,
  },
  {
    name: "get_project",
    description:
      "Fetch the current project's metadata (display name, Google Ads account id, etc.). Useful when you need project-level context for an answer.",
    inputSchema: getProjectInput,
    handler: handleGetProjectTool,
  },
  {
    name: "list_project_agents",
    description:
      "List the agents available in this project (CMO + specialists + any custom clones). Use this to discover valid `assignee` template_keys for create_task.",
    inputSchema: listProjectAgentsInput,
    handler: handleListProjectAgentsTool,
  },
  {
    name: "list_task_comments",
    description:
      "Fetch the comment thread on a task (added via add_task_comment / <add_comment>). Use to catch up on cross-agent conversation when you re-engage with a task.",
    inputSchema: listTaskCommentsInput,
    handler: handleListTaskCommentsTool,
  },
  {
    name: "get_approval",
    description:
      "Fetch an approval row by id. Use when an earlier wake-up message gave you an approval_id and you need the latest state (decision_note, decided_by, etc.).",
    inputSchema: getApprovalInput,
    handler: handleGetApprovalTool,
  },
  {
    name: "list_my_approvals",
    description:
      "List approvals YOU requested (pending and revision_requested). Use to check whether any of your prior asks are still parked.",
    inputSchema: listMyApprovalsInput,
    handler: handleListMyApprovalsTool,
  },
  {
    name: "list_pending_approvals",
    description:
      "List every actionable approval in the project (pending + revision_requested), across all agents. Useful for the CMO to triage.",
    inputSchema: listPendingApprovalsInput,
    handler: handleListPendingApprovalsTool,
  },
  {
    name: "list_approvals_for_task",
    description:
      "List every approval ever requested on a specific task — history of governed actions for that task.",
    inputSchema: listApprovalsForTaskInput,
    handler: handleListApprovalsForTaskTool,
  },
  {
    name: "list_task_statuses",
    description:
      "Discover the task workflow state machine: every status value, what it means, whether it's terminal, and what transitions are allowed FROM it. Call once when you're unsure which status to use.",
    inputSchema: listTaskStatusesInput,
    handler: handleListTaskStatusesTool,
  },
  {
    name: "list_approval_action_types",
    description:
      "Discover valid `action_type` values for request_approval, with descriptions and which require a cost estimate. Call once if you're unsure which type fits your action.",
    inputSchema: listApprovalActionTypesInput,
    handler: handleListApprovalActionTypesTool,
  },
  {
    name: "set_project_brief",
    description:
      "Write (or rewrite) PROJECT.md — the single source of truth for what this project sells, who it sells to, positioning, voice, and constraints. Synced into every agent's IDENTITY.md so the CMO + specialists share the same context. The CMO calls this once during its first onboarding task and again whenever the user surfaces a material change.",
    inputSchema: setProjectBriefInput,
    handler: handleSetProjectBriefTool,
  },
  {
    name: "schedule_recurring_work",
    description:
      "Create a scheduled job that fires a synthetic task assignment to an agent on a cron schedule. Persists to notfair-cmo's SQLite scheduled_jobs table; visible in the Crons tab. Use this when the user asks for 'every day', 'every Monday', 'every hour' work. Replaces the legacy `openclaw cron add` CLI.",
    inputSchema: scheduleRecurringWorkInput,
    handler: handleScheduleRecurringWorkTool,
  },
  ...BROWSER_TOOLS,
];

export function describeTool(tool: ToolDefinition): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
} {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodObjectToJsonSchema(tool.inputSchema),
  };
}

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

/**
 * Minimal zod → JSON-Schema converter for the shapes we actually use:
 * z.object with z.string / z.number / z.string().optional / z.enum / .describe.
 * Anything richer falls back to {type:"string"} — the handler's safeParse
 * catches real violations either way.
 */
function zodObjectToJsonSchema(
  schema: z.ZodObject<z.ZodRawShape>,
): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    const node = leafSchema(value as z.ZodTypeAny);
    properties[key] = node.schema;
    if (!node.optional) required.push(key);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function leafSchema(
  schema: z.ZodTypeAny,
): { schema: Record<string, unknown>; optional: boolean } {
  let optional = false;
  let inner: z.ZodTypeAny = schema;
  if (inner instanceof z.ZodOptional) {
    optional = true;
    inner = inner._def.innerType as z.ZodTypeAny;
  }
  const description = (schema as { description?: string }).description;
  const out: Record<string, unknown> = {};
  if (inner instanceof z.ZodString) {
    out.type = "string";
  } else if (inner instanceof z.ZodEnum) {
    out.type = "string";
    out.enum = (inner._def as { values: string[] }).values;
  } else if (inner instanceof z.ZodNumber) {
    out.type = "number";
  } else if (inner instanceof z.ZodBoolean) {
    out.type = "boolean";
  } else {
    out.type = "string";
  }
  if (description) out.description = description;
  return { schema: out, optional };
}
