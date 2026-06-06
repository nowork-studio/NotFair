/**
 * Per-workspace browser profile path + port resolution.
 *
 * Layout under ~/.notfair-cmo/ (override via NOTFAIR_CMO_DATA_DIR):
 *
 *   projects/<slug>/browser/
 *     user-data/         <- Chrome --user-data-dir (cookies, login state)
 *     state.json         <- last-launched metadata (signed_in_at, etc.)
 *
 * CDP ports are hashed deterministically from the project slug into the
 * 19000-19099 range. We intentionally avoid openclaw's 18800-18899 range
 * so both can run on the same machine without colliding.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/** First CDP port in our managed range. */
export const CDP_PORT_RANGE_START = 19000;
/** Last CDP port in our managed range. */
export const CDP_PORT_RANGE_END = 19099;

const PROJECT_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const MAX_SLUG_LENGTH = 64;

/** Resolve the notfair-cmo data dir (matches db.ts / agent-meta.ts convention). */
export function notfairDataDir(): string {
  return process.env.NOTFAIR_CMO_DATA_DIR ?? join(homedir(), ".notfair-cmo");
}

/** True when slug matches the lowercase-alphanum + hyphen format the rest of notfair-cmo uses. */
export function isValidProjectSlug(slug: string): boolean {
  if (!slug || slug.length > MAX_SLUG_LENGTH) return false;
  return PROJECT_SLUG_REGEX.test(slug);
}

/** Per-project browser dir (parent of user-data + metadata files). */
export function resolveBrowserProfileDir(projectSlug: string): string {
  assertValidSlug(projectSlug);
  return join(notfairDataDir(), "projects", projectSlug, "browser");
}

/** Chrome --user-data-dir for the workspace. Persists cookies / login state. */
export function resolveUserDataDir(projectSlug: string): string {
  return join(resolveBrowserProfileDir(projectSlug), "user-data");
}

/**
 * Deterministic CDP port for a project slug.
 *
 * Same slug always hashes to the same port across restarts, so a relaunched
 * notfair-cmo process can reattach to a still-running Chrome without
 * re-discovering ports.
 */
export function allocateCdpPort(projectSlug: string): number {
  assertValidSlug(projectSlug);
  const span = CDP_PORT_RANGE_END - CDP_PORT_RANGE_START + 1;
  const hash = createHash("sha256").update(projectSlug).digest();
  const offset = hash.readUInt32BE(0) % span;
  return CDP_PORT_RANGE_START + offset;
}

function assertValidSlug(slug: string): void {
  if (!isValidProjectSlug(slug)) {
    throw new Error(
      `Invalid project slug "${slug}": must match ${PROJECT_SLUG_REGEX} and be <=${MAX_SLUG_LENGTH} chars`,
    );
  }
}
