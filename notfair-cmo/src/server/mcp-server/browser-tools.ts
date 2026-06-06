/**
 * MCP tool definitions for the workspace browser.
 *
 * Agent-facing surface modeled on Hermes' tool shape: many small, typed
 * tools rather than one mega-tool with an action discriminator. Each tool
 * takes `project_slug` (from IDENTITY.md, used to pick the right workspace
 * Chrome) plus the action-specific args. Stable `targetId` handles let
 * agents thread state across calls without re-snapshotting tabs.
 */
import { z } from "zod";

import {
  back as actBack,
  click as actClick,
  navigate as actNavigate,
  press as actPress,
  scroll as actScroll,
  snapshot as actSnapshot,
  type as actType,
  type SnapshotElement,
} from "@/server/browser/actions";
import { getOrLaunchBrowser, getSessionStatus, stopBrowser } from "@/server/browser/session";
import { closeTab, getTab, listTabs, openTab } from "@/server/browser/tabs";

import type { ToolDefinition, ToolResult } from "./tools";

// ── Shared helpers ─────────────────────────────────────────────────────

const projectSlug = z
  .string()
  .min(1)
  .describe("The project this browser belongs to. From your IDENTITY.md prompt header.");

const targetId = z
  .string()
  .min(1)
  .describe(
    "Tab handle from browser_open or browser_tabs. Use your agent_id as the label when opening, then reuse the same label in subsequent calls.",
  );

const ref = z
  .string()
  .regex(/^e\d+$/, "ref must look like 'e1', 'e2', ... from the latest snapshot")
  .describe("Element ref from the most recent browser_snapshot call.");

function invalid(err: z.ZodError): ToolResult {
  return {
    ok: false,
    error: `Invalid arguments: ${err.issues
      .map((i) => `${i.path.join(".")} ${i.message}`)
      .join("; ")}`,
  };
}

function txt(text: string): ToolResult {
  return { ok: true, content: [{ type: "text", text }] };
}

function fail(message: string): ToolResult {
  return { ok: false, error: message };
}

function safeMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function withTab<T>(
  project_slug: string,
  target: string,
  fn: (page: Awaited<ReturnType<typeof getTab>>) => Promise<T>,
): Promise<T | ToolResult> {
  const page = await getTab(project_slug, target);
  if (!page) {
    return fail(
      `No tab "${target}" in workspace "${project_slug}". Call browser_tabs to see what's open, or browser_open to create one.`,
    );
  }
  return fn(page);
}

// ── browser_status ─────────────────────────────────────────────────────

const browserStatusInput = z.object({ project_slug: projectSlug });

async function handleBrowserStatus(input: unknown): Promise<ToolResult> {
  const parsed = browserStatusInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const status = getSessionStatus(parsed.data.project_slug);
  return txt(
    JSON.stringify(
      {
        running: status.running,
        cdpPort: status.cdpPort,
        userDataDir: status.userDataDir,
        uptimeMs: status.uptimeMs,
        // V1 has no real signed-in check; surface the user-data-dir so
        // agents/users know cookies persist across restarts.
        note: status.running
          ? "Workspace browser is running. Use browser_tabs to list windows."
          : "Workspace browser is not running. The first browser_open will launch it.",
      },
      null,
      2,
    ),
  );
}

// ── browser_tabs ───────────────────────────────────────────────────────

const browserTabsInput = z.object({ project_slug: projectSlug });

async function handleBrowserTabs(input: unknown): Promise<ToolResult> {
  const parsed = browserTabsInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const tabs = await listTabs(parsed.data.project_slug);
    return txt(JSON.stringify(tabs, null, 2));
  } catch (err) {
    return fail(`browser_tabs failed: ${safeMessage(err)}`);
  }
}

// ── browser_open ───────────────────────────────────────────────────────

const browserOpenInput = z.object({
  project_slug: projectSlug,
  url: z.string().url().optional().describe("Initial URL. Omit to open about:blank."),
  label: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_\-]{0,63}$/i)
    .optional()
    .describe(
      "Stable handle for future calls. Recommended: your agent_id. Reusing an existing label navigates that tab instead of opening a duplicate.",
    ),
});

async function handleBrowserOpen(input: unknown): Promise<ToolResult> {
  const parsed = browserOpenInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, url, label } = parsed.data;
  try {
    // Ensure the session is up — first open triggers the Chrome launch.
    await getOrLaunchBrowser(project_slug);
    const handle = await openTab(project_slug, { label, url });
    return txt(JSON.stringify(handle, null, 2));
  } catch (err) {
    return fail(`browser_open failed: ${safeMessage(err)}`);
  }
}

// ── browser_close ──────────────────────────────────────────────────────

const browserCloseInput = z.object({
  project_slug: projectSlug,
  target_id: targetId,
});

async function handleBrowserClose(input: unknown): Promise<ToolResult> {
  const parsed = browserCloseInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, target_id } = parsed.data;
  try {
    const ok = await closeTab(project_slug, target_id);
    return txt(ok ? `Closed tab "${target_id}".` : `No tab "${target_id}" to close.`);
  } catch (err) {
    return fail(`browser_close failed: ${safeMessage(err)}`);
  }
}

// ── browser_navigate ───────────────────────────────────────────────────

const browserNavigateInput = z.object({
  project_slug: projectSlug,
  target_id: targetId,
  url: z.string().url(),
  wait_until: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).optional(),
  timeout_ms: z.number().int().positive().max(120_000).optional(),
});

async function handleBrowserNavigate(input: unknown): Promise<ToolResult> {
  const parsed = browserNavigateInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, target_id, url, wait_until, timeout_ms } = parsed.data;
  const result = await withTab(project_slug, target_id, async (page) => {
    const r = await actNavigate(page!, { url, waitUntil: wait_until, timeoutMs: timeout_ms });
    return txt(JSON.stringify(r, null, 2));
  });
  if (isToolResult(result)) return result;
  return result;
}

// ── browser_snapshot ───────────────────────────────────────────────────

const browserSnapshotInput = z.object({
  project_slug: projectSlug,
  target_id: targetId,
  /** Truncate the element list shown to the model. Underlying snapshot may have more. */
  max_elements: z.number().int().positive().max(200).optional(),
});

async function handleBrowserSnapshot(input: unknown): Promise<ToolResult> {
  const parsed = browserSnapshotInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, target_id, max_elements } = parsed.data;
  const result = await withTab(project_slug, target_id, async (page) => {
    const snap = await actSnapshot(page!);
    const elements: SnapshotElement[] = max_elements
      ? snap.elements.slice(0, max_elements)
      : snap.elements;
    return txt(
      JSON.stringify(
        {
          url: snap.url,
          title: snap.title,
          elements,
          text: snap.text,
        },
        null,
        2,
      ),
    );
  });
  if (isToolResult(result)) return result;
  return result;
}

// ── browser_click ──────────────────────────────────────────────────────

const browserClickInput = z.object({
  project_slug: projectSlug,
  target_id: targetId,
  ref: ref,
  button: z.enum(["left", "right", "middle"]).optional(),
  modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional(),
  double_click: z.boolean().optional(),
  timeout_ms: z.number().int().positive().max(30_000).optional(),
});

async function handleBrowserClick(input: unknown): Promise<ToolResult> {
  const parsed = browserClickInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, target_id, ref, button, modifiers, double_click, timeout_ms } = parsed.data;
  const result = await withTab(project_slug, target_id, async (page) => {
    await actClick(page!, {
      ref,
      button,
      modifiers,
      doubleClick: double_click,
      timeoutMs: timeout_ms,
    });
    return txt(`Clicked ${ref} on tab "${target_id}".`);
  });
  if (isToolResult(result)) return result;
  return result;
}

// ── browser_type ───────────────────────────────────────────────────────

const browserTypeInput = z.object({
  project_slug: projectSlug,
  target_id: targetId,
  ref: ref,
  text: z.string(),
  submit: z.boolean().optional().describe("Press Enter after typing."),
  clear_first: z.boolean().optional().describe("Clear the field before typing. Default true."),
  timeout_ms: z.number().int().positive().max(30_000).optional(),
});

async function handleBrowserType(input: unknown): Promise<ToolResult> {
  const parsed = browserTypeInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, target_id, ref, text, submit, clear_first, timeout_ms } = parsed.data;
  const result = await withTab(project_slug, target_id, async (page) => {
    await actType(page!, {
      ref,
      text,
      submit,
      clearFirst: clear_first,
      timeoutMs: timeout_ms,
    });
    return txt(`Typed ${text.length} chars into ${ref}${submit ? " and submitted" : ""}.`);
  });
  if (isToolResult(result)) return result;
  return result;
}

// ── browser_press ──────────────────────────────────────────────────────

const browserPressInput = z.object({
  project_slug: projectSlug,
  target_id: targetId,
  key: z
    .string()
    .min(1)
    .describe("Playwright key string, e.g. 'Enter', 'Tab', 'Control+a', 'ArrowDown'."),
  ref: z
    .string()
    .regex(/^e\d+$/)
    .optional()
    .describe("Focus this element before pressing. Omit to press at the page/keyboard level."),
});

async function handleBrowserPress(input: unknown): Promise<ToolResult> {
  const parsed = browserPressInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, target_id, key, ref } = parsed.data;
  const result = await withTab(project_slug, target_id, async (page) => {
    await actPress(page!, { key, ref });
    return txt(`Pressed ${key}${ref ? ` on ${ref}` : ""}.`);
  });
  if (isToolResult(result)) return result;
  return result;
}

// ── browser_scroll ─────────────────────────────────────────────────────

const browserScrollInput = z.object({
  project_slug: projectSlug,
  target_id: targetId,
  direction: z.enum(["up", "down", "left", "right"]),
  amount: z.number().int().positive().max(10_000).optional(),
});

async function handleBrowserScroll(input: unknown): Promise<ToolResult> {
  const parsed = browserScrollInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, target_id, direction, amount } = parsed.data;
  const result = await withTab(project_slug, target_id, async (page) => {
    await actScroll(page!, { direction, amount });
    return txt(`Scrolled ${direction}${amount ? ` by ${amount}px` : ""}.`);
  });
  if (isToolResult(result)) return result;
  return result;
}

// ── browser_back ───────────────────────────────────────────────────────

const browserBackInput = z.object({
  project_slug: projectSlug,
  target_id: targetId,
});

async function handleBrowserBack(input: unknown): Promise<ToolResult> {
  const parsed = browserBackInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { project_slug, target_id } = parsed.data;
  const result = await withTab(project_slug, target_id, async (page) => {
    await actBack(page!);
    return txt(`Navigated back on tab "${target_id}".`);
  });
  if (isToolResult(result)) return result;
  return result;
}

// ── browser_shutdown (admin) ───────────────────────────────────────────

const browserShutdownInput = z.object({ project_slug: projectSlug });

async function handleBrowserShutdown(input: unknown): Promise<ToolResult> {
  const parsed = browserShutdownInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await stopBrowser(parsed.data.project_slug);
    return txt(`Workspace browser for "${parsed.data.project_slug}" stopped.`);
  } catch (err) {
    return fail(`browser_shutdown failed: ${safeMessage(err)}`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function isToolResult(x: unknown): x is ToolResult {
  return (
    typeof x === "object" &&
    x !== null &&
    "ok" in x &&
    (("content" in x && Array.isArray((x as ToolResult & { content?: unknown }).content)) ||
      "error" in x)
  );
}

// ── Registry export ────────────────────────────────────────────────────

export const BROWSER_TOOLS: ToolDefinition[] = [
  {
    name: "browser_status",
    description:
      "Check whether the workspace browser is running and where its profile lives. Cheap; safe to call before any other browser tool.",
    inputSchema: browserStatusInput,
    handler: handleBrowserStatus,
  },
  {
    name: "browser_tabs",
    description:
      "List every tab in the workspace browser with its handle, URL, and title. Call before browser_open to avoid duplicating a tab that already exists for your agent.",
    inputSchema: browserTabsInput,
    handler: handleBrowserTabs,
  },
  {
    name: "browser_open",
    description:
      "Open (or reuse) a tab. Pass your agent_id as `label` so subsequent calls can target the same tab by handle. If `label` already exists, this navigates that tab instead of duplicating it. Returns a TabHandle.",
    inputSchema: browserOpenInput,
    handler: handleBrowserOpen,
  },
  {
    name: "browser_close",
    description: "Close a tab by handle. Safe no-op if the handle is unknown.",
    inputSchema: browserCloseInput,
    handler: handleBrowserClose,
  },
  {
    name: "browser_navigate",
    description: "Navigate an existing tab to a new URL. Returns the loaded URL + title.",
    inputSchema: browserNavigateInput,
    handler: handleBrowserNavigate,
  },
  {
    name: "browser_snapshot",
    description:
      "Capture the page's interactable elements (buttons, links, inputs, etc.) with stable refs like e1/e2 plus a text excerpt. Snapshot the tab before any click/type so your refs are fresh — refs from a prior snapshot become stale after navigation or DOM mutation.",
    inputSchema: browserSnapshotInput,
    handler: handleBrowserSnapshot,
  },
  {
    name: "browser_click",
    description:
      "Click an element by ref (from the latest browser_snapshot). Supports right/middle/double click and keyboard modifiers.",
    inputSchema: browserClickInput,
    handler: handleBrowserClick,
  },
  {
    name: "browser_type",
    description:
      "Type text into an input/textarea/contenteditable ref. By default clears the field first; set submit=true to press Enter when done.",
    inputSchema: browserTypeInput,
    handler: handleBrowserType,
  },
  {
    name: "browser_press",
    description:
      "Press a single key or key combo. With `ref` set, focuses that element first; without, presses at the page keyboard level (e.g. Escape to dismiss a modal).",
    inputSchema: browserPressInput,
    handler: handleBrowserPress,
  },
  {
    name: "browser_scroll",
    description:
      "Scroll the viewport up/down/left/right. Defaults to ~600px (about one screen). Use when elements aren't visible in the current snapshot.",
    inputSchema: browserScrollInput,
    handler: handleBrowserScroll,
  },
  {
    name: "browser_back",
    description:
      "Navigate back one entry in the tab's history. No-ops cleanly on the first page (no error).",
    inputSchema: browserBackInput,
    handler: handleBrowserBack,
  },
  {
    name: "browser_shutdown",
    description:
      "Stop the workspace browser. Use rarely — only when the user explicitly asks to close it. Cookies persist in the profile dir, so the next browser_open relaunches with the same session.",
    inputSchema: browserShutdownInput,
    handler: handleBrowserShutdown,
  },
];
