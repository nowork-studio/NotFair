/**
 * Real-Chrome smoke test.
 *
 * Skipped unless BOTH of the following are true:
 *   - findChromeExecutable() finds a Chromium-family binary on the host
 *   - NOTFAIR_E2E_BROWSER=1 in the env (gated so day-to-day `pnpm test`
 *     stays fast and offline-safe)
 *
 * Confirms the actual wire works end-to-end: Chrome launches, Playwright
 * attaches via CDP, a tab navigates to a data: URL, snapshot extracts
 * interactable elements, click fires the inline handler, type fills the
 * input, scroll moves the viewport, close tears it down.
 *
 * Run locally: `NOTFAIR_E2E_BROWSER=1 pnpm test browser.e2e`
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findChromeExecutable } from "./chrome";
import { click, navigate, snapshot, scroll, type as typeAction } from "./actions";
import {
  _sessionsByProject,
  getOrLaunchBrowser,
  stopAllBrowsers,
} from "./session";
import { _resetTabRegistries, closeTab, listTabs, openTab } from "./tabs";

const SKIP =
  process.env.NOTFAIR_E2E_BROWSER !== "1" || findChromeExecutable() === null;

const PROJECT_SLUG = "e2e-smoke";
const TEST_HTML = encodeURIComponent(`
  <!DOCTYPE html>
  <html>
    <head><title>e2e smoke</title></head>
    <body style="height: 3000px">
      <h1 id="heading">hello e2e</h1>
      <button id="b1" onclick="window.__clicked = (window.__clicked||0)+1">click me</button>
      <input id="i1" placeholder="type here" />
      <span id="counter">0</span>
    </body>
  </html>
`);
const TEST_URL = `data:text/html,${TEST_HTML}`;

let dataDir: string;

beforeAll(() => {
  if (SKIP) return;
  dataDir = mkdtempSync(join(tmpdir(), "notfair-cmo-e2e-"));
  process.env.NOTFAIR_CMO_DATA_DIR = dataDir;
  // Headless on CI/local runs; this is a smoke test, not a UX test.
  process.env.NOTFAIR_BROWSER_HEADLESS = "1";
});

afterAll(async () => {
  if (SKIP) return;
  await stopAllBrowsers();
  _resetTabRegistries();
  _sessionsByProject.clear();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  delete process.env.NOTFAIR_CMO_DATA_DIR;
  delete process.env.NOTFAIR_BROWSER_HEADLESS;
});

describe.skipIf(SKIP)("browser E2E smoke (real Chrome)", () => {
  it(
    "launches Chrome, snapshots a page, clicks + types + scrolls, then closes the tab",
    { timeout: 60_000 },
    async () => {
      const session = await getOrLaunchBrowser(PROJECT_SLUG);
      expect(session.launched.process.exitCode).toBeNull();

      const handle = await openTab(PROJECT_SLUG, { label: "smoke", url: TEST_URL });
      expect(handle.id).toBe("smoke");
      expect(handle.url).toContain("data:text/html");

      const page = (await import("./tabs")).getTab.bind(null);
      const livePage = await page(PROJECT_SLUG, "smoke");
      expect(livePage).not.toBeNull();
      if (!livePage) throw new Error("unreachable");

      // Navigate via the action layer to a fresh page so we exercise it too.
      const navResult = await navigate(livePage, { url: TEST_URL });
      expect(navResult.title).toBe("e2e smoke");

      // Snapshot must find the button + input.
      const snap = await snapshot(livePage);
      const button = snap.elements.find((e) => e.name === "click me");
      const input = snap.elements.find((e) => e.role === "input");
      expect(button).toBeDefined();
      expect(input).toBeDefined();

      // Click the button — inline handler should bump window.__clicked.
      await click(livePage, { ref: button!.ref });
      const clickedCount = await livePage.evaluate(() => (window as unknown as { __clicked?: number }).__clicked);
      expect(clickedCount).toBe(1);

      // Type into the input and verify the value sticks.
      await typeAction(livePage, { ref: input!.ref, text: "hello world" });
      const typedValue = await livePage.evaluate(
        () => (document.querySelector("#i1") as HTMLInputElement).value,
      );
      expect(typedValue).toBe("hello world");

      // Scroll and verify scrollY moved.
      await scroll(livePage, { direction: "down", amount: 500 });
      const scrollY = await livePage.evaluate(() => window.scrollY);
      expect(scrollY).toBeGreaterThan(0);

      // List tabs sanity.
      const tabs = await listTabs(PROJECT_SLUG);
      expect(tabs.some((t) => t.id === "smoke")).toBe(true);

      // Close the tab.
      const closed = await closeTab(PROJECT_SLUG, "smoke");
      expect(closed).toBe(true);
    },
  );
});
