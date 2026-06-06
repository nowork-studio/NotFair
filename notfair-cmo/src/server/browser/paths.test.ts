import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CDP_PORT_RANGE_END,
  CDP_PORT_RANGE_START,
  allocateCdpPort,
  isValidProjectSlug,
  notfairDataDir,
  resolveBrowserProfileDir,
  resolveUserDataDir,
} from "./paths";

describe("isValidProjectSlug", () => {
  it.each([
    "acme",
    "acme-co",
    "a1",
    "0-foo",
    "x".repeat(64),
  ])("accepts %s", (slug) => {
    expect(isValidProjectSlug(slug)).toBe(true);
  });

  it.each([
    "",
    "ACME",
    "acme co",
    "acme_co",
    "-acme",
    "x".repeat(65),
    "acme.co",
  ])("rejects %s", (slug) => {
    expect(isValidProjectSlug(slug)).toBe(false);
  });
});

describe("notfairDataDir", () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.NOTFAIR_CMO_DATA_DIR;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NOTFAIR_CMO_DATA_DIR;
    else process.env.NOTFAIR_CMO_DATA_DIR = originalEnv;
  });

  it("uses env override when set", () => {
    process.env.NOTFAIR_CMO_DATA_DIR = "/tmp/notfair-cmo-test";
    expect(notfairDataDir()).toBe("/tmp/notfair-cmo-test");
  });

  it("falls back to ~/.notfair-cmo when env not set", () => {
    delete process.env.NOTFAIR_CMO_DATA_DIR;
    expect(notfairDataDir()).toBe(join(homedir(), ".notfair-cmo"));
  });
});

describe("resolveBrowserProfileDir / resolveUserDataDir", () => {
  beforeEach(() => {
    process.env.NOTFAIR_CMO_DATA_DIR = "/tmp/notfair-cmo-test";
  });
  afterEach(() => {
    delete process.env.NOTFAIR_CMO_DATA_DIR;
  });

  it("nests profile dir under projects/<slug>/browser", () => {
    expect(resolveBrowserProfileDir("acme")).toBe(
      "/tmp/notfair-cmo-test/projects/acme/browser",
    );
  });

  it("nests user-data dir under the profile dir", () => {
    expect(resolveUserDataDir("acme")).toBe(
      "/tmp/notfair-cmo-test/projects/acme/browser/user-data",
    );
  });

  it("throws on invalid slug", () => {
    expect(() => resolveBrowserProfileDir("Invalid Slug")).toThrow(/Invalid project slug/);
    expect(() => resolveUserDataDir("")).toThrow(/Invalid project slug/);
  });
});

describe("allocateCdpPort", () => {
  it("returns a port in the configured range", () => {
    const port = allocateCdpPort("acme");
    expect(port).toBeGreaterThanOrEqual(CDP_PORT_RANGE_START);
    expect(port).toBeLessThanOrEqual(CDP_PORT_RANGE_END);
  });

  it("is deterministic for the same slug", () => {
    expect(allocateCdpPort("acme")).toBe(allocateCdpPort("acme"));
    expect(allocateCdpPort("xyz-123")).toBe(allocateCdpPort("xyz-123"));
  });

  it("distributes across the range for different slugs (hash spreads)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      seen.add(allocateCdpPort(`project-${i}`));
    }
    // 50 slugs into a 100-port space. Birthday-paradox expected distinct ≈ 39.
    // We just want to prove the hash isn't degenerate; require >30 to give
    // headroom over the expected value while staying deterministic.
    expect(seen.size).toBeGreaterThan(30);
  });

  it("throws on invalid slug", () => {
    expect(() => allocateCdpPort("Invalid")).toThrow(/Invalid project slug/);
  });
});
