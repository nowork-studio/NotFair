import { describe, expect, it, vi } from "vitest";

// Real better-sqlite3 against a tmpdir DB, per repo test conventions.
// MUST be hoisted: static imports evaluate before module-level statements,
// and db.ts captures NOTFAIR_DATA_DIR at import time — a plain assignment
// here would silently point the suite at the developer's live ~/.notfair.
vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  process.env.NOTFAIR_DATA_DIR = mkdtempSync(join(tmpdir(), "notfair-metric-"));
});

import {
  LOCAL_SOURCE_KEY,
  LOCAL_SOURCE_TOOL,
  parseMetricValue,
  runHistorySource,
  runMetricSource,
} from "./metric";

const SLUG = "proj";

function localSource(command: string, tool = LOCAL_SOURCE_TOOL) {
  return {
    key: LOCAL_SOURCE_KEY,
    tool,
    args_json: JSON.stringify({ command }),
  };
}

describe("parseMetricValue", () => {
  it("accepts bare numbers, numeric strings, and {value} wrappers", () => {
    expect(parseMetricValue(21)).toBe(21);
    expect(parseMetricValue("21.5")).toBe(21.5);
    expect(parseMetricValue({ value: 3 })).toBe(3);
    expect(parseMetricValue({ ok: true, result: { value: 9 } })).toBe(9);
  });

  it("accepts a one-column MCP table with one numeric row", () => {
    expect(parseMetricValue("value\n1.2097")).toBe(1.2097);
    expect(parseMetricValue("value\r\n1.2097")).toBe(1.2097);
  });

  it("rejects ambiguous payloads", () => {
    expect(parseMetricValue("")).toBeNull();
    expect(parseMetricValue([1, 2])).toBeNull();
    expect(parseMetricValue({ rows: 4 })).toBeNull();
    expect(parseMetricValue("value\n1\n2")).toBeNull();
    expect(parseMetricValue("1\n2")).toBeNull();
    expect(parseMetricValue("not-a-metric\n1")).toBeNull();
  });
});

describe("runMetricSource (local shell)", () => {
  it("parses a bare number from stdout", async () => {
    const r = await runMetricSource(SLUG, localSource("echo 42"));
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it("parses a {value} JSON payload from stdout", async () => {
    const r = await runMetricSource(SLUG, localSource(`echo '{"value": 7.5}'`));
    expect(r).toEqual({ ok: true, value: 7.5 });
  });

  it("rejects non-numeric output with the payload echoed back", async () => {
    const r = await runMetricSource(SLUG, localSource("echo not-a-number"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not-a-number");
  });

  it("surfaces command failure", async () => {
    const r = await runMetricSource(SLUG, localSource("exit 3"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Local command failed");
  });

  it("rejects a missing command argument", async () => {
    const r = await runMetricSource(SLUG, {
      key: LOCAL_SOURCE_KEY,
      tool: LOCAL_SOURCE_TOOL,
      args_json: "{}",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('{"command"');
  });

  it("rejects tools other than 'shell' on the local source", async () => {
    const r = await runMetricSource(SLUG, localSource("echo 1", "runScript"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("'shell'");
  });
});

describe("runHistorySource (local shell)", () => {
  it("parses a {date, value} array from stdout, sorted ascending", async () => {
    const rows = `[{"date":"2026-07-02","value":2},{"date":"2026-07-01","value":1}]`;
    const r = await runHistorySource(SLUG, localSource(`echo '${rows}'`));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.points.map((p) => p.value)).toEqual([1, 2]);
    }
  });

  it("rejects non-array output", async () => {
    const r = await runHistorySource(SLUG, localSource("echo 5"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("array of {date, value}");
  });
});
