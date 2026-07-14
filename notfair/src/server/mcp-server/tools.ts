import { z } from "zod";
import { CronExpressionParser } from "cron-parser";

import {
  handleAmendGoal,
  handleBackfillHistory,
  handleDefineGoal,
  handleGetGoal,
  handleGetProject,
  handleLogGoalAction,
  handleLogLearning,
  handleProposeGoalMetric,
  handleProposeTarget,
  handleRegisterPullRequest,
  handleReviewGoalAction,
  handleSearchLearnings,
  handleSetProjectBrief,
  handleUpdateGoalStatus,
} from "@/server/goals/handlers";

/**
 * Tool definitions exposed by NotFair's MCP server to goal agents. The
 * server is globally shared (one bearer for every project), so every tool
 * takes required `project_slug` + `agent_id` args the caller fills from
 * its IDENTITY.md — we never derive identity from the bearer.
 *
 * The surface is deliberately small: the goal lifecycle
 * (define → propose metric → propose target → user clicks START), the loop's bookkeeping
 * (actions, reviews, learnings, status), the shared workspace context,
 * and auxiliary scheduling. There is no task board, no approvals, no
 * delegation — one agent, one goal, one loop.
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

const callerFields = {
  project_slug: z.string().min(1).describe("From IDENTITY.md."),
  agent_id: z.string().min(1).describe("Your own agent_id, from IDENTITY.md."),
};

const goalIdFields = {
  ...callerFields,
  goal_id: z.string().min(1).describe("Your goal_id, from IDENTITY.md."),
};

// ── get_goal ───────────────────────────────────────────────────────────

const getGoalInput = z.object({ ...goalIdFields });

async function handleGetGoalTool(input: unknown): Promise<ToolResult> {
  const parsed = getGoalInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, goal_id } = parsed.data;
  const r = await handleGetGoal({ goal_id }, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify(r.data, null, 2));
}

// ── define_goal ────────────────────────────────────────────────────────

const defineGoalInput = z.object({
  ...goalIdFields,
  statement: z
    .string()
    .min(1)
    .describe(
      "The ambition, concrete enough to measure — e.g. 'Cut Google Ads CAC to ~$30 within 60 days'. Refine by calling again while still in intake.",
    ),
  short_label: z
    .string()
    .min(1)
    .max(48)
    .describe(
      "Compact display label for the sidebar/dashboard, ≤ 5 words with the number — e.g. 'Wasted X spend → $0', 'CAC → $30'. This is how the user identifies the goal everywhere.",
    ),
  deadline: z
    .string()
    .optional()
    .describe("ISO date the user stated, if any (e.g. 2026-09-01)."),
  spend_envelope_usd: z
    .number()
    .optional()
    .describe("Total incremental ad spend the user authorized, if stated."),
});

async function handleDefineGoalTool(input: unknown): Promise<ToolResult> {
  const parsed = defineGoalInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  const r = handleDefineGoal(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(`goal defined: "${r.data.statement}". Next: author + test the metric, then propose_goal_metric.`);
}

// ── propose_goal_metric ────────────────────────────────────────────────

const proposeGoalMetricInput = z.object({
  ...goalIdFields,
  metric_name: z
    .string()
    .min(1)
    .describe("Human label incl. unit + window, e.g. 'CAC (USD, trailing 30d)'."),
  metric_source_key: z
    .string()
    .min(1)
    .describe("Connected catalog MCP key, e.g. 'notfair-googleads'."),
  metric_source_tool: z
    .string()
    .min(1)
    .describe("Tool to call on that server, usually 'runScript'."),
  metric_source_args_json: z
    .string()
    .min(1)
    .describe(
      "JSON-encoded arguments object for the tool call. The call must return a single number (or {value: number}). You must have TESTED this exact call yourself first.",
    ),
  metric_direction: z
    .enum(["increase", "decrease"])
    .describe("Which way is progress: 'increase' (signups, ROAS) or 'decrease' (CAC, wasted spend)."),
});

async function handleProposeGoalMetricTool(input: unknown): Promise<ToolResult> {
  const parsed = proposeGoalMetricInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  const r = await handleProposeGoalMetric(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(
    `Metric verified server-side. Baseline measured: ${r.data.baseline_value}. Report this to the user, suggest a target + cadence + spend envelope, and record it with propose_target once they agree. They start the loop with the START button on your Goal tab.`,
  );
}

// ── backfill_metric_history ────────────────────────────────────────────

const backfillHistoryInput = z.object({
  ...goalIdFields,
  source_key: z
    .string()
    .min(1)
    .describe("Connected catalog MCP key (usually the same as the metric's)."),
  source_tool: z.string().min(1).describe("Tool to call, usually 'runScript'."),
  source_args_json: z
    .string()
    .min(1)
    .describe(
      "JSON-encoded arguments for a DATE-SEGMENTED query returning an array of {date: 'YYYY-MM-DD', value: number} — one point per day, ~30 days, same definition as the goal metric. TEST it yourself first.",
    ),
});

async function handleBackfillHistoryTool(input: unknown): Promise<ToolResult> {
  const parsed = backfillHistoryInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  const r = await handleBackfillHistory(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(
    `History backfilled: ${r.data.points} daily points from ${r.data.from} to ${r.data.to}. The progress chart now has context.`,
  );
}

// ── propose_target / amend_goal ────────────────────────────────────────

const proposeTargetInput = z.object({
  ...goalIdFields,
  target_value: z
    .number()
    .describe("The number you and the user landed on in chat."),
  mode: z
    .enum(["achieve", "maintain"])
    .optional()
    .describe(
      "achieve (default) = the goal completes when the target is reached. maintain = HOLD the number there indefinitely (\"keep waste at $0\") — the loop keeps watching and never self-completes.",
    ),
  deadline: z.string().optional().describe("ISO date, if agreed."),
  spend_envelope_usd: z
    .number()
    .optional()
    .describe("Total incremental spend ceiling, if agreed."),
  cadence_cron: z
    .string()
    .optional()
    .describe(
      "5-field UTC cron for the heartbeat. Common: '0 16 * * *' daily 9am PT, '0 16 * * 1-5' weekdays, '0 16 * * 1' weekly Monday. Defaults to daily.",
    ),
});

async function handleProposeTargetTool(input: unknown): Promise<ToolResult> {
  const parsed = proposeTargetInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  if (rest.cadence_cron) {
    try {
      CronExpressionParser.parse(rest.cadence_cron, { tz: "UTC" });
    } catch {
      return { ok: false, error: `Invalid cadence_cron '${rest.cadence_cron}' — must be a 5-field cron expression.` };
    }
  }
  const r = handleProposeTarget(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(
    "Target recorded. Tell the user everything is set and point them at the START button on your Goal tab — the loop begins the moment they click it (the first tick runs immediately). You cannot start it yourself.",
  );
}

const amendGoalInput = z.object({
  ...goalIdFields,
  target_value: z.number().optional().describe("New target, if the user changed it."),
  deadline: z.string().optional().describe("New ISO deadline."),
  spend_envelope_usd: z.number().optional().describe("New total spend ceiling."),
  cadence_cron: z.string().optional().describe("New 5-field UTC heartbeat cron."),
});

async function handleAmendGoalTool(input: unknown): Promise<ToolResult> {
  const parsed = amendGoalInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  if (rest.cadence_cron) {
    try {
      CronExpressionParser.parse(rest.cadence_cron, { tz: "UTC" });
    } catch {
      return { ok: false, error: `Invalid cadence_cron '${rest.cadence_cron}' — must be a 5-field cron expression.` };
    }
  }
  const r = handleAmendGoal(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  const d = r.data;
  return txt(
    `Goal amended: target=${d.target_value ?? "—"}, deadline=${d.deadline ?? "none"}, envelope=${d.spend_envelope_usd !== null ? `$${d.spend_envelope_usd}` : "none"}, cadence=${d.cadence_cron}. Confirm the change back to the user.`,
  );
}

// ── log_goal_action ────────────────────────────────────────────────────

const logGoalActionInput = z.object({
  ...goalIdFields,
  kind: z
    .enum(["mutation", "research", "decision"])
    .describe(
      "mutation = a platform write (bid, budget, pause, creative). research = read-only investigation. decision = a strategic choice worth recording.",
    ),
  description: z
    .string()
    .min(1)
    .describe("What you did / are about to do. Be specific — quote IDs and dollar amounts."),
  resources_touched: z
    .string()
    .optional()
    .describe(
      "Comma-separated resource keys the action touches, e.g. 'campaign:123,adgroup:456'. Required for mutations.",
    ),
  expected_effect: z
    .string()
    .min(1)
    .describe("The falsifiable prediction, e.g. 'CPA -$3 within 7 days'. You will be scored against this at review time."),
  review_after_hours: z
    .number()
    .optional()
    .describe(
      "Observation window in hours before this action may be scored and its resources touched again. REQUIRED for mutations (72h+ waste pauses, 120h+ bid/budget, 168h+ creative/keywords).",
    ),
  spend_usd: z
    .number()
    .optional()
    .describe(
      "Estimated INCREMENTAL spend this action commits (e.g. a budget raise's expected extra cost until review). The platform sums these against the envelope and shows the total in every tick brief. Omit for spend-neutral actions.",
    ),
});

async function handleLogGoalActionTool(input: unknown): Promise<ToolResult> {
  const parsed = logGoalActionInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, resources_touched, ...rest } = parsed.data;
  const r = handleLogGoalAction(
    {
      ...rest,
      resources_touched: resources_touched
        ? resources_touched.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    },
    { project_slug, agent_id },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return txt(
    `action ${r.data.action_id} logged.${r.data.review_after ? ` Review due ${r.data.review_after}. Its resources are gated until then.` : ""}`,
  );
}

// ── review_goal_action ─────────────────────────────────────────────────

const reviewGoalActionInput = z.object({
  ...goalIdFields,
  action_id: z.string().min(1).describe("The open action you're scoring."),
  observed_outcome: z
    .string()
    .min(1)
    .describe("What actually happened vs. expected_effect, with the numbers."),
  abandoned: z
    .boolean()
    .optional()
    .describe("true when the action was reverted/obsoleted rather than measured."),
  learning: z
    .string()
    .optional()
    .describe("Optional durable learning to record alongside the review."),
});

async function handleReviewGoalActionTool(input: unknown): Promise<ToolResult> {
  const parsed = reviewGoalActionInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  const r = handleReviewGoalAction(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(
    `action ${r.data.action_id} ${r.data.status}.${r.data.learning_id ? ` Learning ${r.data.learning_id} recorded.` : ""}`,
  );
}

// ── log_learning / search_learnings ────────────────────────────────────

const logLearningInput = z.object({
  ...goalIdFields,
  body: z
    .string()
    .min(1)
    .describe("The durable fact, specific enough to act on later. Quote numbers."),
  confidence: z.enum(["low", "medium", "high"]).optional().describe("Default medium."),
  supersedes_id: z
    .string()
    .optional()
    .describe("Learning this replaces — supersede stale facts instead of contradicting them."),
});

async function handleLogLearningTool(input: unknown): Promise<ToolResult> {
  const parsed = logLearningInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  const r = handleLogLearning(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(`learning ${r.data.learning_id} recorded.`);
}

const searchLearningsInput = z.object({
  ...goalIdFields,
  query: z
    .string()
    .optional()
    .describe("Substring to search for. Omit to list the most recent learnings."),
  limit: z.number().optional().describe("Max results (default 20, cap 50)."),
});

async function handleSearchLearningsTool(input: unknown): Promise<ToolResult> {
  const parsed = searchLearningsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  const r = handleSearchLearnings(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify(r.data.learnings, null, 2));
}

// ── update_goal_status ─────────────────────────────────────────────────

const updateGoalStatusInput = z.object({
  ...goalIdFields,
  status: z
    .enum(["achieved", "failed", "paused"])
    .describe(
      "achieved = target met (verified against the measured metric). failed = can't be met (deadline/envelope/blocked). paused = needs the user before the loop can continue.",
    ),
  reason: z
    .string()
    .min(1)
    .describe("Evidence-based reason, quoting the measured metric."),
});

async function handleUpdateGoalStatusTool(input: unknown): Promise<ToolResult> {
  const parsed = updateGoalStatusInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  const r = handleUpdateGoalStatus(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(`goal ${r.data.goal_id} is now '${r.data.status}'.`);
}

// ── get_project / set_shared_context ───────────────────────────────────

const getProjectInput = z.object({ ...callerFields });

async function handleGetProjectTool(input: unknown): Promise<ToolResult> {
  const parsed = getProjectInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id } = parsed.data;
  const r = handleGetProject({}, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(JSON.stringify(r.data, null, 2));
}

const setSharedContextInput = z.object({
  ...callerFields,
  content: z
    .string()
    .min(1)
    .describe(
      "The FULL new shared context (markdown). This replaces the previous version — read the current one first (get_goal returns it) and edit, don't blindly overwrite.",
    ),
});

async function handleSetSharedContextTool(input: unknown): Promise<ToolResult> {
  const parsed = setSharedContextInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, content } = parsed.data;
  const r = await handleSetProjectBrief({ content }, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(
    `shared context updated (${r.data.bytes} bytes); ${r.data.synced_agents} agent identit${r.data.synced_agents === 1 ? "y" : "ies"} re-rendered.`,
  );
}

// ── register_pull_request ──────────────────────────────────────────────

const registerPullRequestInput = z.object({
  ...goalIdFields,
  url: z
    .string()
    .min(1)
    .describe(
      "The GitHub pull-request URL you just opened, e.g. https://github.com/owner/repo/pull/123.",
    ),
  title: z.string().min(1).max(200).describe("The PR title."),
  branch: z.string().optional().describe("The head branch name."),
  action_id: z
    .string()
    .optional()
    .describe(
      "The log_goal_action id this PR executes — link them so the observation gate and the PR travel together.",
    ),
});

async function handleRegisterPullRequestTool(
  input: unknown,
): Promise<ToolResult> {
  const parsed = registerPullRequestInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, agent_id, ...rest } = parsed.data;
  const r = await handleRegisterPullRequest(rest, { project_slug, agent_id });
  if (!r.ok) return { ok: false, error: r.error };
  return txt(
    `PR registered (state: ${r.data.state}). The user sees it on your Goal tab for review; every tick brief carries its live state (reviews, comments, merged/closed). Do NOT merge it yourself — the user does.`,
  );
}

// ── Registry ───────────────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  {
    name: "get_goal",
    description:
      "Fetch your goal's full state: spec, metric history, open actions (due-for-review vs still-gated), recent learnings and ticks, plus the shared workspace context. Call FIRST whenever you've lost context — this is the re-anchor tool.",
    inputSchema: getGoalInput,
    handler: handleGetGoalTool,
  },
  {
    name: "define_goal",
    description:
      "Intake step 1: record the ambition the user articulated in chat (statement + any stated deadline/spend envelope). Repeatable while the goal is in intake — refine as the conversation sharpens.",
    inputSchema: defineGoalInput,
    handler: handleDefineGoalTool,
  },
  {
    name: "propose_goal_metric",
    description:
      "Intake step 2: submit the metric definition you authored AND tested. The platform re-runs the exact tool call server-side; only a reproducible single number moves the goal to 'proposed' and records the baseline. Fails with the error if the query can't be verified — fix and propose again.",
    inputSchema: proposeGoalMetricInput,
    handler: handleProposeGoalMetricTool,
  },
  {
    name: "backfill_metric_history",
    description:
      "Reconstruct the metric's past: run a date-segmented version of the metric query (per-day values, ~30 days) so the user's progress chart has history from day one. Platform-verified like the metric; replaces any earlier backfill. Call during intake right after propose_goal_metric.",
    inputSchema: backfillHistoryInput,
    handler: handleBackfillHistoryTool,
  },
  {
    name: "propose_target",
    description:
      "Intake step 3: record the target/cadence/spend envelope the user agreed to in chat. This does NOT start the loop — the user clicks START on your Goal tab (platform-enforced consent), which also fires the first tick immediately. Rejects targets on the wrong side of the baseline.",
    inputSchema: proposeTargetInput,
    handler: handleProposeTargetTool,
  },
  {
    name: "amend_goal",
    description:
      "Adjust a LIVE goal when the user asks: new target, deadline, spend envelope, or heartbeat cadence. Active/paused goals only; echo the change back to the user after. Never amend without the user having asked.",
    inputSchema: amendGoalInput,
    handler: handleAmendGoalTool,
  },
  {
    name: "log_goal_action",
    description:
      "Record a move BEFORE executing it: what, which resources, the falsifiable expected effect, and the observation window (review_after_hours, required for mutations). Gated resources are untouchable until their review date. Unlogged mutations are invisible to future ticks — always log first.",
    inputSchema: logGoalActionInput,
    handler: handleLogGoalActionTool,
  },
  {
    name: "register_pull_request",
    description:
      "Record a pull request you just opened against the workspace's codebase (gh pr create → register here). The PR is the approval gate for code changes: the user reviews and merges on GitHub, the platform syncs its state (review decision, comments, merged/closed) into every tick brief, and your Goal tab shows it for review. Never merge your own PR.",
    inputSchema: registerPullRequestInput,
    handler: handleRegisterPullRequestTool,
  },
  {
    name: "review_goal_action",
    description:
      "Score an open action whose review date arrived: observed outcome vs. expected_effect, with numbers. Closes the measurement loop and (optionally) records a learning. Do this at the START of a tick, before any new move.",
    inputSchema: reviewGoalActionInput,
    handler: handleReviewGoalActionTool,
  },
  {
    name: "log_learning",
    description:
      "Write a durable fact to your own memory (survives context rotation). Use for anything future ticks must know: platform quirks, what worked, decisions made in chat. Supersede stale learnings instead of contradicting them.",
    inputSchema: logLearningInput,
    handler: handleLogLearningTool,
  },
  {
    name: "search_learnings",
    description:
      "Query your own memory. Call while orienting, before acting — check what you already know about a campaign/keyword/tactic before touching it.",
    inputSchema: searchLearningsInput,
    handler: handleSearchLearningsTool,
  },
  {
    name: "update_goal_status",
    description:
      "Declare your goal achieved / failed, or pause it. Requires an evidence-based reason; 'achieved' is rejected unless the measured metric actually meets the target. Resume and close belong to the user in the UI.",
    inputSchema: updateGoalStatusInput,
    handler: handleUpdateGoalStatusTool,
  },
  {
    name: "get_project",
    description:
      "Fetch project metadata: connected account ids (Google Ads / Meta / GSC), website, harness. Cheap re-anchor for platform facts.",
    inputSchema: getProjectInput,
    handler: handleGetProjectTool,
  },
  {
    name: "set_shared_context",
    description:
      "Rewrite the shared workspace context (PROJECT.md) — the brief EVERY agent in this workspace sees in its identity: what the company sells, who buys, positioning, voice, global constraints. Update it when you learn something all agents should know. Full replacement: read the current version first (get_goal returns it) and edit.",
    inputSchema: setSharedContextInput,
    handler: handleSetSharedContextTool,
  },
];

// Browser MCP tools live in their own server (notfair-browser) so this
// surface stays focused. See ./browser-tools.ts and the /api/mcp/browser
// route.

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
 * Minimal zod→JSON-schema conversion covering the shapes we use
 * (string / number / boolean / enum, optional, describe). Anything more
 * exotic falls back to `{type:"string"}` — the handler's safeParse is the
 * real validation.
 */
function zodObjectToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, raw] of Object.entries(schema.shape)) {
    let field = raw as z.ZodTypeAny;
    let isOptional = false;
    while (field instanceof z.ZodOptional || field instanceof z.ZodDefault) {
      isOptional = true;
      field = field._def.innerType as z.ZodTypeAny;
    }
    const description = (field as { description?: string }).description ?? (raw as { description?: string }).description;
    let prop: Record<string, unknown>;
    if (field instanceof z.ZodEnum) {
      prop = { type: "string", enum: field.options };
    } else if (field instanceof z.ZodNumber) {
      prop = { type: "number" };
    } else if (field instanceof z.ZodBoolean) {
      prop = { type: "boolean" };
    } else {
      prop = { type: "string" };
    }
    if (description) prop.description = description;
    properties[key] = prop;
    if (!isOptional) required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
