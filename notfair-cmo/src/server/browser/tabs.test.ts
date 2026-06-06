import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ChromeLaunchOptions, LaunchedChrome } from "./chrome";
import {
  _sessionsByProject,
  getOrLaunchBrowser,
  stopAllBrowsers,
} from "./session";
import { _resetTabRegistries, assertValidLabel, closeTab, getTab, listTabs, openTab } from "./tabs";

// ── Page / Context / Browser fakes ───────────────────────────────────────

class FakePage extends EventEmitter {
  private _url = "about:blank";
  private _title = "";
  private _closed = false;

  url() { return this._url; }
  async title() { return this._title; }
  isClosed() { return this._closed; }
  async goto(url: string) { this._url = url; this._title = `title:${url}`; }
  async close() {
    if (this._closed) return;
    this._closed = true;
    this.emit("close");
  }
  setTitle(t: string) { this._title = t; }
}

class FakeContext extends EventEmitter {
  private _pages: FakePage[] = [];
  pages() { return [...this._pages] as unknown as Page[]; }
  async newPage(): Promise<Page> {
    const page = new FakePage();
    this._pages.push(page);
    page.once("close", () => {
      this._pages = this._pages.filter((p) => p !== page);
    });
    this.emit("page", page);
    return page as unknown as Page;
  }
  async close() {
    this.emit("close");
  }
}

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  kill() {
    if (this.exitCode === null) {
      this.exitCode = 0;
      this.killed = true;
      setImmediate(() => this.emit("exit", 0, null));
    }
    return true;
  }
}

function makeFakeBrowserAndLaunch() {
  const context = new FakeContext();
  const browser = {
    contexts: () => [context as unknown as BrowserContext],
    close: vi.fn(async () => {}),
  } as unknown as Browser;
  const launched: LaunchedChrome = {
    process: new FakeProcess() as unknown as LaunchedChrome["process"],
    cdpPort: 19042,
    cdpHttpUrl: "http://127.0.0.1:19042",
    userDataDir: "/tmp/notfair-cmo-test/projects/acme/browser/user-data",
  };
  return {
    launched,
    browser,
    context,
    launch: vi.fn(async (_o: ChromeLaunchOptions) => launched),
    connectOverCDP: vi.fn(async () => browser),
  };
}

beforeEach(async () => {
  process.env.NOTFAIR_CMO_DATA_DIR = "/tmp/notfair-cmo-test";
  process.env.NOTFAIR_CHROME_PATH = "/usr/bin/fake-chrome";
  _sessionsByProject.clear();
  _resetTabRegistries();
});

afterEach(async () => {
  await stopAllBrowsers();
  _resetTabRegistries();
  delete process.env.NOTFAIR_CMO_DATA_DIR;
  delete process.env.NOTFAIR_CHROME_PATH;
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("assertValidLabel", () => {
  it.each(["greg", "tina_googleads", "agent-1", "a"])("accepts %s", (l) => {
    expect(() => assertValidLabel(l)).not.toThrow();
  });
  it.each(["", "-greg", "greg page", "greg.cmo", "x".repeat(65)])("rejects %s", (l) => {
    expect(() => assertValidLabel(l)).toThrow(/Invalid tab label/);
  });
});

describe("openTab", () => {
  it("opens a new tab with a caller-supplied label", async () => {
    const env = makeFakeBrowserAndLaunch();
    await getOrLaunchBrowser("acme", env);

    const handle = await openTab("acme", { label: "greg", url: "https://example.com" });

    expect(handle.id).toBe("greg");
    expect(handle.label).toBe("greg");
    expect(handle.url).toBe("https://example.com");
  });

  it("auto-generates t1/t2/... when label is omitted", async () => {
    const env = makeFakeBrowserAndLaunch();
    await getOrLaunchBrowser("acme", env);

    const a = await openTab("acme");
    const b = await openTab("acme");
    expect(a.id).toMatch(/^t\d+$/);
    expect(b.id).toMatch(/^t\d+$/);
    expect(a.id).not.toBe(b.id);
  });

  it("reuses an existing labeled tab instead of opening a duplicate", async () => {
    const env = makeFakeBrowserAndLaunch();
    await getOrLaunchBrowser("acme", env);

    const first = await openTab("acme", { label: "greg", url: "https://example.com" });
    const second = await openTab("acme", { label: "greg", url: "https://other.com" });

    expect(second.id).toBe(first.id);
    expect(second.url).toBe("https://other.com");
    // Only one page should exist on the context.
    const tabs = await listTabs("acme");
    expect(tabs).toHaveLength(1);
  });

  it("rejects invalid labels", async () => {
    const env = makeFakeBrowserAndLaunch();
    await getOrLaunchBrowser("acme", env);

    await expect(openTab("acme", { label: "bad label" })).rejects.toThrow(/Invalid tab label/);
  });
});

describe("getTab + listTabs + closeTab", () => {
  it("getTab resolves by id and returns null for unknown refs", async () => {
    const env = makeFakeBrowserAndLaunch();
    await getOrLaunchBrowser("acme", env);

    const opened = await openTab("acme", { label: "greg" });
    const page = await getTab("acme", opened.id);
    expect(page).not.toBeNull();
    expect(await getTab("acme", "nope")).toBeNull();
  });

  it("listTabs includes all open tabs with current URL + title", async () => {
    const env = makeFakeBrowserAndLaunch();
    await getOrLaunchBrowser("acme", env);

    await openTab("acme", { label: "greg", url: "https://greg.example/" });
    await openTab("acme", { label: "tina", url: "https://tina.example/" });

    const tabs = await listTabs("acme");
    expect(tabs.map((t) => t.id).sort()).toEqual(["greg", "tina"]);
    expect(tabs.find((t) => t.id === "greg")?.url).toBe("https://greg.example/");
    expect(tabs.find((t) => t.id === "tina")?.title).toBe("title:https://tina.example/");
  });

  it("closeTab closes the page and removes it from the registry", async () => {
    const env = makeFakeBrowserAndLaunch();
    await getOrLaunchBrowser("acme", env);
    await openTab("acme", { label: "greg" });

    const ok = await closeTab("acme", "greg");
    expect(ok).toBe(true);

    const tabs = await listTabs("acme");
    expect(tabs.find((t) => t.id === "greg")).toBeUndefined();
    expect(await getTab("acme", "greg")).toBeNull();
  });

  it("closeTab returns false for an unknown ref", async () => {
    const env = makeFakeBrowserAndLaunch();
    await getOrLaunchBrowser("acme", env);
    expect(await closeTab("acme", "missing")).toBe(false);
  });

  it("adopts pages opened on the context outside of openTab (e.g. oauth redirects)", async () => {
    const env = makeFakeBrowserAndLaunch();
    await getOrLaunchBrowser("acme", env);

    // Simulate Chrome opening a tab itself (e.g. _blank link, oauth popup).
    await env.context.newPage();

    const tabs = await listTabs("acme");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.id).toMatch(/^t\d+$/);
  });
});
