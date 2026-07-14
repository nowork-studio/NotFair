import { randomUUID } from "node:crypto";
import { getDb } from "./db";

/**
 * Pull requests a goal agent opened against the workspace's codebase.
 *
 * A PR row is the loop's handle on a code mutation: the agent registers
 * the PR right after `gh pr create` (via the `register_pull_request`
 * tool), the platform syncs its state from GitHub (`gh pr view`) at tick
 * time and on goal-page views, and the tick brief carries the live state —
 * so the agent reacts to review comments, and merge/close are facts the
 * loop observes rather than claims.
 */

export type GoalPrState = "open" | "merged" | "closed";

export type GoalPr = {
  id: string;
  goal_id: string;
  action_id: string | null;
  url: string;
  title: string;
  branch: string | null;
  state: GoalPrState;
  /** GitHub reviewDecision (APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED
   *  / "" for repos without required reviews). Null until first sync. */
  review_decision: string | null;
  comment_count: number;
  is_draft: boolean;
  merged_at: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
};

type GoalPrRow = Omit<GoalPr, "is_draft"> & { is_draft: number };

function mapRow(row: GoalPrRow): GoalPr {
  return { ...row, is_draft: !!row.is_draft };
}

export function createGoalPr(input: {
  goal_id: string;
  url: string;
  title: string;
  branch?: string | null;
  action_id?: string | null;
}): GoalPr {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT OR IGNORE INTO goal_prs (id, goal_id, action_id, url, title, branch, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.goal_id,
    input.action_id ?? null,
    input.url,
    input.title,
    input.branch ?? null,
    now,
    now,
  );
  // UNIQUE(goal_id, url) makes registration idempotent even when two tool
  // calls race between their read and insert. The winner's row is canonical.
  return findGoalPrByUrl(input.goal_id, input.url)!;
}

export function getGoalPr(id: string): GoalPr | null {
  const row = getDb()
    .prepare("SELECT * FROM goal_prs WHERE id = ?")
    .get(id) as GoalPrRow | undefined;
  return row ? mapRow(row) : null;
}

export function findGoalPrByUrl(goal_id: string, url: string): GoalPr | null {
  const row = getDb()
    .prepare("SELECT * FROM goal_prs WHERE goal_id = ? AND url = ?")
    .get(goal_id, url) as GoalPrRow | undefined;
  return row ? mapRow(row) : null;
}

export function listGoalPrs(goal_id: string, limit = 50): GoalPr[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM goal_prs WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(goal_id, limit) as GoalPrRow[];
  return rows.map(mapRow);
}

/** PRs still awaiting a GitHub outcome — the ones worth syncing. */
export function listOpenGoalPrs(goal_id: string): GoalPr[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM goal_prs WHERE goal_id = ? AND state = 'open' ORDER BY created_at DESC",
    )
    .all(goal_id) as GoalPrRow[];
  return rows.map(mapRow);
}

/**
 * Open PRs across a project's goals that are waiting on the user — feeds
 * the goals-index "PR awaiting your review" tag. A PR waits on the user
 * unless GitHub says changes were requested (then the ball is back with
 * the agent).
 */
export function listPrsAwaitingReview(project_slug: string): GoalPr[] {
  const rows = getDb()
    .prepare(
      `SELECT p.* FROM goal_prs p
       JOIN goals g ON g.id = p.goal_id
       WHERE g.project_slug = ? AND p.state = 'open' AND p.is_draft = 0
         AND (p.review_decision IS NULL OR p.review_decision != 'CHANGES_REQUESTED')
       ORDER BY p.created_at DESC`,
    )
    .all(project_slug) as GoalPrRow[];
  return rows.map(mapRow);
}

export function applyGoalPrSync(
  id: string,
  sync: {
    state: GoalPrState;
    title?: string | null;
    review_decision: string | null;
    comment_count: number;
    is_draft: boolean;
    merged_at: string | null;
  },
): GoalPr | null {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE goal_prs
     SET state = ?, title = COALESCE(?, title), review_decision = ?,
         comment_count = ?, is_draft = ?, merged_at = ?,
         last_synced_at = ?, sync_error = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(
    sync.state,
    sync.title ?? null,
    sync.review_decision,
    sync.comment_count,
    sync.is_draft ? 1 : 0,
    sync.merged_at,
    now,
    now,
    id,
  );
  return getGoalPr(id);
}

export function markGoalPrSyncError(id: string, error: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE goal_prs SET sync_error = ?, last_synced_at = ?, updated_at = ? WHERE id = ?",
    )
    .run(error.slice(0, 500), now, now, id);
}
