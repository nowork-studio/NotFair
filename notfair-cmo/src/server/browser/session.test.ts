import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChromeLaunchOptions, LaunchedChrome } from "./chrome";
import type { Browser, BrowserContext } from "playwright-core";
import {
  _sessionsByProject,
  getOrLaunchBrowser,
  getSessionStatus,
  stopAllBrowsers,
  stopBrowser,
} from "./session";

// ── Fakes ────────────────────────────────────────────────────────────────

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  kill(_signal?: string) {
    if (this.exitCode === null) {
      this.exitCode = 0;
      this.killed = true;
      setImmediate(() => this.emit("exit", 0, null));
    }
    return true;
  }
}

function makeLaunched(port: number): LaunchedChrome {
  return {
    process: new FakeProcess() as unknown as LaunchedChrome["process"],
    cdpPort: port,
    cdpHttpUrl: `http://127.0.0.1:${port}`,
    userDataDir: `/tmp/notfair-cmo-test/projects/acme/browser/user-data`,
  };
}

function makeFakeBrowser(): { browser: Browser; context: BrowserContext; closed: () => boolean } {
  let closedFlag = false;
  const context = {
    pages: () => [],
    on: vi.fn(),
    once: vi.fn(),
    newPage: vi.fn(),
    close: vi.fn(async () => {}),
  } as unknown as BrowserContext;
  const browser = {
    contexts: () => [context],
    close: vi.fn(async () => {
      closedFlag = true;
    }),
  } as unknown as Browser;
  return { browser, context, closed: () => closedFlag };
}

beforeEach(() => {
  process.env.NOTFAIR_CMO_DATA_DIR = "/tmp/notfair-cmo-test";
  process.env.NOTFAIR_CHROME_PATH = "/usr/bin/fake-chrome";
  _sessionsByProject.clear();
});

afterEach(async () => {
  await stopAllBrowsers();
  delete process.env.NOTFAIR_CMO_DATA_DIR;
  delete process.env.NOTFAIR_CHROME_PATH;
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("getOrLaunchBrowser", () => {
  it("launches Chrome and attaches Playwright on first call", async () => {
    const launch = vi.fn(async (_opts: ChromeLaunchOptions) => makeLaunched(19042));
    const fake = makeFakeBrowser();
    const connectOverCDP = vi.fn(async () => fake.browser);

    const session = await getOrLaunchBrowser("acme", { launch, connectOverCDP });

    expect(launch).toHaveBeenCalledOnce();
    expect(connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:19042");
    expect(session.projectSlug).toBe("acme");
    expect(session.browser).toBe(fake.browser);
    expect(session.context).toBe(fake.context);
  });

  it("reuses the cached session on subsequent calls", async () => {
    const launch = vi.fn(async () => makeLaunched(19042));
    const fake = makeFakeBrowser();
    const connectOverCDP = vi.fn(async () => fake.browser);

    const a = await getOrLaunchBrowser("acme", { launch, connectOverCDP });
    const b = await getOrLaunchBrowser("acme", { launch, connectOverCDP });

    expect(a).toBe(b);
    expect(launch).toHaveBeenCalledOnce();
    expect(connectOverCDP).toHaveBeenCalledOnce();
  });

  it("dedupes concurrent launches with the same slug", async () => {
    let launchCount = 0;
    const launch = vi.fn(async () => {
      launchCount++;
      await new Promise((r) => setTimeout(r, 20));
      return makeLaunched(19042);
    });
    const fake = makeFakeBrowser();
    const connectOverCDP = vi.fn(async () => fake.browser);

    const [a, b, c] = await Promise.all([
      getOrLaunchBrowser("acme", { launch, connectOverCDP }),
      getOrLaunchBrowser("acme", { launch, connectOverCDP }),
      getOrLaunchBrowser("acme", { launch, connectOverCDP }),
    ]);

    expect(launchCount).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("relaunches when the cached session's Chrome process has exited", async () => {
    const launch = vi
      .fn<(opts: ChromeLaunchOptions) => Promise<LaunchedChrome>>()
      .mockImplementationOnce(async () => makeLaunched(19042))
      .mockImplementationOnce(async () => makeLaunched(19043));
    const fake = makeFakeBrowser();
    const connectOverCDP = vi.fn(async () => fake.browser);

    const first = await getOrLaunchBrowser("acme", { launch, connectOverCDP });
    // Simulate Chrome dying.
    (first.launched.process as unknown as FakeProcess).kill();
    await new Promise((r) => setImmediate(r));

    const second = await getOrLaunchBrowser("acme", { launch, connectOverCDP });
    expect(second).not.toBe(first);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("throws a friendly error when Chrome cannot be found", async () => {
    // Override findChromeExecutable's discovery path by passing an empty
    // executablePath (falsy, so the lookup fallback runs but lands on the
    // null branch — explicit empty string sidesteps the env/file probe).
    const launch = vi.fn();
    const connectOverCDP = vi.fn();
    await expect(
      getOrLaunchBrowser("acme", {
        executablePath: "",
        launch,
        connectOverCDP,
      }),
    ).rejects.toThrow(/Could not find Chrome/);
    expect(launch).not.toHaveBeenCalled();
  });

  it("cleans up Chrome when Playwright attach fails", async () => {
    const launched = makeLaunched(19042);
    const launch = vi.fn(async () => launched);
    const connectOverCDP = vi.fn(async () => {
      throw new Error("CDP handshake failed");
    });

    await expect(
      getOrLaunchBrowser("acme", { launch, connectOverCDP }),
    ).rejects.toThrow(/Failed to attach Playwright/);

    // Process should have been killed during cleanup.
    expect((launched.process as unknown as FakeProcess).killed).toBe(true);
  });

  it("rejects connections with no default context", async () => {
    const launched = makeLaunched(19042);
    const launch = vi.fn(async () => launched);
    const browser = {
      contexts: () => [],
      close: vi.fn(async () => {}),
    } as unknown as Browser;
    const connectOverCDP = vi.fn(async () => browser);

    await expect(
      getOrLaunchBrowser("acme", { launch, connectOverCDP }),
    ).rejects.toThrow(/no default context/);
  });
});

describe("stopBrowser", () => {
  it("closes Playwright + Chrome and clears the registry entry", async () => {
    const launched = makeLaunched(19042);
    const launch = vi.fn(async () => launched);
    const fake = makeFakeBrowser();
    const connectOverCDP = vi.fn(async () => fake.browser);

    await getOrLaunchBrowser("acme", { launch, connectOverCDP });
    expect(_sessionsByProject.has("acme")).toBe(true);

    await stopBrowser("acme");

    expect(_sessionsByProject.has("acme")).toBe(false);
    expect(fake.closed()).toBe(true);
    expect((launched.process as unknown as FakeProcess).killed).toBe(true);
  });

  it("no-ops when the project has no active session", async () => {
    await expect(stopBrowser("missing")).resolves.toBeUndefined();
  });
});

describe("getSessionStatus", () => {
  it("reports running=false when no session exists", () => {
    const status = getSessionStatus("brand-new");
    expect(status.running).toBe(false);
    expect(status.cdpPort).toBeGreaterThanOrEqual(19000);
    expect(status.cdpPort).toBeLessThanOrEqual(19099);
    expect(status.userDataDir).toContain("brand-new/browser/user-data");
  });

  it("reports running=true with uptime once launched", async () => {
    const launch = vi.fn(async () => makeLaunched(19042));
    const fake = makeFakeBrowser();
    const connectOverCDP = vi.fn(async () => fake.browser);
    await getOrLaunchBrowser("acme", { launch, connectOverCDP });

    const status = getSessionStatus("acme");
    expect(status.running).toBe(true);
    expect(status.launchedAt).toBeTypeOf("number");
    expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});
