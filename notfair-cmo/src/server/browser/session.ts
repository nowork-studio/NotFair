/**
 * Workspace-scoped Chrome session lifecycle.
 *
 * One Chrome process per project, lazily launched the first time a browser
 * tool runs for that project, reused for the remainder of the notfair-cmo
 * process lifetime. Chrome's user-data-dir lock prevents a second concurrent
 * instance, so all agents within a workspace share the same Chrome and
 * coordinate via labeled tabs (see tabs.ts).
 *
 * We deliberately do NOT auto-shutdown on idle in V1. Keeping Chrome warm
 * preserves cookies (no extra disk writes) and avoids the 1-2s relaunch
 * cost on every agent turn. Process-exit handlers in registerShutdownHooks()
 * make sure we don't leak Chrome processes when notfair-cmo stops.
 */
import type { Browser, BrowserContext } from "playwright-core";

import {
  type ChromeLaunchOptions,
  type LaunchedChrome,
  findChromeExecutable,
  launchChrome,
  stopChrome,
} from "./chrome";
import { allocateCdpPort, resolveUserDataDir } from "./paths";

export interface BrowserSession {
  projectSlug: string;
  cdpPort: number;
  cdpHttpUrl: string;
  userDataDir: string;
  /** Live Chrome subprocess + metadata from launchChrome(). */
  launched: LaunchedChrome;
  /** Playwright Browser handle (CDP-attached). */
  browser: Browser;
  /** Persistent default context — owns the cookies/storage from user-data-dir. */
  context: BrowserContext;
  /** Wall-clock launch time, for diagnostics. */
  launchedAt: number;
}

/**
 * Per-process registry of running browser sessions, keyed by project slug.
 * Exported for tests; production code goes through getOrLaunchBrowser().
 */
export const _sessionsByProject = new Map<string, BrowserSession>();

/**
 * In-flight launch promises, keyed by project slug. Without this, two
 * concurrent tool calls on the same project would each kick off a Chrome
 * launch, the second hitting Chrome's SingletonLock and failing.
 */
const _launchPromises = new Map<string, Promise<BrowserSession>>();

export interface GetOrLaunchOptions {
  /** Force headless. Default: respect NOTFAIR_BROWSER_HEADLESS env (default false on macOS, true on linux). */
  headless?: boolean;
  /** Override chrome executable path. Falls back to findChromeExecutable(). */
  executablePath?: string;
  /** Extra Chrome args. Useful for tests + advanced users. */
  extraArgs?: string[];
  /** Override the Playwright connect function (for tests). */
  connectOverCDP?: (cdpHttpUrl: string) => Promise<Browser>;
  /** Override the Chrome launcher (for tests). */
  launch?: (opts: ChromeLaunchOptions) => Promise<LaunchedChrome>;
}

/**
 * Lazily launch (or reuse) the workspace Chrome for a project.
 *
 * Idempotent: concurrent callers share the same launch promise. Subsequent
 * calls after a successful launch return the cached session immediately.
 */
export async function getOrLaunchBrowser(
  projectSlug: string,
  opts: GetOrLaunchOptions = {},
): Promise<BrowserSession> {
  const existing = _sessionsByProject.get(projectSlug);
  if (existing && isSessionAlive(existing)) {
    return existing;
  }
  if (existing) {
    // Stale entry from a crashed Chrome — clean it up before relaunching.
    _sessionsByProject.delete(projectSlug);
  }

  const inflight = _launchPromises.get(projectSlug);
  if (inflight) return inflight;

  const promise = launchSession(projectSlug, opts).finally(() => {
    _launchPromises.delete(projectSlug);
  });
  _launchPromises.set(projectSlug, promise);
  return promise;
}

async function launchSession(
  projectSlug: string,
  opts: GetOrLaunchOptions,
): Promise<BrowserSession> {
  const executablePath = opts.executablePath ?? findChromeExecutable();
  if (!executablePath) {
    throw new Error(
      "Could not find Chrome / Chromium. Install Chrome, or set NOTFAIR_CHROME_PATH to the binary.",
    );
  }

  const userDataDir = resolveUserDataDir(projectSlug);
  const cdpPort = allocateCdpPort(projectSlug);
  const headless = resolveHeadless(opts.headless);

  const launch = opts.launch ?? launchChrome;
  const launched = await launch({
    executablePath,
    userDataDir,
    cdpPort,
    headless,
    extraArgs: opts.extraArgs,
  });

  let browser: Browser;
  try {
    const connect = opts.connectOverCDP ?? defaultConnectOverCDP;
    browser = await connect(launched.cdpHttpUrl);
  } catch (err) {
    await stopChrome(launched).catch(() => {});
    throw new Error(
      `Failed to attach Playwright to Chrome CDP at ${launched.cdpHttpUrl}: ${(err as Error).message}`,
    );
  }

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    await browser.close().catch(() => {});
    await stopChrome(launched).catch(() => {});
    throw new Error(
      "Connected to Chrome CDP but no default context exists — Chrome may have launched in an unexpected mode.",
    );
  }
  const context = contexts[0]!;

  const session: BrowserSession = {
    projectSlug,
    cdpPort: launched.cdpPort,
    cdpHttpUrl: launched.cdpHttpUrl,
    userDataDir: launched.userDataDir,
    launched,
    browser,
    context,
    launchedAt: Date.now(),
  };
  _sessionsByProject.set(projectSlug, session);

  // If Chrome exits unexpectedly, evict the cached session so the next call
  // triggers a fresh launch instead of returning a dead handle.
  launched.process.once("exit", () => {
    if (_sessionsByProject.get(projectSlug) === session) {
      _sessionsByProject.delete(projectSlug);
    }
  });

  return session;
}

async function defaultConnectOverCDP(cdpHttpUrl: string): Promise<Browser> {
  // Lazy import keeps playwright-core out of the cold-start path for
  // notfair-cmo features that don't touch the browser.
  const { chromium } = await import("playwright-core");
  return chromium.connectOverCDP(cdpHttpUrl);
}

function resolveHeadless(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const env = process.env.NOTFAIR_BROWSER_HEADLESS?.trim().toLowerCase();
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;
  return process.platform === "linux"; // headed on macOS by default, headless on linux servers
}

function isSessionAlive(session: BrowserSession): boolean {
  return session.launched.process.exitCode === null && !session.launched.process.killed;
}

/**
 * Tear down a single project's browser session. Used by tests + the
 * onboarding "restart browser" flow.
 */
export async function stopBrowser(projectSlug: string): Promise<void> {
  const session = _sessionsByProject.get(projectSlug);
  if (!session) return;
  _sessionsByProject.delete(projectSlug);
  try {
    await session.browser.close();
  } catch {
    // Browser may already be dead; ignore.
  }
  await stopChrome(session.launched).catch(() => {});
}

/** Tear down every active session — call on process exit. */
export async function stopAllBrowsers(): Promise<void> {
  const slugs = [..._sessionsByProject.keys()];
  await Promise.all(slugs.map((slug) => stopBrowser(slug)));
}

let _shutdownHooksInstalled = false;
/**
 * Register SIGINT/SIGTERM/beforeExit handlers that stop every browser
 * session. Idempotent — safe to call from multiple call sites.
 */
export function registerShutdownHooks(): void {
  if (_shutdownHooksInstalled) return;
  _shutdownHooksInstalled = true;

  const handler = () => {
    void stopAllBrowsers();
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  process.once("beforeExit", handler);
}

/** Status snapshot for browser_status MCP tool + diagnostics. */
export interface BrowserSessionStatus {
  projectSlug: string;
  running: boolean;
  cdpPort: number;
  userDataDir: string;
  launchedAt?: number;
  uptimeMs?: number;
}

export function getSessionStatus(projectSlug: string): BrowserSessionStatus {
  const session = _sessionsByProject.get(projectSlug);
  const cdpPort = allocateCdpPort(projectSlug);
  const userDataDir = resolveUserDataDir(projectSlug);
  if (!session) {
    return { projectSlug, running: false, cdpPort, userDataDir };
  }
  return {
    projectSlug,
    running: isSessionAlive(session),
    cdpPort: session.cdpPort,
    userDataDir: session.userDataDir,
    launchedAt: session.launchedAt,
    uptimeMs: Date.now() - session.launchedAt,
  };
}
