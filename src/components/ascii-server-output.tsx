"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  Loader2,
  Sparkles,
  Video as VideoIcon,
  Server,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

import type { ConvertSettings } from "@/lib/video-ascii";

type Phase = "idle" | "uploading" | "processing" | "done" | "error";

type JobStatus = {
  id: string;
  status: string;
  phase: string;
  done: number;
  total: number;
  error?: string;
  result?: {
    frameCount: number;
    width: number;
    height: number;
    duration: number;
    cols: number;
    rows: number;
  };
};

const PHASE_LABEL: Record<string, string> = {
  queued: "Queued",
  extracting: "Extracting frames",
  rendering: "Rendering text art",
  compiling: "Compiling video",
  done: "Done",
  error: "Error",
};

function overallPercent(job: JobStatus | null): number {
  if (!job) return 0;
  if (job.status === "done") return 100;
  if (job.status === "extracting") return 6;
  if (job.status === "rendering") {
    if (job.total > 0) return Math.round(15 + (job.done / job.total) * 75);
    return 15;
  }
  if (job.status === "compiling") return 95;
  return 0;
}

type Props = {
  file: File;
  settings: ConvertSettings;
  onBusyChange: (busy: boolean) => void;
};

export function ServerOutput({ file, settings, onBusyChange }: Props) {
  const {
    cols,
    fps,
    rampId,
    invert,
    colored,
    monoColor,
    bgColor,
    fontSize,
    withSound,
  } = settings;

  const [phase, setPhase] = useState<Phase>("idle");
  const [jobId, setJobId] = useState<string>("");
  const [job, setJob] = useState<JobStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    onBusyChange(phase === "uploading" || phase === "processing");
  }, [phase, onBusyChange]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Poll status while a job is running.
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const stopPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    const poll = async () => {
      try {
        const res = await fetch(`/api/ascii/status?jobId=${jobId}`);
        if (!res.ok) return;
        const data: JobStatus = await res.json();
        if (!active) return;
        setJob(data);
        if (data.status === "done") {
          setPhase("done");
          stopPoll();
          toast.success("Text-art video ready!");
        } else if (data.status === "error") {
          setPhase("error");
          stopPoll();
          toast.error(data.error || "Processing failed.");
        }
      } catch {
        /* transient — keep polling */
      }
    };
    poll();
    pollRef.current = setInterval(poll, 600);
    return () => {
      active = false;
      stopPoll();
    };
  }, [jobId]);

  const convert = async () => {
    setPhase("uploading");
    setJob(null);
    if (pollRef.current) clearInterval(pollRef.current);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("fps", String(fps));
    fd.append("cols", String(cols));
    fd.append("rampId", rampId);
    fd.append("invert", String(invert));
    fd.append("colored", String(colored));
    fd.append("monoColor", monoColor);
    fd.append("bgColor", bgColor);
    fd.append("fontSize", String(fontSize));
    fd.append("withSound", String(withSound));

    try {
      const res = await fetch("/api/ascii/convert", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Upload failed.");
        setPhase("idle");
        return;
      }
      setJobId(data.jobId);
      setPhase("processing");
    } catch (e: any) {
      toast.error(e?.message || "Upload failed.");
      setPhase("idle");
    }
  };

  const startOver = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setJobId("");
    setJob(null);
    setPhase("idle");
  };

  const busy = phase === "uploading" || phase === "processing";
  const showResult = phase === "done" && job?.result;
  const showError = phase === "error";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-extrabold uppercase tracking-tight">
          <span className="flex h-6 w-6 items-center justify-center border-2 border-[var(--brutal-border)] bg-accent text-black">
            <Server className="h-3.5 w-3.5" />
          </span>
          On the server
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showResult ? (
          <>
            <div className="border-2 border-[var(--brutal-border)] bg-black">
              <video
                src={`/api/ascii/result?jobId=${jobId}`}
                controls
                autoPlay
                loop
                playsInline
                className="w-full"
              />
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">
                {job?.result?.cols}×{job?.result?.rows} chars
              </Badge>
              <Badge variant="outline" className="font-mono">
                {fps} FPS
              </Badge>
              <Badge variant="outline" className="font-mono">
                {job?.result?.frameCount} frames
              </Badge>
              <Badge variant="outline" className="font-mono">
                {job?.result?.duration?.toFixed(2)}s
              </Badge>
              <Badge variant="outline" className="font-mono">
                {job?.result?.width}×{job?.result?.height}px
              </Badge>
            </div>
            <Separator />
            <div className="flex items-center gap-2">
              <Button asChild className="flex-1">
                <a
                  href={`/api/ascii/result?jobId=${jobId}`}
                  download={`text-art-${jobId.slice(0, 6)}.mp4`}
                >
                  <Download className="h-4 w-4" /> Download MP4
                </a>
              </Button>
              <Button variant="ghost" onClick={startOver} className="flex-1">
                <RefreshCw className="h-4 w-4" /> Start over
              </Button>
            </div>
          </>
        ) : showError ? (
          <div className="flex flex-col items-center justify-center gap-3 border-2 border-destructive bg-destructive/10 p-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm font-medium">Processing failed</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {job?.error || "Something went wrong on the server."}
            </p>
            <Button variant="outline" size="sm" onClick={convert}>
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
          </div>
        ) : busy ? (
          <div className="space-y-4 py-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-black" />
              <div>
                <p className="text-sm font-medium">
                  {phase === "uploading"
                    ? "Uploading to server..."
                    : PHASE_LABEL[job?.phase || "queued"] || "Processing"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {job?.total
                    ? `${job.done} / ${job.total} frames`
                    : "Working on it..."}
                </p>
              </div>
            </div>
            <Progress value={overallPercent(job)} />
            <p className="text-center text-xs text-muted-foreground">
              Server is extracting frames, converting each to text art, and
              compiling them back into a video.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <VideoIcon className="h-8 w-8 opacity-40" />
              <p className="text-sm">
                Click below to upload &amp; process on the server.
              </p>
            </div>
            <Button
              className="w-full bg-foreground text-background hover:bg-secondary hover:text-black"
              onClick={convert}
            >
              <Sparkles className="h-4 w-4" />
              Convert to text art
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Server className="h-3 w-3" />
              Uploaded &amp; processed with ffmpeg + canvas
            </p>
          </div>
        )}

        {showResult && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              First frame preview
            </Label>
            <img
              src={`/api/ascii/preview?jobId=${jobId}`}
              alt="First text-art frame"
              className="w-full border-2 border-[var(--brutal-border)] bg-black"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
