import { NextRequest, NextResponse } from "next/server";
import { getJob, readJobStatus } from "@/lib/ascii-jobs";

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

  // Primary source: in-memory map (live). Falls back to disk (status.json,
  // written by the worker) so status survives dev HMR / module reloads.
  const mem = getJob(jobId);
  if (mem) {
    return NextResponse.json({
      id: mem.id,
      status: mem.status,
      phase: mem.phase,
      done: mem.done,
      total: mem.total,
      error: mem.error,
      params: mem.params,
      result: mem.result
        ? {
            frameCount: mem.result.frameCount,
            width: mem.result.width,
            height: mem.result.height,
            duration: mem.result.duration,
            cols: mem.result.cols,
            rows: mem.result.rows,
          }
        : undefined,
    });
  }

  const disk = await readJobStatus(jobId);
  if (!disk) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  const result = disk.result as
    | {
        frameCount: number;
        width: number;
        height: number;
        duration: number;
        cols: number;
        rows: number;
      }
    | undefined;
  return NextResponse.json({
    id: jobId,
    status: disk.status,
    phase: disk.phase,
    done: disk.done,
    total: disk.total,
    error: disk.error,
    params: undefined,
    result: result
      ? {
          frameCount: result.frameCount,
          width: result.width,
          height: result.height,
          duration: result.duration,
          cols: result.cols,
          rows: result.rows,
        }
      : undefined,
  });
}
