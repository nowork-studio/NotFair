import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildChromeLaunchArgs,
  clearChromeSingletonArtifacts,
  findChromeExecutable,
  waitForCdpReady,
} from "./chrome";

describe("findChromeExecutable", () => {
  it("returns NOTFAIR_CHROME_PATH when set and the file exists", () => {
    const env = { NOTFAIR_CHROME_PATH: "/custom/chrome" };
    const result = findChromeExecutable(env, "darwin", (p) => p === "/custom/chrome");
    expect(result).toBe("/custom/chrome");
  });

  it("ignores NOTFAIR_CHROME_PATH when the file does not exist and falls through to defaults", () => {
    const env = { NOTFAIR_CHROME_PATH: "/missing" };
    const result = findChromeExecutable(env, "darwin", (p) =>
      p === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
    expect(result).toBe(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
  });

  it("probes macOS Chrome locations on darwin", () => {
    const result = findChromeExecutable(
      {},
      "darwin",
      (p) => p === "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
    expect(result).toBe("/Applications/Chromium.app/Contents/MacOS/Chromium");
  });

  it("probes Linux locations on linux", () => {
    const result = findChromeExecutable({}, "linux", (p) => p === "/usr/bin/chromium");
    expect(result).toBe("/usr/bin/chromium");
  });

  it("returns null when nothing matches", () => {
    const result = findChromeExecutable({}, "darwin", () => false);
    expect(result).toBeNull();
  });

  it("returns null on unsupported platforms (win32 stub for now)", () => {
    const result = findChromeExecutable({}, "win32", () => true);
    expect(result).toBeNull();
  });
});

describe("buildChromeLaunchArgs", () => {
  const base = {
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    userDataDir: "/tmp/profile",
    cdpPort: 19042,
  };

  it("includes the required CDP + user-data-dir flags", () => {
    const args = buildChromeLaunchArgs(base);
    expect(args).toContain("--remote-debugging-port=19042");
    expect(args).toContain("--user-data-dir=/tmp/profile");
  });

  it("omits headless flags by default", () => {
    const args = buildChromeLaunchArgs(base);
    expect(args).not.toContain("--headless=new");
    expect(args).not.toContain("--disable-gpu");
  });

  it("adds --headless=new and --disable-gpu when headless=true", () => {
    const args = buildChromeLaunchArgs({ ...base, headless: true });
    expect(args).toContain("--headless=new");
    expect(args).toContain("--disable-gpu");
  });

  it("adds --disable-dev-shm-usage on linux only", () => {
    expect(buildChromeLaunchArgs({ ...base, platform: "linux" })).toContain(
      "--disable-dev-shm-usage",
    );
    expect(buildChromeLaunchArgs({ ...base, platform: "darwin" })).not.toContain(
      "--disable-dev-shm-usage",
    );
  });

  it("appends extraArgs verbatim at the end", () => {
    const args = buildChromeLaunchArgs({
      ...base,
      extraArgs: ["--window-size=1280,800", "--proxy-server=127.0.0.1:8888"],
    });
    expect(args.slice(-2)).toEqual([
      "--window-size=1280,800",
      "--proxy-server=127.0.0.1:8888",
    ]);
  });

  it("disables Chrome onboarding + crash bubbles that block agent flows", () => {
    const args = buildChromeLaunchArgs(base);
    expect(args).toContain("--no-first-run");
    expect(args).toContain("--no-default-browser-check");
    expect(args).toContain("--disable-session-crashed-bubble");
    expect(args).toContain("--hide-crash-restore-bubble");
  });
});

describe("clearChromeSingletonArtifacts", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "notfair-cmo-chrome-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes SingletonLock, SingletonSocket, and SingletonCookie", () => {
    for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      writeFileSync(path.join(dir, f), "");
    }
    clearChromeSingletonArtifacts(dir);
    expect(fs.existsSync(path.join(dir, "SingletonLock"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "SingletonSocket"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "SingletonCookie"))).toBe(false);
  });

  it("leaves unrelated files alone", () => {
    writeFileSync(path.join(dir, "SingletonLock"), "");
    writeFileSync(path.join(dir, "Preferences"), "{}");
    clearChromeSingletonArtifacts(dir);
    expect(fs.existsSync(path.join(dir, "Preferences"))).toBe(true);
  });

  it("no-ops when the dir or files don't exist", () => {
    expect(() => clearChromeSingletonArtifacts("/nonexistent/path/here")).not.toThrow();
  });
});

describe("waitForCdpReady", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("resolves when /json/version returns 200", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 })) as typeof fetch;
    await expect(
      waitForCdpReady("http://127.0.0.1:19042", 500, 10),
    ).resolves.toBeUndefined();
  });

  it("retries on transient errors then succeeds", async () => {
    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) throw new Error("connection refused");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    await expect(
      waitForCdpReady("http://127.0.0.1:19042", 1000, 10),
    ).resolves.toBeUndefined();
    expect(attempts).toBeGreaterThanOrEqual(3);
  });

  it("rejects with the last error message when the deadline passes", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as typeof fetch;
    await expect(
      waitForCdpReady("http://127.0.0.1:19042", 50, 10),
    ).rejects.toThrow(/did not become ready within 50ms.*ECONNREFUSED/);
  });

  it("treats non-200 responses as not-ready", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("server starting", { status: 503 })) as typeof fetch;
    await expect(
      waitForCdpReady("http://127.0.0.1:19042", 50, 10),
    ).rejects.toThrow(/status 503/);
  });
});
