import { execFile } from "node:child_process";
import { platform } from "node:os";

/**
 * Open the OS-native folder-picker dialog on the user's local machine and
 * return the chosen absolute path. We rely on the fact that this server
 * runs in the same single-user session as the browser (loopback-only,
 * `npx notfair-cmo` model) — the dialog appears on the user's screen, in
 * front of the same person clicking the Browse button.
 *
 * Implementations are platform-specific because there is no cross-platform
 * native picker primitive in Node. macOS uses AppleScript's `choose folder`,
 * which returns a POSIX path. Linux + Windows fallbacks are TODO; callers
 * receive a clear `kind: "unsupported"` they can branch on (UI falls back
 * to a text input).
 *
 * The dialog is modal in the OS sense (blocks until the user picks or
 * cancels), so we set a generous timeout to avoid wedging the route if
 * something has gone wrong on the OS side.
 */

const DIALOG_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — the user might think

export type PickFolderResult =
  | { ok: true; path: string }
  | { ok: false; kind: "cancelled" }
  | { ok: false; kind: "unsupported"; platform: string }
  | { ok: false; kind: "error"; message: string };

export async function pickFolder(opts: {
  prompt?: string;
  defaultLocation?: string;
  signal?: AbortSignal;
}): Promise<PickFolderResult> {
  const p = platform();
  if (p === "darwin") {
    return pickFolderMac(opts);
  }
  // TODO: linux (zenity / kdialog), win32 (PowerShell FolderBrowserDialog).
  return { ok: false, kind: "unsupported", platform: p };
}

async function pickFolderMac(opts: {
  prompt?: string;
  defaultLocation?: string;
  signal?: AbortSignal;
}): Promise<PickFolderResult> {
  // Build the AppleScript expression carefully: we control both args, so
  // there's no untrusted shell-injection vector, but we still escape any
  // embedded double quotes / backslashes so a path with quotes can't break
  // the script. Args reach osascript via execFile (not a shell) so no
  // additional shell-quoting is needed for the surrounding command line.
  const prompt = (opts.prompt ?? "Select a folder").replace(/["\\]/g, "\\$&");
  const defaultClause = opts.defaultLocation
    ? ` default location POSIX file "${opts.defaultLocation.replace(/["\\]/g, "\\$&")}"`
    : "";
  const script = `
    try
      set f to choose folder with prompt "${prompt}"${defaultClause}
      return POSIX path of f
    on error errMsg number errNum
      if errNum is -128 then
        return "__USER_CANCELLED__"
      else
        error errMsg number errNum
      end if
    end try
  `;

  const result = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve) => {
    execFile(
      "/usr/bin/osascript",
      ["-e", script],
      { timeout: DIALOG_TIMEOUT_MS, signal: opts.signal },
      (err, stdout, stderr) => {
        // With default options (no encoding override), Node returns
        // stdout/stderr as strings. err carries .code on timeout /
        // non-zero exit; we collapse it to a numeric code or 1 fallback.
        const errCode = err
          ? typeof (err as NodeJS.ErrnoException).code === "number"
            ? ((err as unknown as { code: number }).code as number)
            : 1
          : 0;
        resolve({ stdout, stderr, code: errCode });
      },
    );
  });

  if (result.code !== 0) {
    return {
      ok: false,
      kind: "error",
      message:
        result.stderr.trim() ||
        `osascript exited with code ${result.code ?? "unknown"}`,
    };
  }
  const out = result.stdout.trim();
  if (out === "__USER_CANCELLED__" || out === "") {
    return { ok: false, kind: "cancelled" };
  }
  // AppleScript's `POSIX path of` returns a trailing slash for folders;
  // strip it for consistency with how users typically write paths.
  const normalized = out.replace(/\/+$/, "");
  return { ok: true, path: normalized };
}
