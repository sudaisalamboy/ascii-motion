/**
 * Shared character ramps + client-side text-art rendering helpers.
 *
 * There are two processing modes (see the mode switch in the UI):
 *  - "On your device": uses the client-side helpers in this file (seeks the
 *    <video>, converts frames to ASCII, renders to a <canvas>, and records it
 *    with MediaRecorder). Runs entirely on the user's CPU.
 *  - "On the server": uploads the file; the server runs the ffmpeg +
 *    @napi-rs/canvas pipeline (see src/lib/ascii-engine.mjs).
 *
 * This module only holds the ramp presets (used by both modes' settings UI)
 * and the client-side conversion/rendering functions.
 */

export type CharRamp = {
  id: string;
  name: string;
  chars: string;
  /** Wide glyphs (emoji) — measured differently and rendered in their own colour. */
  wide?: boolean;
};

/** Brightness ramps ordered from dark -> light. */
export const CHAR_RAMPS: CharRamp[] = [
  {
    id: "standard",
    name: "Classic",
    chars: " .:-=+*#%@",
  },
  {
    id: "detailed",
    name: "Detailed",
    chars: " .'`^,:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  },
  { id: "blocks", name: "Blocks", chars: " \u00A0\u2591\u2592\u2593\u2588" },
  { id: "shade", name: "Shade", chars: " \u00B7\u2022\u25CF\u2588" },
  { id: "binary", name: "Binary", chars: " 01" },
  { id: "hex", name: "Hex", chars: " 0123456789ABCDEF" },
  {
    id: "matrix",
    name: "Matrix",
    chars: " \u30AB\u30AD\u30AF\u30B1\u30B3\u30B5\u30B7\u30B9\u30BB\u30BD",
  },
  {
    id: "braille",
    name: "Braille",
    chars: " \u2800\u2801\u2803\u2809\u2819\u2839\u283B\u283F\u28FF",
  },
  {
    id: "kaomoji",
    name: "Kaomoji",
    chars: " \u00B7\u2502\u2514\u251C\u2534\u2524\u253C\u2593\u2588",
  },
  {
    id: "shades",
    name: "Shades",
    chars: " \u2591\u2592\u2593\u2588\u2588\u2588",
  },
  {
    id: "hearts",
    name: "Hearts",
    chars: "\uD83D\uDDA4\uD83E\uDD0E\u2764\uFE0F\uD83E\uDDE1\uD83D\uDC9B\uD83D\uDC9A\uD83D\uDC99\uD83D\uDC9C\uD83E\uDD0D",
    wide: true,
  },
  {
    id: "circles",
    name: "Circles",
    chars: "\u26AB\uD83D\uDD34\uD83D\uDFE0\uD83D\uDFE1\uD83D\uDFE2\uD83D\uDFE3\u26AA",
    wide: true,
  },
];

/** First non-space char of a ramp — used as the measurement sample (emoji ramps need their own width). */
export function rampSampleChar(ramp: Pick<CharRamp, "chars">): string {
  return ramp.chars.replace(/\s/g, "")[0] || "M";
}

export type ConvertSettings = {
  cols: number;
  fps: number;
  rampId: string;
  invert: boolean;
  colored: boolean;
  monoColor: string;
  bgColor: string;
  fontSize: number;
  withSound: boolean;
};

// ---------------------------------------------------------------------------
// Client-side ("On your device") helpers
// ---------------------------------------------------------------------------

export type AsciiCell = {
  char: string;
  r: number;
  g: number;
  b: number;
};

export type AsciiFrame = {
  cols: number;
  rows: number;
  cells: AsciiCell[];
};

export type ConvertOptions = {
  rampChars: string;
  invert: boolean;
  colored: boolean;
};

export type RenderStyle = {
  fontSize: number;
  charW: number;
  charH: number;
  colored: boolean;
  monoColor: string;
  background: string;
  font: string;
};

/** Seek a video element to a timestamp and resolve once the frame is ready. */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const duration = video.duration || 0;
    const target = Math.max(0, Math.min(time, Math.max(0, duration - 0.001)));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish);
    if (Math.abs(video.currentTime - target) < 1e-4) {
      video.currentTime = target + 0.0011;
    } else {
      video.currentTime = target;
    }
    setTimeout(finish, 600);
  });
}

/**
 * Compute how many character rows fit a given number of columns while
 * preserving the source video's aspect ratio. `charAspect` is the
 * width/height ratio of a monospace glyph cell (~0.55).
 */
export function computeRows(
  cols: number,
  videoW: number,
  videoH: number,
  charAspect = 0.55,
): number {
  if (videoW <= 0 || videoH <= 0) return Math.max(8, Math.round(cols * 0.45));
  return Math.max(4, Math.round(cols * charAspect * (videoH / videoW)));
}

/**
 * Measure a monospace glyph cell for a given font string.
 * SSR-safe: returns an estimate when the DOM isn't available.
 */
export function measureGlyph(
  font: string,
  sampleChar = "M",
): { charW: number; charH: number } {
  const sizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
  const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 12;
  if (typeof document === "undefined") {
    // SSR estimate: ~0.6em for normal glyphs, ~1.0em for wide (emoji) ones.
    const wide = sampleChar.length > 1 || /\p{Extended_Pictographic}/u.test(sampleChar);
    return { charW: fontSize * (wide ? 1.0 : 0.6), charH: fontSize };
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { charW: fontSize * 0.6, charH: fontSize };
  ctx.font = font;
  const m = ctx.measureText(sampleChar);
  const charW = m.width > 0 ? m.width : fontSize * 0.6;
  return { charW, charH: fontSize };
}

/**
 * Extract frames at `fps` and convert each to an AsciiFrame in one pass.
 * `cols` x `rows` is the character grid (one pixel per character sampled).
 */
export async function extractAndConvert(
  video: HTMLVideoElement,
  fps: number,
  cols: number,
  rows: number,
  opts: ConvertOptions,
  onProgress?: (done: number, total: number) => void,
  shouldCancel?: () => boolean,
): Promise<AsciiFrame[]> {
  const duration = video.duration || 0;
  const total = Math.max(1, Math.floor(duration * fps));
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const ramp = opts.invert
    ? [...opts.rampChars].reverse().join("")
    : opts.rampChars;
  const lastIdx = ramp.length - 1;

  const frames: AsciiFrame[] = [];
  for (let i = 0; i < total; i++) {
    if (shouldCancel?.()) break;
    const t = i / fps;
    await seekTo(video, t);
    ctx.clearRect(0, 0, cols, rows);
    ctx.drawImage(video, 0, 0, cols, rows);
    const img = ctx.getImageData(0, 0, cols, rows);
    frames.push(imageDataToAscii(img, ramp, lastIdx));
    onProgress?.(i + 1, total);
    await new Promise((r) => setTimeout(r, 0));
  }
  return frames;
}

function imageDataToAscii(img: ImageData, ramp: string, lastIdx: number): AsciiFrame {
  const cols = img.width;
  const rows = img.height;
  const data = img.data;
  const cells: AsciiCell[] = new Array(cols * rows);
  const SAT = 1.45; // saturation boost so colours read clearly in text-art
  for (let i = 0; i < cols * rows; i++) {
    const idx = i * 4;
    let r = data[idx];
    let g = data[idx + 1];
    let b = data[idx + 2];
    const a = data[idx + 3];
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) * (a / 255);
    // Boost saturation: scale the colour's distance from its luma.
    r = lum + (r - lum) * SAT;
    g = lum + (g - lum) * SAT;
    b = lum + (b - lum) * SAT;
    if (r < 0) r = 0; else if (r > 255) r = 255;
    if (g < 0) g = 0; else if (g > 255) g = 255;
    if (b < 0) b = 0; else if (b > 255) b = 255;
    let ci = Math.floor((lum / 255) * (lastIdx + 1));
    if (ci < 0) ci = 0;
    if (ci > lastIdx) ci = lastIdx;
    cells[i] = { char: ramp[ci], r: r | 0, g: g | 0, b: b | 0 };
  }
  return { cols, rows, cells };
}

/** Render a single AsciiFrame onto a 2D context using the given style. */
export function renderAsciiFrame(
  ctx: CanvasRenderingContext2D,
  frame: AsciiFrame,
  style: RenderStyle,
): void {
  const { cols, rows, cells } = frame;
  const { charW, charH, colored, monoColor, background, font } = style;
  const w = cols * charW;
  const h = rows * charH;

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  if (!colored) {
    ctx.fillStyle = monoColor;
    for (let row = 0; row < rows; row++) {
      let s = "";
      const base = row * cols;
      for (let col = 0; col < cols; col++) s += cells[base + col].char;
      ctx.fillText(s, 0, row * charH);
    }
    return;
  }

  let prevColor = "";
  let buf = "";
  let bufStartCol = 0;
  const flush = (row: number) => {
    if (buf.length === 0) return;
    ctx.fillText(buf, bufStartCol * charW, row * charH);
    buf = "";
  };
  for (let row = 0; row < rows; row++) {
    const base = row * cols;
    for (let col = 0; col < cols; col++) {
      const cell = cells[base + col];
      const color = `rgb(${cell.r},${cell.g},${cell.b})`;
      if (color !== prevColor) {
        flush(row);
        ctx.fillStyle = color;
        prevColor = color;
        bufStartCol = col;
      }
      buf += cell.char;
    }
    flush(row);
    prevColor = "";
  }
}

/** Pick the best supported recording mime type. */
export function pickRecordingMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}
