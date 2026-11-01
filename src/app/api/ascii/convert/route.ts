import { NextRequest, NextResponse } from "next/server";
import {
  createJob,
  saveUpload,
  startWorker,
  type JobParams,
} from "@/lib/ascii-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No video file uploaded." },
        { status: 400 },
      );
    }
    if (!file.type.startsWith("video/")) {
      return NextResponse.json(
        { error: "Please upload a video file (mp4, webm, mov, ...)." },
        { status: 400 },
      );
    }

    const num = (v: FormDataEntryValue | null, d: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : d;
    };

    const params: JobParams = {
      fileName: file.name,
      fps: num(form.get("fps"), 30),
      cols: num(form.get("cols"), 160),
      rampId: String(form.get("rampId") || "standard"),
      invert: form.get("invert") === "true",
      colored: form.get("colored") !== "false",
      monoColor: String(form.get("monoColor") || "#22c55e"),
      bgColor: String(form.get("bgColor") || "#000000"),
      fontSize: num(form.get("fontSize"), 14),
      withSound: form.get("withSound") === "true",
    };

    const job = createJob(params);
    saveUpload(job.id, Buffer.from(await file.arrayBuffer()));
    startWorker(job.id);

    return NextResponse.json({ jobId: job.id });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to start conversion." },
      { status: 500 },
    );
  }
}
