// Worker entry: spawned as `node ascii-worker.mjs <jobSpecPath>` by the
// Next API route. Reads a job spec JSON file, runs the engine, and prints
// newline-delimited JSON messages to stdout:
//   {"type":"progress","phase":"rendering","done":12,"total":90}
//   {"type":"done",...} | {"type":"error","error":"..."}
//
// Running outside Turbopack lets @napi-rs/canvas load cleanly.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { processVideo, CHAR_RAMPS } from "./ascii-engine.mjs";

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// Persist status to disk so the status endpoint can read it even if the
// parent process's in-memory job map is reset (e.g. dev HMR).
function writeStatus(workDir, obj) {
  if (!workDir) return;
  writeFile(join(workDir, "status.json"), JSON.stringify(obj)).catch(() => {});
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    send({ type: "error", error: "Missing job spec path argument." });
    process.exit(1);
  }

  let spec;
  try {
    spec = JSON.parse(await readFile(specPath, "utf8"));
  } catch (e) {
    send({ type: "error", error: `Bad job spec: ${e.message}` });
    process.exit(1);
  }

  // Resolve ramp chars from id if needed.
  let rampChars = spec.rampChars;
  if (!rampChars && spec.rampId) {
    const r = CHAR_RAMPS.find((x) => x.id === spec.rampId);
    rampChars = r ? r.chars : CHAR_RAMPS[0].chars;
  }
  if (!rampChars) rampChars = CHAR_RAMPS[0].chars;

  writeStatus(spec.workDir, { status: "queued", phase: "queued", done: 0, total: 0 });

  try {
    const result = await processVideo(
      {
        inputPath: spec.inputPath,
        workDir: spec.workDir,
        fps: spec.fps,
        cols: spec.cols,
        rampChars,
        invert: spec.invert,
        colored: spec.colored,
        monoColor: spec.monoColor,
        bgColor: spec.bgColor,
        fontSize: spec.fontSize,
        withSound: spec.withSound === true,
      },
      (phase, done, total) => {
        send({ type: "progress", phase, done, total });
        writeStatus(spec.workDir, { status: phase, phase, done, total });
      },
    );
    const doneMsg = { type: "done", ...result };
    send(doneMsg);
    writeStatus(spec.workDir, {
      status: "done",
      phase: "done",
      done: result.frameCount,
      total: result.frameCount,
      result: {
        frameCount: result.frameCount,
        width: result.width,
        height: result.height,
        duration: result.duration,
        cols: result.cols,
        rows: result.rows,
        outputPath: result.outputPath,
        previewPath: result.previewPath,
      },
    });
  } catch (e) {
    const errMsg = e.message || String(e);
    send({ type: "error", error: errMsg });
    writeStatus(spec.workDir, { status: "error", phase: "error", error: errMsg });
    process.exit(1);
  }
}

main();
