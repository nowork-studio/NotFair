import { describe, expect, it, vi } from "vitest";

import type { Page } from "playwright-core";
import {
  back,
  click,
  navigate,
  press,
  scroll,
  type as typeAction,
} from "./actions";

// ── Page fake — only the surface our action layer actually touches ───────

interface LocatorCalls {
  click?: unknown;
  dblclick?: unknown;
  fill?: unknown[];
  press?: unknown[];
}

function makeLocatorRecorder() {
  const byRef = new Map<string, LocatorCalls>();
  const locator = (selector: string) => {
    const ref = selector.match(/data-notfair-ref="([^"]+)"/)?.[1] ?? "?";
    if (!byRef.has(ref)) byRef.set(ref, { fill: [], press: [] });
    const calls = byRef.get(ref)!;
    return {
      click: vi.fn(async (opts?: unknown) => {
        calls.click = opts;
      }),
      dblclick: vi.fn(async (opts?: unknown) => {
        calls.dblclick = opts;
      }),
      fill: vi.fn(async (text: string, opts?: unknown) => {
        calls.fill!.push({ text, opts });
      }),
      press: vi.fn(async (key: string, opts?: unknown) => {
        calls.press!.push({ key, opts });
      }),
    };
  };
  return { locator, byRef };
}

function makePage(rec: ReturnType<typeof makeLocatorRecorder>) {
  const keyboardPress = vi.fn(async (_key: string) => {});
  const evaluateCalls: unknown[] = [];
  const page = {
    url: () => "https://example.com",
    title: async () => "Example",
    goto: vi.fn(async (_url: string, _opts?: unknown) => null),
    goBack: vi.fn(async (_opts?: unknown) => null),
    locator: rec.locator,
    keyboard: { press: keyboardPress },
    evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => {
      evaluateCalls.push(arg);
    }),
  } as unknown as Page;
  return { page, keyboardPress, evaluateCalls };
}

// ── navigate ─────────────────────────────────────────────────────────────

describe("navigate", () => {
  it("calls page.goto with defaults and returns url+title", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    const result = await navigate(page, { url: "https://example.com" });
    expect(page.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "load",
      timeout: 30_000,
    });
    expect(result).toEqual({ url: "https://example.com", title: "Example" });
  });

  it("honors caller-supplied waitUntil + timeoutMs", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    await navigate(page, {
      url: "https://example.com",
      waitUntil: "networkidle",
      timeoutMs: 5_000,
    });
    expect(page.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "networkidle",
      timeout: 5_000,
    });
  });
});

// ── click ────────────────────────────────────────────────────────────────

describe("click", () => {
  it("rejects refs that don't match e<number>", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    await expect(click(page, { ref: "weird" })).rejects.toThrow(/Invalid ref/);
  });

  it("issues a single click by default", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    await click(page, { ref: "e3" });
    expect(rec.byRef.get("e3")?.click).toBeDefined();
    expect(rec.byRef.get("e3")?.dblclick).toBeUndefined();
  });

  it("issues a double-click when requested", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    await click(page, { ref: "e1", doubleClick: true });
    expect(rec.byRef.get("e1")?.dblclick).toBeDefined();
    expect(rec.byRef.get("e1")?.click).toBeUndefined();
  });

  it("forwards button and modifiers to Playwright", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    await click(page, {
      ref: "e2",
      button: "right",
      modifiers: ["Meta", "Shift"],
    });
    expect(rec.byRef.get("e2")?.click).toMatchObject({
      button: "right",
      modifiers: ["Meta", "Shift"],
    });
  });
});

// ── type ─────────────────────────────────────────────────────────────────

describe("type", () => {
  it("clears the field then fills with the new text", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    await typeAction(page, { ref: "e5", text: "hello world" });
    const fills = rec.byRef.get("e5")?.fill ?? [];
    expect(fills.length).toBe(2);
    expect((fills[0] as { text: string }).text).toBe("");
    expect((fills[1] as { text: string }).text).toBe("hello world");
  });

  it("skips the clear when clearFirst is explicitly false", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    await typeAction(page, { ref: "e5", text: "append", clearFirst: false });
    const fills = rec.byRef.get("e5")?.fill ?? [];
    expect(fills.length).toBe(1);
    expect((fills[0] as { text: string }).text).toBe("append");
  });

  it("presses Enter after typing when submit is true", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    await typeAction(page, { ref: "e5", text: "search", submit: true });
    const presses = rec.byRef.get("e5")?.press ?? [];
    expect(presses).toHaveLength(1);
    expect((presses[0] as { key: string }).key).toBe("Enter");
  });
});

// ── press ────────────────────────────────────────────────────────────────

describe("press", () => {
  it("presses on a locator when ref is supplied", async () => {
    const rec = makeLocatorRecorder();
    const { page, keyboardPress } = makePage(rec);
    await press(page, { ref: "e1", key: "Tab" });
    expect((rec.byRef.get("e1")?.press ?? [])[0]).toMatchObject({ key: "Tab" });
    expect(keyboardPress).not.toHaveBeenCalled();
  });

  it("presses at page level when ref is omitted", async () => {
    const rec = makeLocatorRecorder();
    const { page, keyboardPress } = makePage(rec);
    await press(page, { key: "Escape" });
    expect(keyboardPress).toHaveBeenCalledWith("Escape");
  });
});

// ── scroll ───────────────────────────────────────────────────────────────

describe("scroll", () => {
  it.each([
    ["up", { x: 0, y: -600 }],
    ["down", { x: 0, y: 600 }],
    ["left", { x: -600, y: 0 }],
    ["right", { x: 600, y: 0 }],
  ] as const)("scrolls %s by default amount", async (direction, expected) => {
    const rec = makeLocatorRecorder();
    const { page, evaluateCalls } = makePage(rec);
    await scroll(page, { direction });
    expect(evaluateCalls).toContainEqual(expected);
  });

  it("honors a custom amount", async () => {
    const rec = makeLocatorRecorder();
    const { page, evaluateCalls } = makePage(rec);
    await scroll(page, { direction: "down", amount: 1200 });
    expect(evaluateCalls).toContainEqual({ x: 0, y: 1200 });
  });
});

// ── back ─────────────────────────────────────────────────────────────────

describe("back", () => {
  it("calls page.goBack with load wait", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    await back(page);
    expect(page.goBack).toHaveBeenCalledWith({ waitUntil: "load" });
  });

  it("swallows navigation errors (back on first page is normal)", async () => {
    const rec = makeLocatorRecorder();
    const { page } = makePage(rec);
    (page.goBack as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no history"));
    await expect(back(page)).resolves.toBeUndefined();
  });
});
