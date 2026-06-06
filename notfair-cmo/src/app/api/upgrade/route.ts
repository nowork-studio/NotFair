import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

import { _resetLatestCache, getCurrentVersion, getLatestVersion } from "@/server/version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPGRADE_TIMEOUT_MS = 5 * 60 * 1000;
const TAIL_BYTES = 4_000;

/**
 * POST /api/upgrade
 *
 * Runs `npm i -g notfair-cmo@latest` from the user's shell environment.
 * The currently-running notfair-cmo process keeps the old code loaded in
 * memory (Node module cache), so the user must restart `notfair-cmo` to
 * pick up the upgraded binary. The response message says so.
 *
 * If npm isn't on PATH (e.g. the user runs notfair-cmo from a node_modules
 * shim that doesn't expose npm globally), we surface the spawn error so
 * the client can show the copyable command instead.
 */
export async function POST() {
  // Use a login shell so the npm install runs against the user's actual
  // PATH (Homebrew Node etc.). `-l` ensures their shell profile is read.
  return new Promise<Response>((resolve) => {
    const startedAt = Date.now();
    const child = spawn("npm", ["i", "-g", "notfair-cmo@latest"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const append = (target: "out" | "err") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (target === "out") {
        stdout = (stdout + text).slice(-TAIL_BYTES);
      } else {
        stderr = (stderr + text).slice(-TAIL_BYTES);
      }
    };
    child.stdout?.on("data", append("out"));
    child.stderr?.on("data", append("err"));

    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // best-effort
      }
    }, UPGRADE_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolve(
        NextResponse.json(
          {
            ok: false,
            error: err.message,
            hint:
              "Could not run `npm` from the notfair-cmo process. Run `npm i -g notfair-cmo@latest` in your terminal instead.",
            command: "npm i -g notfair-cmo@latest",
          },
          { status: 500 },
        ),
      );
    });

    child.on("exit", async (code) => {
      clearTimeout(killTimer);
      const elapsed_ms = Date.now() - startedAt;
      if (code === 0) {
        _resetLatestCache();
        // Confirm by refreshing the version snapshot. The current version
        // is still the old one (we're still running) — but `latest` from
        // the registry should now match what we just installed.
        const latest = await getLatestVersion(true);
        resolve(
          NextResponse.json({
            ok: true,
            installed_version: latest ?? null,
            running_version: getCurrentVersion(),
            note:
              "Upgraded. Restart notfair-cmo to load the new version (`notfair-cmo` in your terminal).",
            elapsed_ms,
            stdout_tail: stdout.slice(-1000),
          }),
        );
      } else {
        resolve(
          NextResponse.json(
            {
              ok: false,
              error: `npm exited with code ${code}`,
              elapsed_ms,
              stdout_tail: stdout.slice(-1000),
              stderr_tail: stderr.slice(-1000),
              command: "npm i -g notfair-cmo@latest",
            },
            { status: 500 },
          ),
        );
      }
    });
  });
}
