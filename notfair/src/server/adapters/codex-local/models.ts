import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { HarnessModelOption } from "../types";
import { codexConfigDir } from "./mcp";

/**
 * Model discovery for Codex — read the PROVIDER's list, don't hardcode.
 *
 * The codex CLI has no "list models" command, but its TUI fetches the
 * account-scoped model list from OpenAI and caches it at
 * `~/.codex/models_cache.json` (slug, display_name, visibility,
 * priority, …). We read that cache: it's the same source the user's own
 * `/model` picker shows, refreshed whenever they run codex.
 *
 * Entries with `visibility: "hide"` are internal (e.g. codex-auto-review)
 * and excluded. Sorted by the cache's own `priority` (ascending — that's
 * the order the TUI shows).
 *
 * Fallback: when the cache is missing/unreadable (fresh install that has
 * never run the TUI), return a minimal static list so the selector still
 * works. Never throws.
 */

type CachedModel = {
  slug?: unknown;
  display_name?: unknown;
  visibility?: unknown;
  priority?: unknown;
  context_window?: unknown;
};

const FALLBACK: HarnessModelOption[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
];

async function readConfiguredModel(configFile: string): Promise<string | null> {
  try {
    const raw = await readFile(configFile, "utf8");
    // NotFair invokes Codex without a profile, so only the root-level `model`
    // applies. Stop at the first TOML table to avoid mistaking a nested key
    // for the CLI's effective default.
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[")) break;
      const match = /^model\s*=\s*("(?:\\.|[^"\\])*"|'[^']*'|[^\s#]+)\s*(?:#.*)?$/.exec(
        trimmed,
      );
      if (!match) continue;
      const value = match[1];
      if (value.startsWith('"')) {
        try {
          return JSON.parse(value) as string;
        } catch {
          return null;
        }
      }
      return value.startsWith("'") ? value.slice(1, -1) : value;
    }
  } catch {
    // Missing or unreadable config means Codex uses its provider default.
  }
  return null;
}

function markDefaultModel(
  models: HarnessModelOption[],
  configuredModel: string | null,
): HarnessModelOption[] {
  const defaultValue = configuredModel ?? models[0]?.value;
  if (!defaultValue) return models;

  let found = false;
  const marked = models.map((model) => {
    const isDefault = model.value === defaultValue;
    if (isDefault) found = true;
    return isDefault ? { ...model, is_default: true } : model;
  });

  // A configured model can be absent from a stale provider cache. Keep it
  // visible as the effective default rather than falling back to a wrong
  // label until Codex refreshes models_cache.json.
  return found
    ? marked
    : [{ value: defaultValue, label: defaultValue, is_default: true }, ...marked];
}

export async function listCodexModels(
  cacheFile: string = join(codexConfigDir(), "models_cache.json"),
  configFile: string = join(codexConfigDir(), "config.toml"),
): Promise<HarnessModelOption[]> {
  const configuredModel = await readConfiguredModel(configFile);
  try {
    const raw = await readFile(cacheFile, "utf8");
    const parsed = JSON.parse(raw) as { models?: CachedModel[] };
    const models = (parsed.models ?? [])
      .filter(
        (m): m is CachedModel & { slug: string } =>
          typeof m.slug === "string" &&
          m.slug.length > 0 &&
          m.visibility !== "hide",
      )
      .sort(
        (a, b) =>
          (typeof a.priority === "number" ? a.priority : Number.MAX_SAFE_INTEGER) -
          (typeof b.priority === "number" ? b.priority : Number.MAX_SAFE_INTEGER),
      )
      .map<HarnessModelOption>((m) => ({
        value: m.slug,
        label: typeof m.display_name === "string" && m.display_name ? m.display_name : m.slug,
        ...(typeof m.context_window === "number" && m.context_window > 0
          ? { context_window: m.context_window }
          : {}),
      }));
    return markDefaultModel(models.length > 0 ? models : FALLBACK, configuredModel);
  } catch {
    return markDefaultModel(FALLBACK, configuredModel);
  }
}
