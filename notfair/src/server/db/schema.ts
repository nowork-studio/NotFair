/**
 * The full NotFair schema, applied idempotently on boot. One file, one
 * source of truth — no migration history. If the shape needs to change,
 * change it here (existing dev databases can be recreated; there is no
 * multi-tenant fleet to migrate).
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  archived_at  TEXT,
  google_ads_account_id TEXT,
  meta_ads_account_id   TEXT,
  gsc_property_id       TEXT,
  website_url           TEXT,
  codebase_path         TEXT,
  harness_adapter       TEXT NOT NULL DEFAULT 'claude-code-local',
  hidden_mcp_preset_keys_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  project_slug        TEXT NOT NULL REFERENCES projects(slug),
  agent_id            TEXT NOT NULL,
  label               TEXT NOT NULL,
  harness_adapter     TEXT NOT NULL,
  harness_session_id  TEXT,
  title               TEXT,
  pinned_at           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE(project_slug, agent_id, label)
);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(project_slug, agent_id);

CREATE TABLE IF NOT EXISTS transcript_events (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('user','delta','tool','lifecycle','final','error')),
  payload_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcript_events_session ON transcript_events(session_id, seq);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id                TEXT PRIMARY KEY,
  project_slug      TEXT NOT NULL REFERENCES projects(slug),
  server_name       TEXT NOT NULL,
  account_label     TEXT NOT NULL DEFAULT '',
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at        TEXT,
  scope             TEXT,
  metadata_json     TEXT,
  token_endpoint    TEXT,
  client_id         TEXT,
  client_secret     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(project_slug, server_name, account_label)
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_project ON mcp_tokens(project_slug);

CREATE TABLE IF NOT EXISTS user_mcp_servers (
  id            TEXT PRIMARY KEY,
  project_slug  TEXT NOT NULL REFERENCES projects(slug),
  key           TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  resource_url  TEXT NOT NULL,
  discovery_url TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(project_slug, key)
);
CREATE INDEX IF NOT EXISTS idx_user_mcp_servers_project ON user_mcp_servers(project_slug);

CREATE TABLE IF NOT EXISTS goals (
  id            TEXT PRIMARY KEY,
  project_slug  TEXT NOT NULL REFERENCES projects(slug),
  agent_id      TEXT NOT NULL,
  statement     TEXT NOT NULL,
  short_label   TEXT,
  status        TEXT NOT NULL DEFAULT 'intake'
                CHECK (status IN ('intake','proposed','active','paused','achieved','failed','killed')),
  status_reason TEXT,
  mode          TEXT NOT NULL DEFAULT 'achieve'
                CHECK (mode IN ('achieve','maintain')),
  -- Executable metric definition (filled by intake via propose_goal_metric).
  metric_name             TEXT,
  metric_source_key       TEXT,
  metric_source_tool      TEXT,
  metric_source_args_json TEXT,
  metric_direction        TEXT CHECK (metric_direction IN ('increase','decrease')),
  baseline_value REAL,
  current_value  REAL,
  target_value   REAL,
  deadline           TEXT,
  spend_envelope_usd REAL,
  -- Loop cadence + state. next_tick_at is advanced by the tick runner the
  -- moment a tick starts, as a double-fire guard.
  cadence_cron TEXT NOT NULL DEFAULT '0 16 * * *',
  next_tick_at TEXT,
  last_tick_at TEXT,
  tick_count   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_slug, status);
CREATE INDEX IF NOT EXISTS idx_goals_due ON goals(status, next_tick_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_one_live_per_agent
  ON goals(agent_id)
  WHERE status IN ('intake','proposed','active','paused');

-- Goal groups are dashboard/navigation containers. Membership is kept in a
-- separate table so existing CREATE-IF-NOT-EXISTS databases gain grouping
-- without altering the goals table. goal_id is the primary key, enforcing
-- the product rule that one goal belongs to at most one group.
CREATE TABLE IF NOT EXISTS goal_groups (
  id           TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL REFERENCES projects(slug) ON DELETE CASCADE,
  name         TEXT NOT NULL COLLATE NOCASE,
  description  TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(project_slug, name)
);
CREATE INDEX IF NOT EXISTS idx_goal_groups_project
  ON goal_groups(project_slug, sort_order, created_at);

CREATE TABLE IF NOT EXISTS goal_group_memberships (
  goal_id    TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES goal_groups(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_group_memberships_group
  ON goal_group_memberships(group_id, created_at);

CREATE TABLE IF NOT EXISTS goal_actions (
  id          TEXT PRIMARY KEY,
  goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  tick_number INTEGER,
  kind        TEXT NOT NULL DEFAULT 'mutation'
              CHECK (kind IN ('mutation','research','decision')),
  description TEXT NOT NULL,
  resources_touched_json TEXT NOT NULL DEFAULT '[]',
  expected_effect TEXT NOT NULL,
  spend_usd   REAL,
  -- Measurement-maturity gate: the agent may not touch the same resources
  -- again (and must score this action) once now >= review_after.
  review_after TEXT,
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','reviewed','abandoned')),
  observed_outcome TEXT,
  reviewed_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_actions_goal ON goal_actions(goal_id, status);

CREATE TABLE IF NOT EXISTS goal_metric_snapshots (
  id      TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  value   REAL NOT NULL,
  source  TEXT NOT NULL DEFAULT 'tick'
          CHECK (source IN ('intake','tick','manual','backfill')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_snapshots_goal
  ON goal_metric_snapshots(goal_id, created_at);

-- Supporting metrics: extra numbers the loop measures alongside the goal's
-- primary metric (leading indicators, diagnostics). No target semantics —
-- the goal is still judged on the ONE primary metric. Self-contained tables
-- (not columns on goals/goal_metric_snapshots) because schema boot is
-- CREATE-IF-NOT-EXISTS only: existing databases never gain columns.
CREATE TABLE IF NOT EXISTS goal_support_metrics (
  id               TEXT PRIMARY KEY,
  goal_id          TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  source_key       TEXT NOT NULL,
  source_tool      TEXT NOT NULL,
  source_args_json TEXT NOT NULL,
  direction        TEXT CHECK (direction IN ('increase','decrease')),
  baseline_value   REAL NOT NULL,
  current_value    REAL NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE(goal_id, name)
);

CREATE TABLE IF NOT EXISTS goal_support_metric_snapshots (
  id         TEXT PRIMARY KEY,
  metric_id  TEXT NOT NULL REFERENCES goal_support_metrics(id) ON DELETE CASCADE,
  value      REAL NOT NULL,
  source     TEXT NOT NULL DEFAULT 'tick' CHECK (source IN ('verify','tick','backfill')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_support_snapshots_metric
  ON goal_support_metric_snapshots(metric_id, created_at);

-- Sidebar pins: pinned goals sort to the top of the goal rail. A separate
-- table (not a column on goals) because schema boot is CREATE-IF-NOT-EXISTS
-- only: existing databases never gain columns.
CREATE TABLE IF NOT EXISTS goal_pins (
  goal_id    TEXT PRIMARY KEY REFERENCES goals(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_learnings (
  id      TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  body    TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium'
             CHECK (confidence IN ('low','medium','high')),
  superseded_by TEXT REFERENCES goal_learnings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_learnings_goal
  ON goal_learnings(goal_id, created_at);

CREATE TABLE IF NOT EXISTS goal_suggestions (
  id           TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL REFERENCES projects(slug),
  source_key   TEXT NOT NULL,
  -- Stable heuristic id (e.g. 'wasted-spend'). One row per kind per
  -- source: regeneration updates open rows in place, and dismissed or
  -- accepted kinds keep their status instead of resurfacing.
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  statement    TEXT NOT NULL,
  mode         TEXT NOT NULL DEFAULT 'achieve'
               CHECK (mode IN ('achieve','maintain')),
  -- Evidence sentence with the real account numbers that justify it.
  rationale    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','accepted','dismissed')),
  accepted_goal_id TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(project_slug, source_key, kind)
);
CREATE INDEX IF NOT EXISTS idx_goal_suggestions_project
  ON goal_suggestions(project_slug, status);

-- Pull requests a goal agent opened to change the workspace's codebase.
-- The PR is the approval gate for code mutations: the agent never merges
-- its own PR; the user reviews on GitHub. State is synced from the gh
-- CLI at tick time and on goal-page views, so the loop reacts to reviews,
-- comment counts, merges, and closes.
CREATE TABLE IF NOT EXISTS goal_prs (
  id          TEXT PRIMARY KEY,
  goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  action_id   TEXT REFERENCES goal_actions(id) ON DELETE SET NULL,
  -- The check (goal_ticks.tick_number) whose turn registered this PR, so
  -- the Checks list can link a check to the PR it produced.
  tick_number INTEGER,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  branch      TEXT,
  state       TEXT NOT NULL DEFAULT 'open'
              CHECK (state IN ('open','merged','closed')),
  -- GitHub reviewDecision: APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED
  -- (empty for repos without required reviews). NULL until first sync.
  review_decision TEXT,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  is_draft        INTEGER NOT NULL DEFAULT 0,
  merged_at       TEXT,
  last_synced_at  TEXT,
  sync_error      TEXT,
  -- Centralized freshness sweep: the 30s scheduler syncs a PR when
  -- next_sync_at arrives. The interval adapts to activity (fast after
  -- last_activity_at, backing off toward an hourly cap); terminal PRs
  -- carry NULL and are never synced again.
  next_sync_at     TEXT,
  last_activity_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(goal_id, url)
);
CREATE INDEX IF NOT EXISTS idx_goal_prs_goal ON goal_prs(goal_id, state);
CREATE INDEX IF NOT EXISTS idx_goal_prs_due ON goal_prs(state, next_sync_at);

CREATE TABLE IF NOT EXISTS goal_ticks (
  id           TEXT PRIMARY KEY,
  goal_id      TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  tick_number  INTEGER NOT NULL,
  trigger_kind TEXT NOT NULL DEFAULT 'heartbeat'
               CHECK (trigger_kind IN ('heartbeat','manual','approval','intake')),
  session_id   TEXT,
  metric_value REAL,
  metric_error TEXT,
  status       TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running','done','failed')),
  summary      TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_goal_ticks_goal ON goal_ticks(goal_id, tick_number);
`;
