import {
  addGoalLearning,
  amendGoal,
  createGoalAction,
  defineGoal,
  getGoal,
  getGoalAction,
  listActionsDueForReview,
  listGatedActions,
  listGoalLearnings,
  listGatedActionsForOtherAgents,
  listGoalTicks,
  listMetricSnapshots,
  loggedSpendTotal,
  proposeTarget,
  recordMetricSnapshot,
  replaceBackfillSnapshots,
  reviewGoalAction,
  searchGoalLearnings,
  setGoalMetric,
  setGoalStatus,
  isTargetMet,
  type Goal,
  type GoalAction,
  type GoalLearning,
  type GoalTick,
  type MetricDirection,
} from "@/server/db/goals";
import { getProject } from "@/server/db/projects";
import { findMcpToken } from "@/server/mcp/tokens";
import {
  PROJECT_BRIEF_MAX_BYTES,
  readProjectBrief,
  writeProjectBrief,
} from "@/server/onboarding/project-brief";
import type { Project } from "@/types";
import { runHistorySource, runMetricSource } from "./metric";

/**
 * Handlers for NotFair's MCP tools — the goal agent's coordination
 * surface. Inputs are schema-validated upstream (zod in
 * mcp-server/tools.ts); context carries the caller's identity, and
 * cross-project / wrong-agent calls are rejected here.
 */

export type HandlerContext = {
  /** Project the caller is operating in. */
  project_slug: string;
  /** Caller's agent_id (the one making the change). */
  agent_id: string;
};

export type HandlerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Resolve + authorize a goal for the calling agent. */
function resolveGoal(
  goal_id: string,
  ctx: HandlerContext,
  opts: { requireOwner?: boolean } = {},
): HandlerResult<Goal> {
  const goal = getGoal(goal_id);
  if (!goal) return { ok: false, error: `Unknown goal_id '${goal_id}'` };
  if (goal.project_slug !== ctx.project_slug) {
    return { ok: false, error: `Cross-project goal access rejected on '${goal_id}'` };
  }
  if (opts.requireOwner && goal.agent_id !== ctx.agent_id) {
    return {
      ok: false,
      error: `Goal '${goal_id}' is owned by '${goal.agent_id}', not '${ctx.agent_id}'`,
    };
  }
  return { ok: true, data: goal };
}

// ── get_goal ─────────────────────────────────────────────────────────────

export type GoalStateView = {
  goal: Goal;
  target_met: boolean | null;
  actions_due_for_review: GoalAction[];
  actions_gated: GoalAction[];
  recent_learnings: GoalLearning[];
  recent_ticks: Array<Pick<GoalTick, "tick_number" | "status" | "metric_value" | "summary" | "started_at">>;
  metric_history: Array<{ value: number; created_at: string }>;
  /** Sum of spend_usd across your logged (non-abandoned) actions. */
  logged_spend_usd: number;
  /** Other agents' still-gated resources in this workspace — equally untouchable. */
  gated_by_other_agents: Array<{ agent_id: string; description: string; resources: string[]; until: string | null }>;
  /** Shared workspace context (PROJECT.md) — same for every agent. */
  shared_context: string | null;
};

export async function handleGetGoal(
  input: { goal_id: string },
  ctx: HandlerContext,
): Promise<HandlerResult<GoalStateView>> {
  const r = resolveGoal(input.goal_id, ctx);
  if (!r.ok) return r;
  const goal = r.data;
  const shared_context = await readProjectBrief(ctx.project_slug).catch(() => null);
  return {
    ok: true,
    data: {
      goal,
      target_met: isTargetMet(goal),
      actions_due_for_review: listActionsDueForReview(goal.id),
      actions_gated: listGatedActions(goal.id),
      recent_learnings: listGoalLearnings(goal.id, 15),
      recent_ticks: listGoalTicks(goal.id, 5).map((t) => ({
        tick_number: t.tick_number,
        status: t.status,
        metric_value: t.metric_value,
        summary: t.summary,
        started_at: t.started_at,
      })),
      metric_history: listMetricSnapshots(goal.id, 30).map((s) => ({
        value: s.value,
        created_at: s.created_at,
      })),
      logged_spend_usd: loggedSpendTotal(goal.id),
      gated_by_other_agents: listGatedActionsForOtherAgents(ctx.project_slug, goal.id).map(
        (a) => ({
          agent_id: a.agent_id,
          description: a.description,
          resources: JSON.parse(a.resources_touched_json || "[]") as string[],
          until: a.review_after,
        }),
      ),
      shared_context,
    },
  };
}

// ── define_goal (chat intake, step 1) ────────────────────────────────────

export type DefineGoalInput = {
  goal_id: string;
  statement: string;
  short_label: string;
  deadline?: string;
  spend_envelope_usd?: number;
};

/**
 * Record the ambition the user articulated in chat. Repeatable while the
 * goal is in intake (the statement sharpens as the conversation does).
 */
export function handleDefineGoal(
  input: DefineGoalInput,
  ctx: HandlerContext,
): HandlerResult<{ goal_id: string; statement: string }> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;
  const updated = defineGoal(input.goal_id, {
    statement: input.statement.trim(),
    short_label: input.short_label.trim().slice(0, 48),
    deadline: input.deadline ?? null,
    spend_envelope_usd: input.spend_envelope_usd ?? null,
  });
  if (!updated) {
    return {
      ok: false,
      error: `Goal is '${r.data.status}', not 'intake' — the goal is already defined. Use log_learning to record refinements.`,
    };
  }
  void syncIdentity(updated);
  return { ok: true, data: { goal_id: updated.id, statement: updated.statement } };
}

// ── propose_goal_metric (chat intake, step 2) ────────────────────────────

export type ProposeGoalMetricInput = {
  goal_id: string;
  metric_name: string;
  metric_source_key: string;
  metric_source_tool: string;
  metric_source_args_json: string;
  metric_direction: MetricDirection;
};

/**
 * Intake's verification gate. The agent submits the metric it authored +
 * tested; we re-run the exact query server-side. Only a reproducible
 * number moves the goal to `proposed` — "trust me, the query works"
 * doesn't.
 */
export async function handleProposeGoalMetric(
  input: ProposeGoalMetricInput,
  ctx: HandlerContext,
): Promise<HandlerResult<{ goal_id: string; baseline_value: number; status: string }>> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;
  const goal = r.data;
  if (goal.status !== "intake") {
    return {
      ok: false,
      error: `Goal is '${goal.status}', not 'intake' — the metric is already set.`,
    };
  }
  if (!goal.statement.trim()) {
    return {
      ok: false,
      error: "Define the goal first (define_goal) — a metric needs an ambition to measure.",
    };
  }
  if (!findMcpToken(ctx.project_slug, input.metric_source_key)) {
    return {
      ok: false,
      error: `No connected MCP '${input.metric_source_key}' for this project. Use a connected data source.`,
    };
  }

  const measured = await runMetricSource(ctx.project_slug, {
    key: input.metric_source_key,
    tool: input.metric_source_tool,
    args_json: input.metric_source_args_json,
  });
  if (!measured.ok) {
    return {
      ok: false,
      error: `Server-side verification failed — fix the query and propose again. ${measured.error}`,
    };
  }

  const updated = setGoalMetric(goal.id, {
    metric_name: input.metric_name,
    metric_source_key: input.metric_source_key,
    metric_source_tool: input.metric_source_tool,
    metric_source_args_json: input.metric_source_args_json,
    metric_direction: input.metric_direction,
    baseline_value: measured.value,
  });
  if (!updated) {
    return { ok: false, error: "Goal left intake while verifying — nothing written." };
  }
  recordMetricSnapshot(goal.id, measured.value, "intake");
  void syncIdentity(updated);

  return {
    ok: true,
    data: { goal_id: goal.id, baseline_value: measured.value, status: updated.status },
  };
}

// ── backfill_metric_history ──────────────────────────────────────────────

export type BackfillHistoryInput = {
  goal_id: string;
  source_key: string;
  source_tool: string;
  source_args_json: string;
};

/**
 * Reconstruct the metric's past from a date-segmented query so the
 * progress chart has context from day one. The platform runs the query
 * itself (same trust rule as the metric), validates the {date, value}
 * shape, and REPLACES any prior backfill — live snapshots are untouched.
 */
export async function handleBackfillHistory(
  input: BackfillHistoryInput,
  ctx: HandlerContext,
): Promise<HandlerResult<{ goal_id: string; points: number; from: string; to: string }>> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;
  const goal = r.data;
  if (!findMcpToken(ctx.project_slug, input.source_key)) {
    return { ok: false, error: `No connected MCP '${input.source_key}' for this project.` };
  }
  const run = await runHistorySource(ctx.project_slug, {
    key: input.source_key,
    tool: input.source_tool,
    args_json: input.source_args_json,
  });
  if (!run.ok) return { ok: false, error: run.error };
  // Only backdated points make sense — drop anything in the future.
  const nowIso = new Date().toISOString();
  const points = run.points.filter((p) => p.date <= nowIso);
  if (points.length === 0) {
    return { ok: false, error: "History query returned no past-dated points." };
  }
  replaceBackfillSnapshots(
    goal.id,
    points.map((p) => ({ value: p.value, created_at: p.date })),
  );
  return {
    ok: true,
    data: {
      goal_id: goal.id,
      points: points.length,
      from: points[0]!.date.slice(0, 10),
      to: points[points.length - 1]!.date.slice(0, 10),
    },
  };
}

// ── propose_target (chat intake, step 3) ─────────────────────────────────

function targetDirectionError(
  goal: Goal,
  target_value: number,
  mode: "achieve" | "maintain",
): string | null {
  // MAINTAIN targets sit on the ALREADY-MET side by design: "stay above a
  // 75k floor" when today's number is 82k, or "hold wasted spend at $0".
  // The direction check only makes sense for ACHIEVE goals, where a target
  // on the wrong side of the baseline is nonsense (equality allowed).
  if (mode === "maintain") return null;
  if (goal.metric_direction === "decrease" && goal.baseline_value !== null && target_value > goal.baseline_value) {
    return `Direction is 'decrease' but target (${target_value}) is above the baseline (${goal.baseline_value}).`;
  }
  if (goal.metric_direction === "increase" && goal.baseline_value !== null && target_value < goal.baseline_value) {
    return `Direction is 'increase' but target (${target_value}) is below the baseline (${goal.baseline_value}).`;
  }
  return null;
}

export type ProposeTargetToolInput = {
  goal_id: string;
  target_value: number;
  mode?: "achieve" | "maintain";
  deadline?: string;
  spend_envelope_usd?: number;
  cadence_cron?: string;
};

/**
 * Record the target/cadence/envelope the user agreed to in chat. Does NOT
 * start the loop — the user clicks "Start the loop" on the Goal tab.
 * That click is the platform-enforced consent moment: an agent cannot
 * start spending cycles (or money) on its own say-so.
 */
export function handleProposeTarget(
  input: ProposeTargetToolInput,
  ctx: HandlerContext,
): HandlerResult<{ goal_id: string; status: string }> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;
  const goal = r.data;
  if (goal.status !== "proposed") {
    return {
      ok: false,
      error: `Goal is '${goal.status}', not 'proposed' — verify a metric first (propose_goal_metric).`,
    };
  }
  const dirErr = targetDirectionError(goal, input.target_value, input.mode ?? goal.mode);
  if (dirErr) return { ok: false, error: dirErr };
  let updated: Goal | null;
  try {
    updated = proposeTarget(goal.id, {
      target_value: input.target_value,
      mode: input.mode,
      deadline: input.deadline,
      spend_envelope_usd: input.spend_envelope_usd,
      cadence_cron: input.cadence_cron,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!updated) return { ok: false, error: "Goal left 'proposed' while recording the target." };
  void syncIdentity(updated);
  return { ok: true, data: { goal_id: updated.id, status: updated.status } };
}

// ── amend_goal (live adjustments) ────────────────────────────────────────

export type AmendGoalToolInput = {
  goal_id: string;
  target_value?: number;
  deadline?: string;
  spend_envelope_usd?: number;
  cadence_cron?: string;
};

/**
 * Adjust a live goal's parameters when the user asks in chat — "raise my
 * envelope to $3k", "make the target 25". Active or paused goals only.
 */
export function handleAmendGoal(
  input: AmendGoalToolInput,
  ctx: HandlerContext,
): HandlerResult<{ goal_id: string; target_value: number | null; deadline: string | null; spend_envelope_usd: number | null; cadence_cron: string }> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;
  const goal = r.data;
  if (goal.status !== "active" && goal.status !== "paused") {
    return {
      ok: false,
      error: `Goal is '${goal.status}' — amend applies to active/paused goals. Use the intake tools before the loop starts.`,
    };
  }
  if (
    input.target_value === undefined &&
    input.deadline === undefined &&
    input.spend_envelope_usd === undefined &&
    input.cadence_cron === undefined
  ) {
    return { ok: false, error: "Nothing to amend — pass at least one field." };
  }
  if (input.target_value !== undefined) {
    const dirErr = targetDirectionError(goal, input.target_value, goal.mode);
    if (dirErr) return { ok: false, error: dirErr };
  }
  let updated: Goal | null;
  try {
    updated = amendGoal(goal.id, input);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!updated) return { ok: false, error: "Goal changed state while amending." };
  void syncIdentity(updated);
  return {
    ok: true,
    data: {
      goal_id: updated.id,
      target_value: updated.target_value,
      deadline: updated.deadline,
      spend_envelope_usd: updated.spend_envelope_usd,
      cadence_cron: updated.cadence_cron,
    },
  };
}

// ── log_goal_action ──────────────────────────────────────────────────────

export type LogGoalActionInput = {
  goal_id: string;
  kind: "mutation" | "research" | "decision";
  description: string;
  resources_touched?: string[];
  expected_effect: string;
  review_after_hours?: number;
  spend_usd?: number;
};

export function handleLogGoalAction(
  input: LogGoalActionInput,
  ctx: HandlerContext,
): HandlerResult<{ action_id: string; review_after: string | null }> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;
  const goal = r.data;

  if (input.kind === "mutation" && !input.review_after_hours) {
    return {
      ok: false,
      error:
        "Mutations require review_after_hours — the observation window is what keeps the loop honest. Pick per the skill guidance (72h+ for waste pauses, 120h+ for bid/budget changes).",
    };
  }

  const review_after = input.review_after_hours
    ? new Date(Date.now() + input.review_after_hours * 3_600_000).toISOString()
    : null;

  const action = createGoalAction({
    goal_id: goal.id,
    tick_number: goal.tick_count || null,
    kind: input.kind,
    description: input.description,
    resources_touched: input.resources_touched ?? [],
    expected_effect: input.expected_effect,
    review_after,
    spend_usd: input.spend_usd ?? null,
  });
  return { ok: true, data: { action_id: action.id, review_after: action.review_after } };
}

// ── review_goal_action ───────────────────────────────────────────────────

export type ReviewGoalActionInput = {
  goal_id: string;
  action_id: string;
  observed_outcome: string;
  abandoned?: boolean;
  learning?: string;
};

export function handleReviewGoalAction(
  input: ReviewGoalActionInput,
  ctx: HandlerContext,
): HandlerResult<{ action_id: string; status: string; learning_id: string | null }> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;

  const action = getGoalAction(input.action_id);
  if (!action || action.goal_id !== input.goal_id) {
    return { ok: false, error: `Unknown action_id '${input.action_id}' on this goal` };
  }
  const reviewed = reviewGoalAction(
    input.action_id,
    input.observed_outcome,
    input.abandoned ? "abandoned" : "reviewed",
  );
  if (!reviewed) {
    return { ok: false, error: `Action '${input.action_id}' is not open — already reviewed?` };
  }

  let learning_id: string | null = null;
  if (input.learning) {
    learning_id = addGoalLearning(input.goal_id, input.learning, "medium").id;
  }
  return { ok: true, data: { action_id: reviewed.id, status: reviewed.status, learning_id } };
}

// ── log_learning / search_learnings (per-agent memory) ───────────────────

export function handleLogLearning(
  input: {
    goal_id: string;
    body: string;
    confidence?: "low" | "medium" | "high";
    supersedes_id?: string;
  },
  ctx: HandlerContext,
): HandlerResult<{ learning_id: string }> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;
  const learning = addGoalLearning(
    input.goal_id,
    input.body,
    input.confidence ?? "medium",
    input.supersedes_id ?? null,
  );
  return { ok: true, data: { learning_id: learning.id } };
}

export function handleSearchLearnings(
  input: { goal_id: string; query?: string; limit?: number },
  ctx: HandlerContext,
): HandlerResult<{ learnings: GoalLearning[] }> {
  const r = resolveGoal(input.goal_id, ctx);
  if (!r.ok) return r;
  const limit = Math.min(input.limit ?? 20, 50);
  const learnings = input.query
    ? searchGoalLearnings(input.goal_id, input.query, limit)
    : listGoalLearnings(input.goal_id, limit);
  return { ok: true, data: { learnings } };
}

// ── update_goal_status ───────────────────────────────────────────────────

export type UpdateGoalStatusInput = {
  goal_id: string;
  status: "achieved" | "failed" | "paused";
  reason: string;
};

export function handleUpdateGoalStatus(
  input: UpdateGoalStatusInput,
  ctx: HandlerContext,
): HandlerResult<{ goal_id: string; status: string }> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;
  const goal = r.data;

  if (input.status === "achieved") {
    if (goal.mode === "maintain") {
      return {
        ok: false,
        error:
          "This is a MAINTAIN goal — holding the number at target is the job, not the finish line. Keep watching; the user pauses or closes it from the Goal page when they no longer want the watchdog.",
      };
    }
    const met = isTargetMet(goal);
    if (met === false) {
      return {
        ok: false,
        error: `The measured metric (${goal.current_value}) has not met the target (${goal.target_value}). A goal is achieved when the number says so.`,
      };
    }
  }

  const updated = setGoalStatus(goal.id, input.status, input.reason);
  if (!updated) return { ok: false, error: `Unknown goal_id '${input.goal_id}'` };
  if (updated.status !== input.status) {
    return { ok: false, error: `Goal is terminal ('${updated.status}') — status is final.` };
  }
  return { ok: true, data: { goal_id: updated.id, status: updated.status } };
}

// ── shared workspace context ─────────────────────────────────────────────

export function handleGetProject(
  _input: Record<string, never>,
  ctx: HandlerContext,
): HandlerResult<Project> {
  const project = getProject(ctx.project_slug);
  if (!project) return { ok: false, error: `Unknown project '${ctx.project_slug}'` };
  return { ok: true, data: project };
}

/**
 * Rewrite the shared workspace context (PROJECT.md) — visible to EVERY
 * agent in the project. Re-renders every goal agent's identity so the new
 * context lands on their next turn.
 */
export async function handleSetProjectBrief(
  input: { content: string },
  ctx: HandlerContext,
): Promise<HandlerResult<{ bytes: number; synced_agents: number }>> {
  const project = getProject(ctx.project_slug);
  if (!project) return { ok: false, error: `Unknown project '${ctx.project_slug}'` };
  const content = input.content.trim();
  if (!content) return { ok: false, error: "Shared context cannot be empty." };
  if (Buffer.byteLength(content, "utf8") > PROJECT_BRIEF_MAX_BYTES) {
    return {
      ok: false,
      error: `Shared context exceeds ${PROJECT_BRIEF_MAX_BYTES} bytes — keep it a curated brief, not a dump.`,
    };
  }
  await writeProjectBrief(ctx.project_slug, content);
  const { syncProjectAgents } = await import("./provision");
  const synced = await syncProjectAgents(ctx.project_slug);
  return { ok: true, data: { bytes: Buffer.byteLength(content, "utf8"), synced_agents: synced } };
}

/** Best-effort identity re-render after a goal spec change. */
function syncIdentity(goal: Goal): Promise<void> {
  return import("./provision")
    .then(({ syncGoalIdentity }) => syncGoalIdentity(goal))
    .catch((err) => console.warn("[goal-handlers] identity sync failed:", err));
}

// ── register_pull_request ───────────────────────────────────────────────

export type RegisterPullRequestInput = {
  goal_id: string;
  url: string;
  title: string;
  branch?: string;
  action_id?: string;
};

const GITHUB_PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/;

/**
 * Record a pull request the agent just opened against the workspace's
 * codebase. The PR is the approval gate for code mutations: the platform
 * syncs its state from GitHub on every tick and surfaces it to the user
 * for review — the agent never merges its own PR.
 */
export async function handleRegisterPullRequest(
  input: RegisterPullRequestInput,
  ctx: HandlerContext,
): Promise<HandlerResult<{ pr_id: string; state: string }>> {
  const r = resolveGoal(input.goal_id, ctx, { requireOwner: true });
  if (!r.ok) return r;
  const goal = r.data;

  const url = input.url.trim().replace(/\/$/, "");
  if (!GITHUB_PR_URL.test(url)) {
    return {
      ok: false,
      error:
        "url must be a GitHub pull-request URL like https://github.com/owner/repo/pull/123.",
    };
  }
  if (input.action_id) {
    const action = getGoalAction(input.action_id);
    if (!action || action.goal_id !== goal.id) {
      return {
        ok: false,
        error: `action_id '${input.action_id}' is not an action of this goal.`,
      };
    }
  }

  const { createGoalPr, findGoalPrByUrl } = await import("@/server/db/goal-prs");
  const existing = findGoalPrByUrl(goal.id, url);
  const pr =
    existing ??
    createGoalPr({
      goal_id: goal.id,
      url,
      title: input.title.trim(),
      branch: input.branch?.trim() || null,
      action_id: input.action_id ?? null,
    });

  // Pull the live state right away so the UI's review callout and the
  // next tick brief start accurate. Best-effort — a gh hiccup lands on
  // the row's sync_error, not on this call.
  const { syncGoalPrs } = await import("./pr-sync");
  await syncGoalPrs(goal.id);
  const { getGoalPr } = await import("@/server/db/goal-prs");
  const fresh = getGoalPr(pr.id) ?? pr;

  return {
    ok: true,
    data: { pr_id: fresh.id, state: fresh.state },
  };
}
