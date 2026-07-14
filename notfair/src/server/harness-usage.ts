import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Read what each local AI-agent harness exposes about the user's account
 * so the sidebar footer can surface real account state instead of just
 * the harness name.
 *
 *  - **codex-local** → hits `https://chatgpt.com/backend-api/wham/usage`
 *    using the access token from `~/.codex/auth.json`. That's the same
 *    endpoint the ChatGPT settings page reads to render the 5-hour and
 *    weekly usage bars. Returns `used_percent`, the rolling window
 *    duration, and the unix-epoch `reset_at` for both windows.
 *    Cached in-process so navigating between pages doesn't beat on
 *    chatgpt.com once per render.
 *
 *  - **claude-code-local** → `~/.claude/stats-cache.json`. Updated by
 *    the `claude` CLI on each run; contains per-day message/session/
 *    token rollups. Goes stale when `claude` hasn't run today, which
 *    we surface so the UI doesn't pretend a stale snapshot is "today".
 *
 * Failure modes (network error, missing/expired token, missing file,
 * malformed JSON) all fall through to the harness-specific `unknown`
 * shape — the sidebar footer must never break because chatgpt.com is
 * unreachable or `auth.json` was rotated.
 */

export type RateLimitWindow = {
  /** Fractional percent already consumed in the rolling window. */
  used_percent: number;
  /** Length of the rolling window (e.g. 18000 = 5h, 604800 = 7d). */
  limit_window_seconds: number;
  /** Unix epoch (seconds) when this window's usage tally resets. */
  reset_at: number;
};

export type LabeledRateLimitWindow = RateLimitWindow & {
  /** Stable label derived from the provider's actual window duration. */
  label: string;
};

export type CodexAuthStatus =
  | "chatgpt"
  | "api-key"
  | "agent-identity"
  | "signed-out"
  | "unknown";

export type CodexUsage = {
  kind: "codex";
  /** Authentication comes from `codex login status`, not usage shape. */
  auth: CodexAuthStatus;
  /** Codex plan name from wham/usage (e.g. "prolite", "pro", "free"). */
  plan: string | null;
  /** Account email from the JWT — used as a tooltip / accessibility hint. */
  email: string | null;
  /** Any usage windows returned by the provider, shortest first. */
  rateLimits: LabeledRateLimitWindow[];
};

export type ClaudeUsage = {
  kind: "claude-code";
  messagesToday: number;
  sessionsToday: number;
  /** Sum across every model that ran today. */
  tokensToday: number;
  /** True when stats-cache.json hasn't been recomputed today. The UI
   *  shows a quieter message in this state so the row doesn't read as
   *  "0 messages today" (true but misleading). */
  stale: boolean;
  /** YYYY-MM-DD of the latest day stats were rolled up. */
  lastComputedDate: string | null;
};

export type HarnessUsage =
  | CodexUsage
  | ClaudeUsage
  | { kind: "unknown" };

// In-process cache keyed by adapter. The chatgpt.com usage endpoint
// updates whenever the user runs codex, so a 60s TTL keeps the bars
// responsive without hammering the backend on every sidebar render.
type CacheEntry = { until: number; value: HarnessUsage };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const CODEX_BIN = process.env.NOTFAIR_CODEX_BIN?.trim() || "codex";

export async function readHarnessUsage(
  adapter: "claude-code-local" | "codex-local",
): Promise<HarnessUsage> {
  const hit = cache.get(adapter);
  if (hit && hit.until > Date.now()) return hit.value;
  let value: HarnessUsage;
  try {
    if (adapter === "codex-local") value = await readCodexUsage();
    else if (adapter === "claude-code-local") value = readClaudeUsage();
    else value = { kind: "unknown" };
  } catch {
    value = { kind: "unknown" };
  }
  cache.set(adapter, { until: Date.now() + CACHE_TTL_MS, value });
  return value;
}

/** Force a fresh auth + usage read after an interactive login attempt. */
export async function refreshHarnessUsage(
  adapter: "claude-code-local" | "codex-local",
): Promise<HarnessUsage> {
  cache.delete(adapter);
  return readHarnessUsage(adapter);
}

async function readCodexUsage(): Promise<HarnessUsage> {
  let authStatus = await readCodexLoginStatus();
  const authFile = path.join(os.homedir(), ".codex", "auth.json");
  if (!fs.existsSync(authFile)) {
    return {
      kind: "codex",
      auth: authStatus,
      plan: null,
      email: null,
      rateLimits: [],
    };
  }
  const auth = JSON.parse(fs.readFileSync(authFile, "utf-8")) as {
    auth_mode?: string;
    tokens?: {
      access_token?: string;
      id_token?: string;
      account_id?: string;
    };
  };
  const accessToken = auth.tokens?.access_token;
  if (authStatus === "unknown") {
    authStatus = inferAuthStatus(auth.auth_mode, Boolean(accessToken));
  }
  if (!accessToken) {
    return {
      kind: "codex",
      auth: authStatus,
      plan: null,
      email: null,
      rateLimits: [],
    };
  }

  // Decode just to pull the email + chatgpt account id (needed as the
  // ChatGPT-Account-Id header so the backend scopes the response to
  // the right workspace).
  const tokenInfo = decodeIdToken(auth.tokens?.id_token);
  const email = tokenInfo.email;
  const accountId = auth.tokens?.account_id ?? tokenInfo.accountId;

  let plan: string | null = tokenInfo.plan;
  let rateLimits: LabeledRateLimitWindow[] = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;
    try {
      const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers,
        signal: ctrl.signal,
      });
      if (res.ok) {
        const body = (await res.json()) as {
          plan_type?: string;
          rate_limit?: {
            primary_window?: RateLimitWindow | null;
            secondary_window?: RateLimitWindow | null;
          };
        };
        if (typeof body.plan_type === "string") plan = body.plan_type;
        rateLimits = normalizeCodexRateLimits(body.rate_limit);
      }
    } finally {
      clearTimeout(t);
    }
  } catch {
    // Network error / abort. Authentication remains independently known.
  }

  return { kind: "codex", auth: authStatus, plan, email, rateLimits };
}

function decodeIdToken(idToken: string | undefined): {
  email: string | null;
  accountId: string | null;
  plan: string | null;
} {
  if (!idToken) return { email: null, accountId: null, plan: null };
  const parts = idToken.split(".");
  if (parts.length < 2) return { email: null, accountId: null, plan: null };
  try {
    const claims = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf-8"),
    ) as Record<string, unknown>;
    const authClaims =
      (claims["https://api.openai.com/auth"] as
        | Record<string, unknown>
        | undefined) ?? {};
    return {
      email: typeof claims.email === "string" ? claims.email : null,
      accountId:
        typeof authClaims.chatgpt_account_id === "string"
          ? authClaims.chatgpt_account_id
          : null,
      plan:
        typeof authClaims.chatgpt_plan_type === "string"
          ? authClaims.chatgpt_plan_type
          : null,
    };
  } catch {
    return { email: null, accountId: null, plan: null };
  }
}

export function normalizeCodexRateLimits(
  rateLimit:
    | {
        primary_window?: RateLimitWindow | null;
        secondary_window?: RateLimitWindow | null;
      }
    | null
    | undefined,
): LabeledRateLimitWindow[] {
  return [rateLimit?.primary_window, rateLimit?.secondary_window]
    .filter((window): window is RateLimitWindow => isRateLimitWindow(window))
    .sort((a, b) => a.limit_window_seconds - b.limit_window_seconds)
    .map((window) => ({ ...window, label: labelForRateLimitWindow(window) }));
}

function isRateLimitWindow(value: unknown): value is RateLimitWindow {
  if (!value || typeof value !== "object") return false;
  const window = value as Partial<RateLimitWindow>;
  return (
    typeof window.used_percent === "number" &&
    typeof window.limit_window_seconds === "number" &&
    typeof window.reset_at === "number"
  );
}

function labelForRateLimitWindow(window: RateLimitWindow): string {
  const seconds = window.limit_window_seconds;
  if (seconds === 18_000) return "5-hour";
  if (seconds === 86_400) return "Daily";
  if (seconds === 604_800) return "Weekly";
  if (seconds % 86_400 === 0) return `${seconds / 86_400}-day`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}-hour`;
  return "Usage";
}

export function parseCodexLoginStatus(output: string): CodexAuthStatus {
  const normalized = output.trim().toLowerCase();
  if (normalized.includes("logged in using chatgpt")) return "chatgpt";
  if (normalized.includes("logged in using an api key")) return "api-key";
  if (normalized.includes("logged in using agent identity")) {
    return "agent-identity";
  }
  if (normalized.includes("not logged in")) return "signed-out";
  return "unknown";
}

async function readCodexLoginStatus(): Promise<CodexAuthStatus> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn(CODEX_BIN, ["login", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseCodexLoginStatus(output));
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore a process that already exited.
      }
      finish();
    }, 3_000);
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.once("error", finish);
    child.once("close", finish);
  });
}

function inferAuthStatus(
  authMode: string | undefined,
  hasAccessToken: boolean,
): CodexAuthStatus {
  if (!hasAccessToken) return "unknown";
  if (authMode === "chatgpt") return "chatgpt";
  if (authMode === "apikey" || authMode === "api-key") return "api-key";
  return "unknown";
}

function readClaudeUsage(): HarnessUsage {
  const file = path.join(os.homedir(), ".claude", "stats-cache.json");
  if (!fs.existsSync(file)) {
    return {
      kind: "claude-code",
      messagesToday: 0,
      sessionsToday: 0,
      tokensToday: 0,
      stale: true,
      lastComputedDate: null,
    };
  }
  const stats = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    dailyActivity?: Array<{
      date: string;
      messageCount?: number;
      sessionCount?: number;
    }>;
    dailyModelTokens?: Array<{
      date: string;
      tokensByModel?: Record<string, number>;
    }>;
    lastComputedDate?: string;
  };
  const today = new Date().toISOString().slice(0, 10);
  const todayActivity = stats.dailyActivity?.find((d) => d.date === today);
  const todayTokens = stats.dailyModelTokens?.find((d) => d.date === today);
  const tokensSum = todayTokens
    ? Object.values(todayTokens.tokensByModel ?? {}).reduce(
        (sum, v) => sum + (typeof v === "number" ? v : 0),
        0,
      )
    : 0;
  return {
    kind: "claude-code",
    messagesToday: todayActivity?.messageCount ?? 0,
    sessionsToday: todayActivity?.sessionCount ?? 0,
    tokensToday: tokensSum,
    stale: stats.lastComputedDate !== today,
    lastComputedDate: stats.lastComputedDate ?? null,
  };
}
