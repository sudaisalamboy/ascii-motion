"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Download,
  Loader2,
  Sparkles,
  Video as VideoIcon,
  Cpu,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

import {
  CHAR_RAMPS,
  computeRows,
  extractAndConvert,
  measureGlyph,
  pickRecordingMime,
  rampSampleChar,
  renderAsciiFrame,
  type AsciiFrame,
  type ConvertSettings,
  type RenderStyle,
} from "@/lib/video-ascii";

const FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

type Phase = "idle" | "processing" | "ready" | "recording";

type Props = {
  file: File;
  videoUrl: string;
  settings: ConvertSettings;
  onBusyChange: (busy: boolean) => void;
};

export function ClientOutput({ file, videoUrl, settings, onBusyChange }: Props) {
  const {
    cols,
    fps,
    rampId,
    invert,
    colored,
    monoColor,
    bgColor,
    fontSize,
  } = settings;

  const [meta, setMeta] = useState<{
    duration: number;
    width: number;
    height: number;
  } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [frames, setFrames] = useState<AsciiFrame[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [outputUrl, setOutputUrl] = useState<string>("");
  const [recordProgress, setRecordProgress] = useState(0);

  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<AsciiFrame[]>([]);
  const styleRef = useRef<RenderStyle | null>(null);
  const rafRef = useRef<number | null>(null);
  const currentFrameRef = useRef(0);
  const fpsRef = useRef(fps);
  const cancelRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const outputUrlRef = useRef("");

  const ramp = useMemo(
    () => CHAR_RAMPS.find((r) => r.id === rampId) ?? CHAR_RAMPS[0],
    [rampId],
  );

  const glyph = useMemo(() => {
    const font = `${fontSize}px ${FONT_STACK}`;
    return { ...measureGlyph(font, rampSampleChar(ramp)), font };
  }, [fontSize, ramp]);

  const totalFrames = frames.length;
  const gridRows = useMemo(() => {
    if (!meta) return 0;
    const aspect = glyph.charW / glyph.charH;
    return computeRows(cols, meta.width, meta.height, aspect);
  }, [meta, glyph, cols]);

  // Report busy state up so the parent can disable controls.
  useEffect(() => {
    onBusyChange(phase === "processing" || phase === "recording");
  }, [phase, onBusyChange]);

  // Keep ref mirrors for RAF closures.
  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);
  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  // Keep render style in sync; live-update the current frame for
  // render-time settings (color / font / background / watermark).
  useEffect(() => {
    styleRef.current = {
      fontSize,
      charW: glyph.charW,
      charH: glyph.charH,
      colored,
      monoColor,
      background: bgColor,
      font: glyph.font,
      watermark: settings.watermark,
    };
    if (framesRef.current.length > 0 && canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        const f = framesRef.current[currentFrameRef.current];
        if (f) renderAsciiFrame(ctx, f, styleRef.current);
      }
    }
  }, [fontSize, glyph, colored, monoColor, bgColor]);

  // Resize the canvas when grid metrics or frame count change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || totalFrames === 0) return;
    canvas.width = Math.round(cols * glyph.charW);
    canvas.height = Math.round(gridRows * glyph.charH);
    const ctx = canvas.getContext("2d");
    if (ctx && framesRef.current.length > 0 && styleRef.current) {
      const f =
        framesRef.current[currentFrameRef.current] ?? framesRef.current[0];
      if (f) renderAsciiFrame(ctx, f, styleRef.current);
    }
  }, [cols, glyph, gridRows, totalFrames]);

  // Results are reset via the parent's `key` prop (which includes the file
  // and the structural settings cols/fps/rampId/invert) — no reset effect
  // needed here. Render-time settings (color / font / background) live-update
  // the preview through the style-sync effect above.

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* noop */
        }
      }
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    };
  }, []);

  const onLoadedMetadata = () => {
    const v = sourceVideoRef.current;
    if (!v) return;
    setMeta({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
  };

  const drawFrame = useCallback((index: number) => {
    const canvas = canvasRef.current;
    const style = styleRef.current;
    if (!canvas || !style) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const f = framesRef.current[index];
    if (!f) return;
    renderAsciiFrame(ctx, f, style);
  }, []);

  const estFrames = meta ? Math.max(0, Math.floor(meta.duration * fps)) : 0;

  const convert = async () => {
    const v = sourceVideoRef.current;
    if (!v || !meta) return;
    if (estFrames > 1200) {
      toast.error(
        `That would be ${estFrames} frames — too many for in-browser processing. Try a shorter clip, lower FPS, or use Server mode.`,
      );
      return;
    }
    if (v.readyState < 2) {
      await new Promise<void>((resolve) => {
        v.addEventListener("loadeddata", () => resolve(), { once: true });
      });
    }

    setPhase("processing");
    setProgress({ done: 0, total: estFrames || 1 });
    cancelRef.current = false;

    const aspect = glyph.charW / glyph.charH;
    const rows = computeRows(cols, meta.width, meta.height, aspect);

    try {
      const result = await extractAndConvert(
        v,
        fps,
        cols,
        rows,
        { rampChars: ramp.chars, invert, colored },
        (done, total) => setProgress({ done, total }),
        () => cancelRef.current,
      );
      if (cancelRef.current) {
        setPhase("idle");
        setFrames([]);
        return;
      }
      setFrames(result);
      framesRef.current = result;
      setCurrentFrame(0);
      currentFrameRef.current = 0;
      setPhase("ready");
      requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas || !styleRef.current) return;
        canvas.width = Math.round(cols * glyph.charW);
        canvas.height = Math.round(rows * glyph.charH);
        const ctx = canvas.getContext("2d");
        if (ctx && result[0]) renderAsciiFrame(ctx, result[0], styleRef.current);
      });
      toast.success(`Compiled ${result.length} text-art frames at ${fps} FPS.`);
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong while processing the video.");
      setPhase("idle");
    }
  };

  const cancelProcessing = () => {
    cancelRef.current = true;
  };

  const stopLoop = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const play = () => {
    if (framesRef.current.length === 0 || isPlaying) return;
    setIsPlaying(true);
    const f = fpsRef.current;
    const total = framesRef.current.length;
    const dur = total / f;
    let startTime = performance.now() - (currentFrameRef.current / f) * 1000;
    const loop = (now: number) => {
      let elapsed = (now - startTime) / 1000;
      if (elapsed >= dur) {
        startTime = now;
        elapsed = 0;
      }
      const fi = Math.min(total - 1, Math.floor(elapsed * f));
      if (fi !== currentFrameRef.current) {
        currentFrameRef.current = fi;
        setCurrentFrame(fi);
        drawFrame(fi);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const pause = () => {
    setIsPlaying(false);
    stopLoop();
  };

  const restart = () => {
    stopLoop();
    setIsPlaying(false);
    currentFrameRef.current = 0;
    setCurrentFrame(0);
    drawFrame(0);
  };

  const scrub = (value: number) => {
    pause();
    currentFrameRef.current = value;
    setCurrentFrame(value);
    drawFrame(value);
  };

  const exportVideo = async () => {
    const canvas = canvasRef.current;
    if (!canvas || framesRef.current.length === 0) return;
    if (typeof MediaRecorder === "undefined") {
      toast.error("Your browser doesn't support video recording.");
      return;
    }
    const mime = pickRecordingMime();
    let stream: MediaStream;
    try {
      stream = canvas.captureStream(fps);
    } catch {
      toast.error("Couldn't capture the canvas.");
      return;
    }

    // If "With sound" is on, mix in the source video's audio track.
    // The video stays muted to the user but captureStream still yields audio.
    let audioPlaying = false;
    const src = sourceVideoRef.current;
    if (settings.withSound && src) {
      try {
        const anySrc = src as any;
        const vStream: MediaStream | undefined =
          anySrc.captureStream?.() ?? anySrc.mozCaptureStream?.();
        const audioTracks = vStream?.getAudioTracks?.() ?? [];
        if (audioTracks.length > 0) {
          audioTracks.forEach((t) => stream.addTrack(t));
          src.muted = true;
          src.currentTime = 0;
          await src.play().catch(() => {});
          audioPlaying = true;
        }
      } catch {
        /* no audio track available — proceed silently */
      }
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        stream,
        mime
          ? { mimeType: mime, videoBitsPerSecond: 8_000_000 }
          : { videoBitsPerSecond: 8_000_000 },
      );
    } catch {
      toast.error("Recording isn't supported in this browser.");
      return;
    }
    recorderRef.current = recorder;
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    setPhase("recording");
    setRecordProgress(0);
    setIsPlaying(false);
    stopLoop();
    recorder.start();
    drawFrame(0);

    const total = framesRef.current.length;
    const f = fpsRef.current;
    const dur = total / f;
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const loop = (now: number) => {
        const elapsed = (now - start) / 1000;
        const fi = Math.min(total - 1, Math.floor(elapsed * f));
        drawFrame(fi);
        currentFrameRef.current = fi;
        setCurrentFrame(fi);
        setRecordProgress(Math.round((fi / Math.max(1, total - 1)) * 100));
        if (elapsed >= dur) {
          resolve();
          return;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    });
    await new Promise((r) => setTimeout(r, 120));
    try {
      recorder.stop();
    } catch {
      /* noop */
    }
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    if (audioPlaying) {
      try {
        src?.pause();
      } catch {
        /* noop */
      }
    }

    const blob = new Blob(chunks, { type: mime || "video/webm" });
    const url = URL.createObjectURL(blob);
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    outputUrlRef.current = url;
    setOutputUrl(url);
    setPhase("ready");
    setRecordProgress(100);
    toast.success("Text-art video ready! Preview and download below.");
  };

  const busy = phase === "processing" || phase === "recording";
  const hasOutput = outputUrl.length > 0;
  const outputExt = outputUrl.includes("mp4") ? "mp4" : "webm";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-extrabold uppercase tracking-tight">
          <span className="flex h-6 w-6 items-center justify-center border-2 border-[var(--brutal-border)] bg-secondary text-black">
            <Cpu className="h-3.5 w-3.5" />
          </span>
          On your device
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hidden source video used for frame extraction */}
        <video
          ref={sourceVideoRef}
          src={videoUrl || undefined}
          className="hidden"
          muted
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          onLoadedMetadata={onLoadedMetadata}
        />

        <div className="relative border-2 border-[var(--brutal-border)] bg-black">
          <canvas
            ref={canvasRef}
            className="mx-auto block h-auto w-full"
          />
          {totalFrames === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <VideoIcon className="h-8 w-8 opacity-40" />
              <p className="text-sm">
                {phase === "processing"
                  ? "Compiling frames..."
                  : "Convert to see text art here."}
              </p>
            </div>
          )}
        </div>

        {phase === "processing" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Extracting &amp; converting frames</span>
              <span className="font-mono">
                {progress.done}/{progress.total}
              </span>
            </div>
            <Progress
              value={
                progress.total ? (progress.done / progress.total) * 100 : 0
              }
            />
          </div>
        )}

        {phase === "recording" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-none bg-red-500" />
                Recording video
              </span>
              <span className="font-mono">{recordProgress}%</span>
            </div>
            <Progress value={recordProgress} />
          </div>
        )}

        {totalFrames > 0 && phase !== "recording" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={isPlaying ? pause : play}
                disabled={busy}
              >
                {isPlaying ? (
                  <>
                    <Pause className="h-4 w-4" /> Pause
                  </>
                ) : (
                    <>
                    <Play className="h-4 w-4" /> Play
                  </>
                )}
              </Button>
              <Button size="sm" variant="ghost" onClick={restart} disabled={busy}>
                <RotateCcw className="h-4 w-4" /> Restart
              </Button>
              <Badge variant="outline" className="ml-auto font-mono">
                {currentFrame + 1}/{totalFrames}
              </Badge>
            </div>
            <input
              type="range"
              min={0}
              max={totalFrames - 1}
              value={currentFrame}
              onChange={(e) => scrub(Number(e.target.value))}
              disabled={busy}
              className="w-full accent-black"
              aria-label="Scrub frames"
            />
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">
                {cols}×{gridRows} chars
              </Badge>
              <Badge variant="outline" className="font-mono">
                {fps} FPS
              </Badge>
              <Badge variant="outline" className="font-mono">
                {(totalFrames / fps).toFixed(2)}s
              </Badge>
            </div>
            <Separator />
            <Button
              className="w-full bg-foreground text-background hover:bg-secondary hover:text-black"
              onClick={exportVideo}
              disabled={busy}
            >
              {phase === "recording" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <VideoIcon className="h-4 w-4" />
              )}
              {hasOutput ? "Re-export video" : "Compile into a video"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Records the canvas in real time to a downloadable file.
            </p>
          </>
        )}

        {totalFrames === 0 && phase !== "processing" && (
          <Button
            className="w-full bg-foreground text-background hover:bg-secondary hover:text-black"
            onClick={convert}
            disabled={busy || !meta}
          >
            <Sparkles className="h-4 w-4" />
            Convert to text art
          </Button>
        )}

        {phase === "processing" && (
          <Button variant="destructive" className="w-full" onClick={cancelProcessing}>
            Cancel processing
          </Button>
        )}

        {hasOutput && (
          <>
            <Separator />
            <div className="border-2 border-[var(--brutal-border)] bg-black">
              <video src={outputUrl} controls autoPlay loop playsInline className="w-full" />
            </div>
            <Button asChild size="sm" className="w-full">
              <a href={outputUrl} download={`text-art.${outputExt}`}>
                <Download className="h-4 w-4" /> Download .{outputExt}
              </a>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
