import { NextResponse } from "next/server";

import { getVersionStatus } from "@/server/version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/version
 *
 * Returns the installed notfair-cmo version + the latest version on npm
 * + whether an update is available. The sidebar polls this once on mount;
 * the latest-version lookup is cached for 1 hour in-process so this is
 * cheap to call.
 */
export async function GET() {
  const status = await getVersionStatus();
  return NextResponse.json(status);
}
