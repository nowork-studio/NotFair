import { NextResponse } from "next/server";

import {
  getOrLaunchBrowser,
  getSessionStatus,
  registerShutdownHooks,
} from "@/server/browser/session";
import { openTab } from "@/server/browser/tabs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Launch (or attach to) the workspace browser for a project.
 *
 * Headed by default — onboarding uses this to pop Chrome open so the user
 * can sign into Google, Meta, etc. Once cookies persist in the workspace
 * user-data-dir, agents on subsequent runs inherit the logged-in state
 * automatically.
 *
 * POST body:
 *   { project_slug: string, signin_url?: string, headless?: boolean }
 *
 * Returns: { status, signin_tab? }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    project_slug?: string;
    signin_url?: string;
    headless?: boolean;
  };
  if (!body.project_slug) {
    return NextResponse.json(
      { error: "project_slug required" },
      { status: 400 },
    );
  }

  try {
    registerShutdownHooks();
    await getOrLaunchBrowser(body.project_slug, { headless: body.headless ?? false });
    const status = getSessionStatus(body.project_slug);

    let signinTab: { id: string; url: string } | undefined;
    if (body.signin_url) {
      const handle = await openTab(body.project_slug, {
        label: "signin",
        url: body.signin_url,
      });
      signinTab = { id: handle.id, url: handle.url };
    }

    return NextResponse.json({ status, signin_tab: signinTab });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
