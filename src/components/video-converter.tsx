"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  Film,
  Upload,
  Trash2,
  Settings2,
  Cpu,
  Server,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

import { CHAR_RAMPS, type ConvertSettings } from "@/lib/video-ascii";
import { ClientOutput } from "@/components/ascii-client-output";
import { ServerOutput } from "@/components/ascii-server-output";

type Mode = "client" | "server";

const COL_OPTIONS = [40, 60, 80, 100, 120, 160, 200, 240, 300];
const FPS_OPTIONS = [8, 12, 15, 24, 30, 60];

const BG_PRESETS = [
  { id: "black", name: "Black", value: "#000000" },
  { id: "ink", name: "Ink", value: "#0a0a0b" },
  { id: "slate", name: "Slate", value: "#0f172a" },
  { id: "terminal", name: "Terminal", value: "#0c0c0c" },
  { id: "deepblue", name: "Deep Blue", value: "#0a0e27" },
  { id: "white", name: "White", value: "#ffffff" },
  { id: "cream", name: "Cream", value: "#fff8e7" },
];

const MONO_PRESETS = [
  { id: "green", name: "Terminal", value: "#22c55e" },
  { id: "amber", name: "Amber", value: "#f59e0b" },
  { id: "cyan", name: "Cyan", value: "#22d3ee" },
  { id: "white", name: "White", value: "#e4e4e7" },
  { id: "pink", name: "Pink", value: "#f472b6" },
  { id: "red", name: "Red", value: "#ef4444" },
  { id: "purple", name: "Purple", value: "#a855f7" },
  { id: "lime", name: "Lime", value: "#84cc16" },
];

export function VideoConverter() {
  const [mode, setMode] = useState<Mode>("client");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>("");

  const [cols, setCols] = useState(160);
  const [fps, setFps] = useState(30);
  const [rampId, setRampId] = useState("standard");
  const [invert, setInvert] = useState(false);
  const [colored, setColored] = useState(true);
  const [fontSize, setFontSize] = useState(14);
  const [bgColor, setBgColor] = useState("#000000");
  const [monoColor, setMonoColor] = useState("#22c55e");
  const [withSound, setWithSound] = useState(false);
  const [customRamp, setCustomRamp] = useState("");
  const [watermarkText, setWatermarkText] = useState("ASCII Motion");
  const [watermarkOn, setWatermarkOn] = useState(true);

  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoUrlRef = useRef<string>("");

  useEffect(() => {
    return () => {
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    };
  }, []);

  const settings: ConvertSettings = {
    cols,
    fps,
    rampId,
    invert,
    colored,
    monoColor,
    bgColor,
    fontSize,
    withSound,
    watermark: watermarkOn && watermarkText.trim() ? watermarkText.trim() : undefined,
  };

  const handleFile = useCallback((f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error("Please choose a video file.");
      return;
    }
    setFile(f);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      const next = URL.createObjectURL(f);
      videoUrlRef.current = next;
      return next;
    });
  }, []);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0]);
    e.target.value = "";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const removeVideo = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrlRef.current = "";
    setVideoUrl("");
    setFile(null);
  };

  const ramp = customRamp.trim().length >= 2
    ? { id: "custom", name: "Custom", chars: customRamp.trim() }
    : CHAR_RAMPS.find((r) => r.id === rampId) ?? CHAR_RAMPS[0];
  const fileKey = file
    ? `${file.name}:${file.size}:${file.lastModified}`
    : "";
  // Client mode: remount when the file or STRUCTURAL settings change
  // (cols/fps/ramp/invert affect frame data). Render-time settings
  // (color/font/background) live-update without remounting.
  const clientKey = `client:${fileKey}:${cols}:${fps}:${rampId}:${customRamp}:${invert}`;
  // Server mode: remount on any settings change so a stale result clears.
  const serverKey = `server:${fileKey}:${cols}:${fps}:${rampId}:${customRamp}:${invert}:${colored}:${monoColor}:${bgColor}:${fontSize}:${withSound}`;

  return (
    <div className="space-y-6">
      {/* Mode switch — neo-brutalist segmented control */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex w-full max-w-md border-2 border-[var(--brutal-border)] bg-card shadow-[4px_4px_0_0_var(--brutal-shadow)]">
          <button
            onClick={() => !busy && setMode("client")}
            disabled={busy}
            className={`flex flex-1 items-center justify-center gap-2 border-r-2 border-[var(--brutal-border)] px-4 py-3 text-sm font-extrabold uppercase tracking-tight transition disabled:opacity-50 ${
              mode === "client"
                ? "bg-secondary text-black"
                : "bg-card text-foreground hover:bg-muted"
            }`}
          >
            <Cpu className="h-4 w-4" /> On your device
          </button>
          <button
            onClick={() => !busy && setMode("server")}
            disabled={busy}
            className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-extrabold uppercase tracking-tight transition disabled:opacity-50 ${
              mode === "server"
                ? "bg-accent text-black"
                : "bg-card text-foreground hover:bg-muted"
            }`}
          >
            <Server className="h-4 w-4" /> On the server
          </button>
        </div>
        <p className="text-center font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {mode === "client"
            ? "Runs on your CPU · nothing uploaded"
            : "Uploaded & processed on the server"}
        </p>
      </div>

      {!file ? (
        <div className="border-2 border-dashed border-[var(--brutal-border)] bg-card shadow-[4px_4px_0_0_var(--brutal-shadow)]">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex min-h-[300px] cursor-pointer flex-col items-center justify-center gap-4 p-10 text-center transition-colors ${
              dragOver ? "bg-secondary/50" : "hover:bg-muted"
            }`}
          >
            <div className="flex h-16 w-16 items-center justify-center border-2 border-[var(--brutal-border)] bg-secondary text-black shadow-[3px_3px_0_0_var(--brutal-shadow)]">
              <Upload className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-extrabold uppercase tracking-tight">
                Drop a video here
              </p>
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                or click to browse · MP4, WebM, MOV
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={onInputChange}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* LEFT: source + settings */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-extrabold uppercase tracking-tight">
                  <span className="flex h-6 w-6 items-center justify-center border-2 border-[var(--brutal-border)] bg-secondary text-black">
                    <Film className="h-3.5 w-3.5" />
                  </span>
                  Source video
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={removeVideo}
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="border-2 border-[var(--brutal-border)] bg-black">
                  <video
                    src={videoUrl}
                    controls
                    muted
                    playsInline
                    className="aspect-video w-full object-contain"
                  />
                </div>
                <Badge variant="outline" className="font-mono">
                  {file.name.length > 32
                    ? file.name.slice(0, 29) + "..."
                    : file.name}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-extrabold uppercase tracking-tight">
                  <span className="flex h-6 w-6 items-center justify-center border-2 border-[var(--brutal-border)] bg-accent text-black">
                    <Settings2 className="h-3.5 w-3.5" />
                  </span>
                  Text-art settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      Columns
                    </Label>
                    <Select
                      value={String(cols)}
                      onValueChange={(v) => setCols(Number(v))}
                      disabled={busy}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COL_OPTIONS.map((c) => (
                          <SelectItem key={c} value={String(c)}>
                            {c} chars
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      Frame rate
                    </Label>
                    <Select
                      value={String(fps)}
                      onValueChange={(v) => setFps(Number(v))}
                      disabled={busy}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FPS_OPTIONS.map((c) => (
                          <SelectItem key={c} value={String(c)}>
                            {c} FPS
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Character set
                  </Label>
                  <Select
                    value={rampId}
                    onValueChange={setRampId}
                    disabled={busy}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHAR_RAMPS.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="truncate border-2 border-[var(--brutal-border)] bg-muted px-2 py-1 font-mono text-[11px]">
                    {ramp.chars}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Custom characters (optional)
                  </Label>
                  <input
                    type="text"
                    value={customRamp}
                    onChange={(e) => setCustomRamp(e.target.value)}
                    disabled={busy}
                    placeholder="Type your own characters (dark → light)"
                    className="w-full border-2 border-[var(--brutal-border)] bg-card px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-secondary"
                  />
                  {customRamp.trim().length >= 2 && (
                    <p className="font-mono text-[10px] uppercase tracking-wider text-secondary">
                      ✓ Using custom ramp ({customRamp.trim().length} chars)
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      Font size ·{" "}
                      <span className="font-bold text-foreground">
                        {fontSize}px
                      </span>
                    </Label>
                  </div>
                  <Slider
                    value={[fontSize]}
                    min={8}
                    max={22}
                    step={1}
                    onValueChange={(v) => setFontSize(v[0])}
                    disabled={busy}
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <Label htmlFor="colored" className="text-sm font-bold uppercase tracking-wide">
                    Keep colors
                  </Label>
                  <Switch
                    id="colored"
                    checked={colored}
                    onCheckedChange={setColored}
                    disabled={busy}
                  />
                </div>

                {!colored && (
                  <div className="space-y-2">
                    <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      Text color
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {MONO_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setMonoColor(p.value)}
                          disabled={busy}
                          className={`h-8 w-8 border-2 border-[var(--brutal-border)] transition ${
                            monoColor === p.value
                              ? "shadow-[2px_2px_0_0_var(--brutal-shadow)]"
                              : "shadow-none"
                          }`}
                          style={{ backgroundColor: p.value }}
                          aria-label={p.name}
                          title={p.name}
                        />
                      ))}
                      <input
                        type="color"
                        value={monoColor}
                        onChange={(e) => setMonoColor(e.target.value)}
                        disabled={busy}
                        className="h-8 w-8 cursor-pointer border-2 border-[var(--brutal-border)] bg-transparent p-0"
                        aria-label="Custom text color"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <Label htmlFor="invert" className="text-sm font-bold uppercase tracking-wide">
                    Invert brightness
                  </Label>
                  <Switch
                    id="invert"
                    checked={invert}
                    onCheckedChange={setInvert}
                    disabled={busy}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="sound" className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide">
                    {withSound ? (
                      <Volume2 className="h-4 w-4" />
                    ) : (
                      <VolumeX className="h-4 w-4" />
                    )}
                    With sound
                  </Label>
                  <Switch
                    id="sound"
                    checked={withSound}
                    onCheckedChange={setWithSound}
                    disabled={busy}
                  />
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="watermark" className="text-sm font-bold uppercase tracking-wide">
                      Watermark
                    </Label>
                    <Switch
                      id="watermark"
                      checked={watermarkOn}
                      onCheckedChange={setWatermarkOn}
                      disabled={busy}
                    />
                  </div>
                  {watermarkOn && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={watermarkText}
                        onChange={(e) => setWatermarkText(e.target.value)}
                        disabled={busy}
                        placeholder="Your watermark text"
                        className="w-full border-2 border-[var(--brutal-border)] bg-card px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-secondary"
                      />
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Shown at bottom-right of every frame
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Background
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {BG_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setBgColor(p.value)}
                        disabled={busy}
                        className={`flex h-8 items-center gap-1.5 border-2 border-[var(--brutal-border)] px-3 text-[11px] font-bold uppercase tracking-wide transition ${
                          bgColor === p.value
                            ? "shadow-[2px_2px_0_0_var(--brutal-shadow)]"
                            : "shadow-none"
                        }`}
                        style={{ backgroundColor: p.value }}
                      >
                        <span
                          className={
                            p.value === "#ffffff" ? "text-black" : "text-white"
                          }
                        >
                          {p.name}
                        </span>
                      </button>
                    ))}
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      disabled={busy}
                      className="h-8 w-8 cursor-pointer border-2 border-[var(--brutal-border)] bg-transparent p-0"
                      aria-label="Custom background color"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT: mode-specific output */}
          {mode === "client" ? (
            <ClientOutput
              key={clientKey}
              file={file}
              videoUrl={videoUrl}
              settings={settings}
              onBusyChange={setBusy}
            />
          ) : (
            <ServerOutput
              key={serverKey}
              file={file}
              settings={settings}
              onBusyChange={setBusy}
            />
          )}
        </div>
      )}
    </div>
  );
}
