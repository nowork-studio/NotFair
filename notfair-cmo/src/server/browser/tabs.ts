/**
 * Labeled-tab registry for a workspace browser session.
 *
 * Each agent gets a stable handle ("greg-cmo", "tina-googleads", or an
 * auto-generated "t1", "t2", ...) that survives across MCP tool calls.
 * Pages added/removed from the underlying BrowserContext are reconciled so
 * agent-supplied targetIds keep resolving even when the user opens or
 * closes tabs in the headed Chrome.
 */
import type { Page } from "playwright-core";

import { getOrLaunchBrowser, type BrowserSession } from "./session";

const TAB_LABEL_REGEX = /^[a-z0-9][a-z0-9_\-]{0,63}$/i;

export interface TabHandle {
  /** Stable id the agent passes back. Equals `label` when one was provided. */
  id: string;
  /** Human label (matches id when none was set by the caller). */
  label: string;
  /** Best-effort current URL — may be "about:blank" or stale until next snapshot. */
  url: string;
  /** Best-effort current title. */
  title: string;
}

interface TabRegistry {
  /** label/id → Page */
  byId: Map<string, Page>;
  /** Page → label (reverse lookup so we can rebuild handles after a list) */
  labelByPage: WeakMap<Page, string>;
  /** Counter for auto-generated ids ("t1", "t2", ...). */
  autoCounter: number;
  /** Cached project's BrowserSession; we re-validate on each call. */
  session: BrowserSession;
}

const _registries = new Map<string, TabRegistry>();

async function getRegistry(projectSlug: string): Promise<TabRegistry> {
  const session = await getOrLaunchBrowser(projectSlug);
  let registry = _registries.get(projectSlug);
  if (!registry || registry.session !== session) {
    registry = createRegistry(session);
    _registries.set(projectSlug, registry);
  }
  return registry;
}

function createRegistry(session: BrowserSession): TabRegistry {
  const registry: TabRegistry = {
    byId: new Map(),
    labelByPage: new WeakMap(),
    autoCounter: 0,
    session,
  };

  // Pre-adopt any pages already on the context (Chrome opens an about:blank
  // on first launch). We do NOT subscribe to context.on("page") — openTab
  // owns labeling, and externally-opened pages are reconciled lazily by
  // listTabs(). Subscribing would race with openTab and produce duplicate
  // entries for every labeled tab.
  for (const page of session.context.pages()) {
    adoptPage(registry, page, undefined);
  }
  session.context.on("close", () => {
    registry.byId.clear();
  });
  return registry;
}

function adoptPage(
  registry: TabRegistry,
  page: Page,
  explicitLabel: string | undefined,
): TabHandle {
  const existing = registry.labelByPage.get(page);
  if (existing && registry.byId.get(existing) === page) {
    return handleForPage(page, existing);
  }
  const label = explicitLabel ?? `t${++registry.autoCounter}`;
  registry.byId.set(label, page);
  registry.labelByPage.set(page, label);

  page.once("close", () => {
    if (registry.byId.get(label) === page) {
      registry.byId.delete(label);
    }
  });
  return handleForPage(page, label);
}

function handleForPage(page: Page, label: string): TabHandle {
  return {
    id: label,
    label,
    url: safe(() => page.url()),
    title: "", // populated on demand to avoid eagerly hitting the page on every list
  };
}

function safe<T>(fn: () => T, fallback = ""): T | string {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Validate a caller-supplied tab label. Throws on bad input. */
export function assertValidLabel(label: string): void {
  if (!TAB_LABEL_REGEX.test(label)) {
    throw new Error(
      `Invalid tab label "${label}": must be 1-64 chars of [A-Za-z0-9_-], starting with alphanumeric`,
    );
  }
}

export interface OpenTabOptions {
  /** Stable handle for future calls. Defaults to an auto id "t1"/"t2"/... */
  label?: string;
  /** Initial URL. If omitted, the tab is left at about:blank. */
  url?: string;
  /** Wait condition before returning. Default: "load". */
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  /** Per-navigation timeout. Default: 30s. */
  timeoutMs?: number;
}

/**
 * Open a new tab. If `label` is supplied and already exists, reuses the
 * existing tab and (optionally) navigates it — this matches the openclaw
 * "reuse labeled tab" pattern that avoids duplicates on retries.
 */
export async function openTab(
  projectSlug: string,
  opts: OpenTabOptions = {},
): Promise<TabHandle> {
  const registry = await getRegistry(projectSlug);
  if (opts.label) assertValidLabel(opts.label);

  let page: Page;
  let label: string;
  if (opts.label && registry.byId.has(opts.label)) {
    page = registry.byId.get(opts.label)!;
    label = opts.label;
  } else {
    page = await registry.session.context.newPage();
    const handle = adoptPage(registry, page, opts.label);
    label = handle.label;
  }

  if (opts.url) {
    await page.goto(opts.url, {
      waitUntil: opts.waitUntil ?? "load",
      timeout: opts.timeoutMs ?? 30_000,
    });
  }

  return handleForPage(page, label);
}

/** Resolve a caller-supplied ref ("label", "t1", or raw guid) to a live Page. */
export async function getTab(projectSlug: string, ref: string): Promise<Page | null> {
  const registry = await getRegistry(projectSlug);
  return registry.byId.get(ref) ?? null;
}

/** List every tab the registry knows about, with up-to-date url/title. */
export async function listTabs(projectSlug: string): Promise<TabHandle[]> {
  const registry = await getRegistry(projectSlug);
  // Sync against actual pages — context.pages() is the source of truth.
  for (const page of registry.session.context.pages()) {
    if (!registry.labelByPage.has(page)) {
      adoptPage(registry, page, undefined);
    }
  }
  const handles: TabHandle[] = [];
  for (const [label, page] of registry.byId.entries()) {
    if (page.isClosed()) {
      registry.byId.delete(label);
      continue;
    }
    handles.push({
      id: label,
      label,
      url: safe(() => page.url()),
      title: await page.title().catch(() => ""),
    });
  }
  return handles;
}

/** Close the tab and drop it from the registry. */
export async function closeTab(projectSlug: string, ref: string): Promise<boolean> {
  const registry = await getRegistry(projectSlug);
  const page = registry.byId.get(ref);
  if (!page) return false;
  registry.byId.delete(ref);
  if (!page.isClosed()) {
    await page.close().catch(() => {});
  }
  return true;
}

/** Test-only: forget cached registries. Lets tests start clean. */
export function _resetTabRegistries(): void {
  _registries.clear();
}
