/**
 * Notfair-cmo version helpers.
 *
 * Reads the current version from package.json (JSON import is statically
 * resolved by Next.js so it works in dev, prod standalone, and tests).
 * Probes the npm registry for the latest published version with a 1-hour
 * cache so the UI doesn't pound registry.npmjs.org on every refresh.
 */
import pkg from "../../package.json";

const PACKAGE_NAME = "notfair-cmo";
const NPM_REGISTRY_LATEST = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const NPM_FETCH_TIMEOUT_MS = 5_000;
const LATEST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let _cachedLatest: { version: string; checkedAt: number } | null = null;

export function getCurrentVersion(): string {
  return (pkg as { version?: string }).version ?? "0.0.0";
}

/**
 * Fetch the latest published version from npm. Cached in-process for
 * 1 hour; pass `force` to bypass after a successful upgrade.
 *
 * Returns null when the registry is unreachable (offline, network down,
 * registry 5xx). Callers should treat null as "no update info" rather
 * than "no update available."
 */
export async function getLatestVersion(
  force = false,
  now: number = Date.now(),
): Promise<string | null> {
  if (
    !force &&
    _cachedLatest &&
    now - _cachedLatest.checkedAt < LATEST_CACHE_TTL_MS
  ) {
    return _cachedLatest.version;
  }
  try {
    const res = await fetch(NPM_REGISTRY_LATEST, {
      signal: AbortSignal.timeout(NPM_FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    if (typeof data.version !== "string") return null;
    _cachedLatest = { version: data.version, checkedAt: now };
    return data.version;
  } catch {
    return null;
  }
}

/** True when `a` is strictly newer than `b` by major.minor.patch ordering. */
export function isSemverGreater(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa.major !== pb.major) return pa.major > pb.major;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor;
  return pa.patch > pb.patch;
}

function parseSemver(v: string): { major: number; minor: number; patch: number } {
  // Strip any pre-release / build suffix; we only compare the numeric core.
  const core = v.split(/[-+]/)[0]!;
  const parts = core.split(".");
  return {
    major: Number(parts[0] ?? 0) || 0,
    minor: Number(parts[1] ?? 0) || 0,
    patch: Number(parts[2] ?? 0) || 0,
  };
}

export interface VersionStatus {
  current: string;
  latest: string | null;
  has_update: boolean;
}

export async function getVersionStatus(): Promise<VersionStatus> {
  const current = getCurrentVersion();
  const latest = await getLatestVersion();
  return {
    current,
    latest,
    has_update: latest !== null && isSemverGreater(latest, current),
  };
}

/** Test-only: forget the cached registry response. */
export function _resetLatestCache(): void {
  _cachedLatest = null;
}
