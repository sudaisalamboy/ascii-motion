import { spawn } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type JobPhase =
  | "queued"
  | "extracting"
  | "rendering"
  | "compiling"
  | "done"
  | "error";

export type JobResult = {
  outputPath: string;
  previewPath: string;
  frameCount: number;
  width: number;
  height: number;
  duration: number;
  cols: number;
  rows: number;
};

export type JobParams = {
  fps: number;
  cols: number;
  rampId: string;
  invert: boolean;
  colored: boolean;
  monoColor: string;
  bgColor: string;
  fontSize: number;
  withSound: boolean;
  fileName: string;
};

export type Job = {
  id: string;
  status: JobPhase;
  phase: JobPhase;
  done: number;
  total: number;
  result?: JobResult;
  error?: string;
  createdAt: number;
  finishedAt?: number;
  params: JobParams;
  workDir: string;
  inputPath: string;
};

const ROOT = process.cwd();
const WORKER_PATH = join(ROOT, "src", "lib", "ascii-worker.mjs");
export const TMP_ROOT = join(tmpdir(), "ascii-motion");
const TTL_MS = 30 * 60 * 1000; // 30 minutes

const jobs = new Map<string, Job>();

/** Read a job's status from disk (written by the worker). Survives HMR. */
export async function readJobStatus(
  id: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(TMP_ROOT, id, "status.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Path helpers for the result/preview routes (disk-based, HMR-safe). */
export function jobOutputPath(id: string): string {
  return join(TMP_ROOT, id, "output.mp4");
}
export function jobPreviewPath(id: string): string {
  return join(TMP_ROOT, id, "preview.png");
}

function sweepOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > TTL_MS) {
      try {
        rmSync(job.workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      jobs.delete(id);
    }
  }
}

export function createJob(params: JobParams): Job {
  sweepOldJobs();
  const id =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const workDir = join(TMP_ROOT, id);
  mkdirSync(workDir, { recursive: true });
  const ext = params.fileName.match(/\.[a-z0-9]+$/i)?.[0] || ".mp4";
  const inputPath = join(workDir, `input${ext}`);
  const job: Job = {
    id,
    status: "queued",
    phase: "queued",
    done: 0,
    total: 0,
    createdAt: Date.now(),
    params,
    workDir,
    inputPath,
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function saveUpload(id: string, buffer: Buffer) {
  const job = jobs.get(id);
  if (!job) throw new Error("Job not found");
  writeFileSync(job.inputPath, buffer);
}

export function startWorker(id: string) {
  const job = jobs.get(id);
  if (!job) throw new Error("Job not found");

  const specPath = join(job.workDir, "spec.json");
  writeFileSync(
    specPath,
    JSON.stringify({
      inputPath: job.inputPath,
      workDir: job.workDir,
      fps: job.params.fps,
      cols: job.params.cols,
      rampId: job.params.rampId,
      invert: job.params.invert,
      colored: job.params.colored,
      monoColor: job.params.monoColor,
      bgColor: job.params.bgColor,
      fontSize: job.params.fontSize,
      withSound: job.params.withSound,
    }),
  );

  const child = spawn("node", [WORKER_PATH, specPath], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT,
    env: { ...process.env },
  });

  let stdoutBuf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      handleWorkerMessage(id, line);
    }
  });

  const stderrChunks: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString("utf8"));
  });

  child.on("error", (err) => {
    const j = jobs.get(id);
    if (j && j.status !== "done" && j.status !== "error") {
      j.status = "error";
      j.phase = "error";
      j.error = `Worker failed to start: ${err.message}`;
      j.finishedAt = Date.now();
    }
  });

  child.on("close", (code) => {
    const j = jobs.get(id);
    if (!j) return;
    if (j.status !== "done" && j.status !== "error") {
      j.status = "error";
      j.phase = "error";
      j.error =
        stderrChunks.join("").slice(0, 500) ||
        `Worker exited with code ${code} before finishing.`;
      j.finishedAt = Date.now();
    }
  });
}

function handleWorkerMessage(id: string, line: string) {
  const job = jobs.get(id);
  if (!job) return;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type === "progress") {
    job.status = (msg.phase as JobPhase) || job.status;
    job.phase = (msg.phase as JobPhase) || job.phase;
    job.done = Number(msg.done) || 0;
    job.total = Number(msg.total) || 0;
  } else if (msg.type === "done") {
    job.status = "done";
    job.phase = "done";
    job.done = job.total || Number(msg.frameCount) || 0;
    job.result = {
      outputPath: String(msg.outputPath),
      previewPath: String(msg.previewPath),
      frameCount: Number(msg.frameCount) || 0,
      width: Number(msg.width) || 0,
      height: Number(msg.height) || 0,
      duration: Number(msg.duration) || 0,
      cols: Number(msg.cols) || 0,
      rows: Number(msg.rows) || 0,
    };
    job.finishedAt = Date.now();
  } else if (msg.type === "error") {
    job.status = "error";
    job.phase = "error";
    job.error = String(msg.error || "Unknown error");
    job.finishedAt = Date.now();
  }
}

export function cleanupJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  try {
    rmSync(job.workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  jobs.delete(id);
}

export function jobExists(id: string): boolean {
  return existsSync(join(TMP_ROOT, id));
}
