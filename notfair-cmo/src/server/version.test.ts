import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetLatestCache,
  getCurrentVersion,
  getLatestVersion,
  getVersionStatus,
  isSemverGreater,
} from "./version";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  _resetLatestCache();
});

afterEach(() => {
  _resetLatestCache();
  globalThis.fetch = originalFetch;
});

describe("getCurrentVersion", () => {
  it("returns a non-empty semver string from package.json", () => {
    const v = getCurrentVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("isSemverGreater", () => {
  it.each([
    ["1.0.0", "0.9.9", true],
    ["1.1.0", "1.0.9", true],
    ["0.0.2", "0.0.1", true],
    ["0.0.1", "0.0.1", false],
    ["0.0.1", "0.0.2", false],
    ["1.0.0", "1.0.0", false],
    ["2.0.0", "10.0.0", false],
    ["10.0.0", "9.99.99", true],
  ])("isSemverGreater(%s, %s) === %s", (a, b, expected) => {
    expect(isSemverGreater(a, b)).toBe(expected);
  });

  it("ignores pre-release / build suffixes (compares numeric core only)", () => {
    expect(isSemverGreater("1.0.0", "1.0.0-rc.1")).toBe(false);
    expect(isSemverGreater("1.0.1-rc.1", "1.0.0")).toBe(true);
  });
});

describe("getLatestVersion", () => {
  it("returns the npm registry version on success", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 }),
    ) as typeof fetch;
    const v = await getLatestVersion();
    expect(v).toBe("9.9.9");
  });

  it("caches within the TTL window", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ version: "1.2.3" }), { status: 200 }),
    );
    globalThis.fetch = spy as typeof fetch;
    await getLatestVersion();
    await getLatestVersion();
    await getLatestVersion();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after force=true", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ version: "1.2.3" }), { status: 200 }),
    );
    globalThis.fetch = spy as typeof fetch;
    await getLatestVersion();
    await getLatestVersion(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns null on registry errors instead of throwing", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("server is on fire", { status: 503 }),
    ) as typeof fetch;
    expect(await getLatestVersion()).toBeNull();
  });

  it("returns null when fetch rejects (offline)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await getLatestVersion()).toBeNull();
  });

  it("returns null when the response is not JSON or lacks version", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ name: "notfair-cmo" }), { status: 200 }),
    ) as typeof fetch;
    expect(await getLatestVersion()).toBeNull();
  });
});

describe("getVersionStatus", () => {
  it("flags has_update=true when registry reports a newer version", async () => {
    const current = getCurrentVersion();
    const bumped = bumpPatch(current);
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: bumped }), { status: 200 }),
    ) as typeof fetch;
    const status = await getVersionStatus();
    expect(status.current).toBe(current);
    expect(status.latest).toBe(bumped);
    expect(status.has_update).toBe(true);
  });

  it("flags has_update=false when current is the latest", async () => {
    const current = getCurrentVersion();
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: current }), { status: 200 }),
    ) as typeof fetch;
    const status = await getVersionStatus();
    expect(status.has_update).toBe(false);
  });

  it("flags has_update=false (not unknown) when registry is unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const status = await getVersionStatus();
    expect(status.latest).toBeNull();
    expect(status.has_update).toBe(false);
  });
});

function bumpPatch(v: string): string {
  const [maj, min, patch] = v.split(".").map((n) => parseInt(n, 10));
  return `${maj}.${min}.${(patch ?? 0) + 1}`;
}
