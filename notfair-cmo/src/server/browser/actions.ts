/**
 * Page-level browser primitives the MCP tools wrap.
 *
 * Each function takes a Playwright Page and a small typed opts payload,
 * runs the action with sensible defaults, and returns a normalized result.
 * Keeping the action layer separate from the MCP tool layer means the
 * tools can stay one-screen each (zod schema + handler) and these can be
 * unit-tested without any MCP envelope plumbing.
 *
 * Snapshot format: V1 returns a flat list of interactable elements with
 * stable ref ids (e1, e2, ...) scoped to the snapshot call. This matches
 * Hermes' agent-browser ref convention so agent prompts can reuse the
 * same mental model. The full Playwright aria tree comes in V1.1.
 */
import type { Page } from "playwright-core";

export interface NavigateOptions {
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  timeoutMs?: number;
}

export interface NavigateResult {
  url: string;
  title: string;
}

export async function navigate(page: Page, opts: NavigateOptions): Promise<NavigateResult> {
  await page.goto(opts.url, {
    waitUntil: opts.waitUntil ?? "load",
    timeout: opts.timeoutMs ?? 30_000,
  });
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
  };
}

export interface SnapshotElement {
  /** Ref id stable within this snapshot, e.g. "e1". */
  ref: string;
  /** ARIA role or tag name. */
  role: string;
  /** Accessible name when available, else trimmed text. */
  name: string;
  /** Empty for buttons/links; populated for inputs/selects. */
  value?: string;
  /** True when disabled / aria-disabled. */
  disabled?: boolean;
  /** href for links so agents can decide whether to navigate directly. */
  href?: string;
}

export interface SnapshotResult {
  url: string;
  title: string;
  elements: SnapshotElement[];
  /** Truncated text content of the page, for context. */
  text: string;
}

const SNAPSHOT_ELEMENT_LIMIT = 200;
const SNAPSHOT_TEXT_CHAR_LIMIT = 8_000;

/**
 * Build a flat list of interactable elements + a text excerpt.
 *
 * We evaluate in the page rather than using Playwright's role queries
 * because we want a single round-trip that returns everything we need:
 * role, accessible name, current value, href, and a temporary numbered
 * attribute we hang off each element so subsequent click/type calls can
 * resolve back to the same DOM node via [data-notfair-ref="eN"].
 */
export async function snapshot(page: Page): Promise<SnapshotResult> {
  const { url, title, elements, text } = await page.evaluate(
    ({ elemLimit, textLimit }) => {
      const REF_ATTR = "data-notfair-ref";
      // Clear stale refs from a previous snapshot.
      for (const stale of Array.from(document.querySelectorAll(`[${REF_ATTR}]`))) {
        stale.removeAttribute(REF_ATTR);
      }

      const SELECTOR = [
        "a[href]",
        "button",
        "input:not([type=hidden])",
        "select",
        "textarea",
        "[role=button]",
        "[role=link]",
        "[role=checkbox]",
        "[role=radio]",
        "[role=tab]",
        "[role=menuitem]",
        "[contenteditable=true]",
      ].join(",");

      const isVisible = (el: Element): boolean => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el as HTMLElement);
        return style.visibility !== "hidden" && style.display !== "none";
      };

      const accessibleName = (el: Element): string => {
        const aria = el.getAttribute("aria-label");
        if (aria) return aria;
        const labelled = el.getAttribute("aria-labelledby");
        if (labelled) {
          const node = document.getElementById(labelled);
          if (node?.textContent) return node.textContent.trim();
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const id = el.getAttribute("id");
          if (id) {
            const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (label?.textContent) return label.textContent.trim();
          }
          if (el.placeholder) return el.placeholder;
        }
        const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
        return text.trim().slice(0, 200);
      };

      const out: Array<Record<string, unknown>> = [];
      let counter = 0;
      const nodes = Array.from(document.querySelectorAll(SELECTOR)).filter(isVisible);
      for (const el of nodes) {
        if (counter >= elemLimit) break;
        counter++;
        const ref = `e${counter}`;
        el.setAttribute(REF_ATTR, ref);

        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") ?? tag;
        const item: Record<string, unknown> = {
          ref,
          role,
          name: accessibleName(el),
        };
        if (el instanceof HTMLAnchorElement && el.href) item.href = el.href;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          item.value = el.value;
        }
        if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") {
          item.disabled = true;
        }
        out.push(item);
      }

      const rawText = document.body?.innerText ?? "";
      const text = rawText.slice(0, textLimit);

      return {
        url: window.location.href,
        title: document.title,
        elements: out,
        text,
      };
    },
    { elemLimit: SNAPSHOT_ELEMENT_LIMIT, textLimit: SNAPSHOT_TEXT_CHAR_LIMIT },
  );
  return { url, title, elements: elements as unknown as SnapshotElement[], text };
}

function refSelector(ref: string): string {
  // CSS attribute selectors don't need escaping for our ref format (eN).
  if (!/^e\d+$/.test(ref)) {
    throw new Error(`Invalid ref "${ref}" — expected "e<number>"`);
  }
  return `[data-notfair-ref="${ref}"]`;
}

export interface ClickOptions {
  ref: string;
  button?: "left" | "right" | "middle";
  modifiers?: ("Alt" | "Control" | "Meta" | "Shift")[];
  doubleClick?: boolean;
  timeoutMs?: number;
}

export async function click(page: Page, opts: ClickOptions): Promise<void> {
  const locator = page.locator(refSelector(opts.ref));
  const timeout = opts.timeoutMs ?? 10_000;
  if (opts.doubleClick) {
    await locator.dblclick({ button: opts.button, modifiers: opts.modifiers, timeout });
  } else {
    await locator.click({ button: opts.button, modifiers: opts.modifiers, timeout });
  }
}

export interface TypeOptions {
  ref: string;
  text: string;
  /** Press Enter after typing. */
  submit?: boolean;
  /** Clear the field before typing. Default: true. */
  clearFirst?: boolean;
  timeoutMs?: number;
}

export async function type(page: Page, opts: TypeOptions): Promise<void> {
  const locator = page.locator(refSelector(opts.ref));
  const timeout = opts.timeoutMs ?? 10_000;
  if (opts.clearFirst !== false) {
    await locator.fill("", { timeout });
  }
  await locator.fill(opts.text, { timeout });
  if (opts.submit) {
    await locator.press("Enter", { timeout });
  }
}

export interface PressOptions {
  /** Playwright key string, e.g. "Enter", "Tab", "Control+a". */
  key: string;
  /** Optional ref to focus before pressing. If omitted, presses at page level. */
  ref?: string;
  timeoutMs?: number;
}

export async function press(page: Page, opts: PressOptions): Promise<void> {
  const timeout = opts.timeoutMs ?? 10_000;
  if (opts.ref) {
    const locator = page.locator(refSelector(opts.ref));
    await locator.press(opts.key, { timeout });
  } else {
    await page.keyboard.press(opts.key);
  }
}

export interface ScrollOptions {
  direction: "up" | "down" | "left" | "right";
  /** Pixels. Default: 600 (one screen-ish on most viewports). */
  amount?: number;
}

export async function scroll(page: Page, opts: ScrollOptions): Promise<void> {
  const amount = opts.amount ?? 600;
  const dx =
    opts.direction === "left" ? -amount : opts.direction === "right" ? amount : 0;
  const dy =
    opts.direction === "up" ? -amount : opts.direction === "down" ? amount : 0;
  await page.evaluate(({ x, y }) => window.scrollBy(x, y), { x: dx, y: dy });
}

export async function back(page: Page): Promise<void> {
  await page.goBack({ waitUntil: "load" }).catch(() => {});
}
