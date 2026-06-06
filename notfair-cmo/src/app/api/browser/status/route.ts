import { NextResponse } from "next/server";

import { getSessionStatus } from "@/server/browser/session";
import { listTabs } from "@/server/browser/tabs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Check whether the workspace browser is running and list its tabs.
 *
 * Cheap; safe to poll from the Settings page.
 *
 * GET /api/browser/status?project_slug=<slug>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("project_slug");
  if (!slug) {
    return NextResponse.json({ error: "project_slug query param required" }, { status: 400 });
  }
  const status = getSessionStatus(slug);
  let tabs: Array<{ id: string; url: string; title: string }> = [];
  if (status.running) {
    try {
      const handles = await listTabs(slug);
      tabs = handles.map((h) => ({ id: h.id, url: h.url, title: h.title }));
    } catch {
      // listing failed — return status without tabs rather than blowing up
    }
  }
  return NextResponse.json({ status, tabs });
}
