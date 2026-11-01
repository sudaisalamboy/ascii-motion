// Server-side ASCII video engine. Runs in a plain Node worker process
// (spawned from the Next API route) so it can load @napi-rs/canvas without
// Turbopack/bundler issues.
//
// Fast pipeline:
//   1. ffprobe the input for width / height / duration
//   2. Pre-render a glyph atlas once (each ramp char -> RGBA pixels)
//   3. ffmpeg #1 streams rawvideo RGBA frames (scaled to cols x rows) to stdout
//   4. For each frame: build a {char,color} grid, then COMPOSITE the glyphs
//      directly into a raw RGBA output buffer (no per-frame fillText/canvas),
//      and stream that buffer into ffmpeg #2's stdin.
//   5. ffmpeg #2 encodes the raw RGBA -> mp4 (libx264), optionally muxing the
//      original audio (-c:a aac -shortest) when "With sound" is on.
//
// Progress is reported via an onProgress(phase, done, total) callback.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Belt-and-suspenders: point the @napi-rs loader at the prebuilt binding.
if (!process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
  try {
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = require.resolve(
      "@napi-rs/canvas-linux-x64-gnu",
    );
  } catch {
    // fall through; resolution from node_modules usually works anyway
  }
}

const { createCanvas } = await import("@napi-rs/canvas");
const sharp = (await import("sharp")).default;

export const CHAR_RAMPS = [
  { id: "standard", name: "Classic", chars: " .:-=+*#%@" },
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

const FONT_FAMILY =
  'DejaVu Sans Mono, Liberation Mono, Consolas, Menlo, "Noto Color Emoji", monospace';

const MAX_FRAMES = 1800; // 60s @ 30fps
const MAX_DURATION = 60;

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : "";
    throw new Error(
      `${cmd} failed (exit ${err.status ?? "?"}): ${stderr.slice(0, 500)}`,
    );
  }
}

function probe(inputPath) {
  const out = run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,duration",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    inputPath,
  ]);
  const j = JSON.parse(out || "{}");
  const s = (j.streams && j.streams[0]) || {};
  const width = Number(s.width) || 0;
  const height = Number(s.height) || 0;
  let duration = Number(s.duration) || Number(j.format?.duration) || 0;
  if (!duration) duration = 0;
  return { width, height, duration };
}

function measureGlyph(fontSize, sampleChar = "M") {
  const font = `${fontSize}px ${FONT_FAMILY}`;
  const c = createCanvas(10, 10);
  const ctx = c.getContext("2d");
  ctx.font = font;
  const w = ctx.measureText(sampleChar).width;
  const charW = w > 0 ? w : fontSize * 0.6;
  return { charW, charH: fontSize, font };
}

function parseHex(hex) {
  let h = String(hex || "#000000").replace("#", "").trim();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h || "000000", 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Pre-render every character in the ramp to a small RGBA tile.
 * For normal ramps the tile is a white shape (used as an alpha mask, tinted
 * per cell). For emoji ramps the tile carries the emoji's own colours.
 */
function buildGlyphAtlas(rampChars, font, charW, charH) {
  const gw = Math.max(1, Math.ceil(charW));
  const gh = Math.max(1, Math.ceil(charH));
  const canvas = createCanvas(gw, gh);
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";

  const seen = new Set();
  const tiles = {};
  for (const ch of rampChars) {
    if (ch === " " || ch === "\u00A0" || seen.has(ch)) continue;
    seen.add(ch);
    ctx.clearRect(0, 0, gw, gh);
    ctx.fillText(ch, 0, 0);
    const img = ctx.getImageData(0, 0, gw, gh);
    // Copy RGBA bytes into a plain buffer we own.
    const rgba = Buffer.alloc(gw * gh * 4);
    img.data.forEach((v, i) => (rgba[i] = v));
    tiles[ch] = rgba;
  }
  return { tiles, gw, gh };
}

/**
 * Composite glyphs into a raw RGBA output buffer that is ALREADY filled with
 * the background colour (see makeBgBuf). Only glyph pixels are written.
 * Pixel-level blitting — no fillText / no canvas in the hot loop.
 */
function compositeFrame(grid, style, atlas, charW, charH, W, H, wide, outBuf) {
  const bg = parseHex(style.background);
  const mono = parseHex(style.monoColor);
  const colored = style.colored;
  const { tiles, gw, gh } = atlas;

  for (let row = 0; row < grid.rows; row++) {
    const baseY = Math.round(row * charH);
    if (baseY >= H) break;
    const rowBase = row * grid.cols;
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.cells[rowBase + col];
      const tile = tiles[cell.char];
      if (!tile) continue;
      const baseX = Math.round(col * charW);
      if (baseX >= W) continue;

      let cr, cg, cb;
      if (wide) {
        cr = cg = cb = 0;
      } else if (colored) {
        cr = cell.r;
        cg = cell.g;
        cb = cell.b;
      } else {
        cr = mono.r;
        cg = mono.g;
        cb = mono.b;
      }

      for (let y = 0; y < gh; y++) {
        const oy = baseY + y;
        if (oy >= H) break;
        let oi = (oy * W + baseX) * 4;
        let mi = (y * gw) * 4;
        const xMax = Math.min(gw, W - baseX);
        for (let x = 0; x < xMax; x++) {
          const ma = tile[mi + 3];
          if (ma !== 0) {
            if (wide) {
              const mr = tile[mi],
                mg = tile[mi + 1],
                mb = tile[mi + 2];
              if (ma >= 255) {
                outBuf[oi] = mr;
                outBuf[oi + 1] = mg;
                outBuf[oi + 2] = mb;
              } else {
                const af = ma / 255;
                const ia = 1 - af;
                outBuf[oi] = (mr * af + bg.r * ia) | 0;
                outBuf[oi + 1] = (mg * af + bg.g * ia) | 0;
                outBuf[oi + 2] = (mb * af + bg.b * ia) | 0;
              }
            } else if (ma >= 255) {
              outBuf[oi] = cr;
              outBuf[oi + 1] = cg;
              outBuf[oi + 2] = cb;
            } else {
              const af = ma / 255;
              const ia = 1 - af;
              outBuf[oi] = (cr * af + bg.r * ia) | 0;
              outBuf[oi + 1] = (cg * af + bg.g * ia) | 0;
              outBuf[oi + 2] = (cb * af + bg.b * ia) | 0;
            }
          }
          oi += 4;
          mi += 4;
        }
      }
    }
  }
}

/** Build a buffer pre-filled with the background colour (+ alpha 255). */
function makeBgBuf(W, H, bg) {
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    buf[p] = bg.r;
    buf[p + 1] = bg.g;
    buf[p + 2] = bg.b;
    buf[p + 3] = 255;
  }
  return buf;
}

function buildGrid(data, width, height, ramp, invert) {
  const rampChars = invert ? [...ramp].reverse().join("") : ramp;
  const last = rampChars.length - 1;
  const SAT = 1.45; // saturation boost so colours read clearly in text-art
  const cells = new Array(width * height);
  for (let i = 0; i < width * height; i++) {
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
    let ci = Math.floor((lum / 255) * (last + 1));
    if (ci < 0) ci = 0;
    if (ci > last) ci = last;
    cells[i] = { char: rampChars[ci], r: r | 0, g: g | 0, b: b | 0 };
  }
  return { cols: width, rows: height, cells };
}

/** Async generator that splits a readable stream into fixed-size frame buffers. */
async function* frameIterator(stream, frameSize) {
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= frameSize) {
      yield buf.subarray(0, frameSize);
      buf = buf.subarray(frameSize);
    }
  }
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    if (stream.destroyed || stream.writableEnded) {
      resolve();
      return;
    }
    const ok = stream.write(chunk);
    if (ok) resolve();
    else stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

/**
 * Spawn ffmpeg reading rawvideo RGBA from stdin and encoding an mp4.
 * If `audioInput` is given, the original audio is muxed in (-c:a aac -shortest).
 */
function startEncoder(W, H, fps, outputPath, audioInput) {
  const args = [
    "-y",
    "-f",
    "rawvideo",
    "-pixel_format",
    "rgba",
    "-video_size",
    `${W}x${H}`,
    "-framerate",
    String(fps),
    "-i",
    "pipe:0",
  ];
  if (audioInput) args.push("-i", audioInput);
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
  if (audioInput)
    args.push("-map", "0:v:0", "-map", "1:a:0?", "-c:a", "aac", "-b:a", "128k", "-shortest");
  args.push("-movflags", "+faststart", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black", outputPath);

  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderrBuf = "";
  ff.stderr.on("data", (d) => (stderrBuf += d.toString("utf8")));
  const done = new Promise((resolve, reject) => {
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`encoder exited ${code}: ${stderrBuf.slice(-400)}`)),
    );
    ff.on("error", reject);
  });
  return { stdin: ff.stdin, done };
}

/** Spawn ffmpeg that extracts frames as rawvideo RGBA to stdout. */
function startExtractor(inputPath, fps, cols, rows) {
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `fps=${fps},scale=${cols}:${rows}:flags=lanczos`,
      "-an",
      "-vsync",
      "0",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderrBuf = "";
  ff.stderr.on("data", (d) => (stderrBuf += d.toString("utf8")));
  ff.on("close", (code) => {
    if (code !== 0 && code !== null) {
      // Surface extraction errors via stderr capture; the consumer will see
      // an empty stream and the encoder will still finalise.
      console.error(`extractor exited ${code}: ${stderrBuf.slice(-300)}`);
    }
  });
  return ff;
}

/**
 * Process a video into a text-art video.
 */
export async function processVideo(opts, onProgress) {
  const {
    inputPath,
    workDir,
    fps = 30,
    cols = 160,
    rampChars,
    invert = false,
    colored = true,
    monoColor = "#22c55e",
    bgColor = "#000000",
    fontSize = 14,
    withSound = false,
  } = opts;

  const report = (phase, done, total) => {
    try {
      onProgress?.(phase, done, total);
    } catch {
      /* ignore */
    }
  };

  const info = probe(inputPath);
  if (!info.width || !info.height) {
    throw new Error("Could not read video dimensions.");
  }
  if (info.duration > MAX_DURATION) {
    throw new Error(
      `Video is ${info.duration.toFixed(1)}s — please use a clip under ${MAX_DURATION}s.`,
    );
  }
  const frameCount = Math.max(1, Math.floor(info.duration * fps));
  if (frameCount > MAX_FRAMES) {
    throw new Error(
      `That would be ${frameCount} frames (max ${MAX_FRAMES}). Lower the FPS or use a shorter clip.`,
    );
  }

  const rampObj = CHAR_RAMPS.find((r) => r.chars === rampChars) || { wide: false };
  const wide = !!rampObj.wide;
  const sampleChar = (rampChars || "M").replace(/\s/g, "")[0] || "M";
  const { charW, charH, font } = measureGlyph(fontSize, sampleChar);
  const charAspect = charW / charH;
  const rows = Math.max(4, Math.round(cols * charAspect * (info.height / info.width)));
  const W = Math.round(cols * charW);
  const H = Math.round(rows * charH);

  mkdirSync(workDir, { recursive: true });

  report("extracting", 0, frameCount);
  // Pre-render the glyph atlas once + a background buffer (reused as a copy source).
  const atlas = buildGlyphAtlas(rampChars, font, charW, charH);
  const style = { colored, monoColor, background: bgColor };
  const bgBuf = makeBgBuf(W, H, parseHex(bgColor));

  const outputPath = join(workDir, "output.mp4");
  const previewPath = join(workDir, "preview.png");
  const audioInput = withSound ? inputPath : undefined;
  const { stdin, done } = startEncoder(W, H, fps, outputPath, audioInput);

  // Start the extractor (raw RGBA frames to stdout).
  const extractor = startExtractor(inputPath, fps, cols, rows);
  const frameSize = cols * rows * 4;

  report("rendering", 0, frameCount);
  let rendered = 0;
  let firstFrame = null;
  try {
    for await (const rawFrame of frameIterator(extractor.stdout, frameSize)) {
      const grid = buildGrid(rawFrame, cols, rows, rampChars, invert);
      // Fresh buffer = copy of background; composite glyphs on top; pipe directly.
      const outBuf = Buffer.from(bgBuf);
      compositeFrame(grid, style, atlas, charW, charH, W, H, wide, outBuf);
      if (!firstFrame) firstFrame = Buffer.from(outBuf);
      await writeChunk(stdin, outBuf);
      rendered++;
      report("rendering", rendered, frameCount);
    }
  } finally {
    try {
      stdin.end();
    } catch {
      /* ignore */
    }
    try {
      extractor.stdin?.end();
    } catch {
      /* ignore */
    }
  }

  if (rendered === 0) {
    throw new Error("No frames were extracted from the video.");
  }

  // Save a preview (first composited frame) as PNG via sharp.
  if (firstFrame) {
    try {
      await sharp(firstFrame, { raw: { width: W, height: H, channels: 4 } })
        .png()
        .toFile(previewPath);
    } catch {
      /* preview is non-critical */
    }
  }

  report("compiling", rendered, frameCount);
  await done;

  return {
    outputPath,
    previewPath,
    frameCount: rendered,
    width: W,
    height: H,
    duration: rendered / fps,
    cols,
    rows,
  };
}
