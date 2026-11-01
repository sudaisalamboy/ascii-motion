import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { jobOutputPath } from "@/lib/ascii-jobs";

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
  const outputPath = jobOutputPath(jobId);
  try {
    const data = await readFile(outputPath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "content-type": "video/mp4",
        "content-disposition": 'inline; filename="text-art.mp4"',
        "content-length": String(data.length),
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Result not ready or file is missing." },
      { status: 404 },
    );
  }
}
