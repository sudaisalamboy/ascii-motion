import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { jobPreviewPath } from "@/lib/ascii-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json(
      { error: "jobId is required." },
      { status: 400 },
    );
  }
  try {
    const data = await readFile(jobPreviewPath(jobId));
    return new NextResponse(data, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Preview not ready or file is missing." },
      { status: 404 },
    );
  }
}
