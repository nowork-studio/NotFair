import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  applyGoalPrSync,
  listOpenGoalPrs,
  markGoalPrSyncError,
  type GoalPr,
  type GoalPrState,
} from "@/server/db/goal-prs";

const execFileAsync = promisify(execFile);

/**
 * Sync goal PRs against GitHub via the user's authenticated `gh` CLI —
 * the same auth path the agent used to open the PR, so private repos
 * just work and we hold no GitHub token ourselves.
 *
 * Called from the tick runner (fresh state in every brief) and from the
 * goal page when rows look stale. Failures are recorded per-row and never
 * throw: a broken `gh` shouldn't stop a tick, and the UI shows the last
 * good state plus the sync error.
 */

type GhPrView = {
  state?: string; // OPEN | MERGED | CLOSED
  title?: string;
  reviewDecision?: string;
  isDraft?: boolean;
  mergedAt?: string | null;
  comments?: unknown[];
  reviews?: unknown[];
};

const GH_FIELDS = "state,title,reviewDecision,isDraft,mergedAt,comments,reviews";

/** Map GitHub's state string to our row state. Unknown → keep "open". */
export function ghStateToPrState(state: string | undefined): GoalPrState {
  switch ((state ?? "").toUpperCase()) {
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    default:
      return "open";
  }
}

/** Parse a `gh pr view --json` payload into the row-sync shape. */
export function parseGhPrView(payload: unknown): {
  state: GoalPrState;
  title: string | null;
  review_decision: string | null;
  comment_count: number;
  is_draft: boolean;
  merged_at: string | null;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const view = payload as GhPrView;
  const comments = Array.isArray(view.comments) ? view.comments.length : 0;
  const reviews = Array.isArray(view.reviews) ? view.reviews.length : 0;
  return {
    state: ghStateToPrState(view.state),
    title: typeof view.title === "string" && view.title.trim() ? view.title : null,
    review_decision:
      typeof view.reviewDecision === "string" ? view.reviewDecision : null,
    comment_count: comments + reviews,
    is_draft: !!view.isDraft,
    merged_at: typeof view.mergedAt === "string" ? view.mergedAt : null,
  };
}

async function syncOnePr(pr: GoalPr): Promise<GoalPr | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", pr.url, "--json", GH_FIELDS],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed = parseGhPrView(JSON.parse(stdout));
    if (!parsed) {
      markGoalPrSyncError(pr.id, "gh returned an unexpected payload shape");
      return null;
    }
    return applyGoalPrSync(pr.id, parsed);
  } catch (err) {
    markGoalPrSyncError(pr.id, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Sync every non-terminal PR for a goal. Never throws. */
export async function syncGoalPrs(goal_id: string): Promise<void> {
  const open = listOpenGoalPrs(goal_id);
  for (const pr of open) {
    await syncOnePr(pr);
  }
}

/**
 * Fire-and-forget staleness sweep for page renders: sync when any open
 * PR hasn't been checked in `maxAgeMs`. Rendering never awaits GitHub.
 */
export function maybeSyncGoalPrs(goal_id: string, maxAgeMs = 120_000): void {
  const open = listOpenGoalPrs(goal_id);
  const cutoff = Date.now() - maxAgeMs;
  const stale = open.some(
    (pr) => !pr.last_synced_at || Date.parse(pr.last_synced_at) < cutoff,
  );
  if (!stale) return;
  void syncGoalPrs(goal_id).catch((err) =>
    console.error(`[pr-sync] background sync failed for goal ${goal_id}:`, err),
  );
}
