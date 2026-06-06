import { NextResponse } from "next/server";

import { stopBrowser } from "@/server/browser/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stop the workspace browser for a project.
 *
 * Cookies persist in the workspace user-data-dir, so the next launch
 * picks up the same login state. Used by Settings → "Restart browser"
 * and from the agent-facing browser_shutdown tool.
 *
 * POST body: { project_slug: string }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { project_slug?: string };
  if (!body.project_slug) {
    return NextResponse.json({ error: "project_slug required" }, { status: 400 });
  }
  try {
    await stopBrowser(body.project_slug);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
