/**
 * Workspace Chrome lifecycle.
 *
 * Discovers a Chromium-family browser binary, builds launch args for a
 * managed instance pointed at a workspace user-data-dir, starts it on a
 * known CDP port, waits for the CDP endpoint to come up, and shuts it down
 * cleanly. Borrowed pattern from openclaw's chrome.ts but trimmed to the
 * essentials a single-user local app needs.
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SINGLETON_LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

const MAC_CHROME_CANDIDATES: ReadonlyArray<string> = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const LINUX_CHROME_CANDIDATES: ReadonlyArray<string> = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "/usr/bin/brave-browser",
];

/**
 * Find a Chromium-family binary.
 *
 * Respects $NOTFAIR_CHROME_PATH first, then probes platform defaults.
 * Returns null when nothing is found — callers should produce a friendly
 * error pointing the user at the env var or an install link.
 */
export function findChromeExecutable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): string | null {
  const explicit = env.NOTFAIR_CHROME_PATH?.trim();
  if (explicit && exists(explicit)) return explicit;

  const candidates =
    platform === "darwin"
      ? MAC_CHROME_CANDIDATES
      : platform === "linux"
        ? LINUX_CHROME_CANDIDATES
        : [];

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Remove Chrome's SingletonLock / SingletonSocket / SingletonCookie files.
 *
 * Chrome refuses to start a second process against the same --user-data-dir,
 * keying off these files. If our prior managed Chrome crashed (or the OS
 * killed the parent without unlinking), the locks survive and the next
 * launch silently no-ops or fails. Clear them before every launch — they're
 * a coordination primitive, not durable state.
 */
export function clearChromeSingletonArtifacts(userDataDir: string): void {
  for (const basename of SINGLETON_LOCK_FILES) {
    try {
      fs.rmSync(path.join(userDataDir, basename), { force: true });
    } catch {
      // best-effort: a residual file the kernel can't unlink is not worth aborting launch
    }
  }
}

export interface ChromeLaunchOptions {
  executablePath: string;
  userDataDir: string;
  cdpPort: number;
  /** Default false. Onboarding sign-in always wants headed; agent runtime can choose. */
  headless?: boolean;
  /** Override platform for testability. */
  platform?: NodeJS.Platform;
  /** Extra args appended verbatim. Useful for --proxy-server, --window-size, etc. */
  extraArgs?: string[];
}

/** Compose the Chrome argv list. Pure — does not touch disk or spawn anything. */
export function buildChromeLaunchArgs(opts: ChromeLaunchOptions): string[] {
  const platform = opts.platform ?? process.platform;
  const args = [
    `--remote-debugging-port=${opts.cdpPort}`,
    `--user-data-dir=${opts.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-features=Translate,MediaRouter",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--password-store=basic",
  ];
  if (opts.headless) {
    args.push("--headless=new", "--disable-gpu");
  }
  if (platform === "linux") {
    args.push("--disable-dev-shm-usage");
  }
  if (opts.extraArgs?.length) {
    args.push(...opts.extraArgs);
  }
  return args;
}

export interface LaunchedChrome {
  process: ChildProcess;
  cdpPort: number;
  cdpHttpUrl: string;
  userDataDir: string;
}

/**
 * Spawn Chrome and wait for its CDP HTTP endpoint to respond.
 *
 * Throws if Chrome exits before CDP becomes reachable, or if the readiness
 * probe times out. Callers should catch and surface a friendly error
 * (Chrome version too old, port already taken, etc.).
 */
export async function launchChrome(
  opts: ChromeLaunchOptions,
  readyTimeoutMs = 15_000,
): Promise<LaunchedChrome> {
  fs.mkdirSync(opts.userDataDir, { recursive: true });
  clearChromeSingletonArtifacts(opts.userDataDir);

  const args = buildChromeLaunchArgs(opts);
  const proc = spawn(opts.executablePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const cdpHttpUrl = `http://127.0.0.1:${opts.cdpPort}`;

  const stderrChunks: string[] = [];
  proc.stderr?.on("data", (chunk: Buffer) => {
    // Keep last ~4KB of stderr so we can include a hint in launch failures.
    stderrChunks.push(chunk.toString("utf8"));
    while (stderrChunks.join("").length > 4096) stderrChunks.shift();
  });

  const earlyExit = new Promise<never>((_, reject) => {
    proc.once("exit", (code, signal) => {
      reject(
        new Error(
          `Chrome exited before CDP became ready (code=${code} signal=${signal}). ` +
            `stderr tail: ${stderrChunks.join("").slice(-512)}`,
        ),
      );
    });
  });

  try {
    await Promise.race([waitForCdpReady(cdpHttpUrl, readyTimeoutMs), earlyExit]);
  } catch (err) {
    if (proc.exitCode === null) proc.kill("SIGKILL");
    throw err;
  }

  return {
    process: proc,
    cdpPort: opts.cdpPort,
    cdpHttpUrl,
    userDataDir: opts.userDataDir,
  };
}

/** Poll the CDP /json/version endpoint until it 200s or we time out. */
export async function waitForCdpReady(
  cdpHttpUrl: string,
  timeoutMs: number,
  pollIntervalMs = 150,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${cdpHttpUrl}/json/version`, {
        signal: AbortSignal.timeout(Math.min(1000, timeoutMs)),
      });
      if (res.ok) return;
      lastErr = new Error(`CDP probe returned status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `Chrome CDP at ${cdpHttpUrl} did not become ready within ${timeoutMs}ms` +
      (lastErr ? `: ${(lastErr as Error).message ?? String(lastErr)}` : ""),
  );
}

/** Graceful SIGTERM with SIGKILL fallback, then SingletonLock cleanup. */
export async function stopChrome(launched: LaunchedChrome, timeoutMs = 5_000): Promise<void> {
  const { process: proc, userDataDir } = launched;
  if (proc.exitCode === null && !proc.killed) {
    proc.kill("SIGTERM");
    await waitForExit(proc, timeoutMs);
    if (proc.exitCode === null) {
      proc.kill("SIGKILL");
      await waitForExit(proc, 1_000);
    }
  }
  clearChromeSingletonArtifacts(userDataDir);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
