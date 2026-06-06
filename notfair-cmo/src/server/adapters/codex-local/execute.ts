import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessEvent, HarnessExecuteContext } from "../types";
import { makeCodexStreamState, parseCodexLine } from "./parse";
import { bearerEnvVarForServer, CODEX_BEARER_ENV_VAR } from "./mcp";
import { getOrCreateMcpServerSecret } from "@/server/mcp-server/secret";
import { listProjectMcpTokens } from "@/server/mcp/tokens";

const CODEX_BIN = process.env.NOTFAIR_CODEX_BIN?.trim() || "codex";

/**
 * Stream one chat turn through the Codex CLI.
 *
 * Wire shape:
 *   - We spawn `codex exec --json --skip-git-repo-check -` and pipe the user
 *     message into stdin (the trailing `-` tells codex to read prompt from
 *     stdin).
 *   - Codex does not support a `--system-prompt` flag; instead it auto-loads
 *     AGENTS.md (and friends) from cwd. We write IDENTITY.md to the workspace
 *     AGENTS.md so codex picks it up.
 *   - For thread resumption, codex uses `codex exec resume <thread-id> -`.
 *   - Each stdout line is a JSON event; we forward as HarnessEvents.
 */
export async function* executeCodexLocal(
  ctx: HarnessExecuteContext,
): AsyncGenerator<HarnessEvent, void, void> {
  // --dangerously-bypass-approvals-and-sandbox is what makes notfair-cmo
  // agents useful through Codex. Without it, codex auto-cancels every
  // MCP tool call (so set_project_brief / submit_task_status etc. fail)
  // and sandboxes loopback connections to our orchestration server.
  // notfair-cmo's trust model: the user installed this app, picked
  // these agents, connected real ad accounts. The product-level
  // Approvals flow gates spend / publish / channel changes; the
  // OS-level sandbox would also gate things we want the agent to do
  // (read its workspace, call our local MCP), so we run unsandboxed.
  const args: string[] = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
  ];

  // Resume only when we have a real codex thread id from a prior turn.
  // notfair-cmo's session UUID is not a codex thread id — passing it would
  // fail with "thread not found".
  if (ctx.harnessSessionId && isUuid(ctx.harnessSessionId)) {
    args.push("resume", ctx.harnessSessionId, "-");
  } else {
    args.push("-");
  }

  // Codex resolves streamable-http MCP bearers via env var. We inject one
  // env var per MCP server the project has registered so each server gets
  // its OWN bearer:
  //   - notfair-orchestration: shared per-machine secret
  //   - notfair-browser: same shared per-machine secret (both are
  //     internal notfair-cmo servers on loopback)
  //   - notfair-googleads, gsc, etc.: per-project OAuth token from
  //     `mcp_tokens`
  // Without per-server env vars every MCP would auth with the same
  // (wrong) bearer and codex would either surface it as Auth Unsupported
  // or pass the wrong token to the wrong server.
  const mcpSecret = getOrCreateMcpServerSecret();
  const mcpEnv: Record<string, string> = {
    [CODEX_BEARER_ENV_VAR]: mcpSecret,
    [bearerEnvVarForServer("notfair-browser")]: mcpSecret,
  };
  for (const token of listProjectMcpTokens(ctx.projectSlug)) {
    mcpEnv[bearerEnvVarForServer(token.server_name)] = token.access_token_enc;
  }
  const child = spawn(CODEX_BIN, args, {
    cwd: ctx.workspaceDir,
    env: {
      ...process.env,
      NOTFAIR_PROJECT_SLUG: ctx.projectSlug,
      NOTFAIR_AGENT_ID: ctx.agentId,
      ...mcpEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const abortHandler = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // already dead
    }
  };
  ctx.signal?.addEventListener("abort", abortHandler, { once: true });

  child.stdin.write(ctx.message);
  child.stdin.end();

  const state = makeCodexStreamState();
  let stdoutBuf = "";
  const events: HarnessEvent[] = [];
  let exited = false;
  let exitErr: string | null = null;
  let resolveWait: (() => void) | null = null;
  const wake = () => {
    const r = resolveWait;
    resolveWait = null;
    if (r) r();
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuf += chunk;
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      const out = parseCodexLine(line, state);
      for (const evt of out) events.push(evt);
      if (out.length > 0) wake();
    }
  });

  let stderrBuf = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrBuf += chunk;
  });

  child.on("error", (err) => {
    exited = true;
    exitErr = err instanceof Error ? err.message : String(err);
    wake();
  });
  child.on("close", (code) => {
    if (stdoutBuf.trim().length > 0) {
      const out = parseCodexLine(stdoutBuf, state);
      for (const evt of out) events.push(evt);
      stdoutBuf = "";
    }
    if (code !== 0) {
      // Always push the exit-code+stderr-tail error on non-zero exit,
      // even when state.finalized is set. `turn.failed` events from
      // Codex's MCP reconnect loop are tagged transient by parse.ts and
      // intentionally do NOT finalize the turn so we still get this
      // richer post-exit message — but on a legitimately-finalized turn
      // (turn.completed followed by a non-zero exit) the exit info is
      // still the most actionable signal, so capture it unconditionally.
      const tail = stderrBuf.trim().split("\n").slice(-5).join("\n");
      events.push({
        kind: "error",
        message: `codex exited with code ${code}${tail ? `: ${tail}` : ""}`,
      });
    }
    exited = true;
    wake();
  });

  try {
    while (!exited || events.length > 0) {
      while (events.length > 0) {
        const evt = events.shift()!;
        yield evt;
      }
      if (exited) break;
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
        setTimeout(() => {
          if (resolveWait === resolve) {
            resolveWait = null;
            resolve();
          }
        }, 300_000);
      });
    }
    if (exitErr) {
      yield { kind: "error", message: exitErr };
    }
  } finally {
    ctx.signal?.removeEventListener("abort", abortHandler);
    if (!exited) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
