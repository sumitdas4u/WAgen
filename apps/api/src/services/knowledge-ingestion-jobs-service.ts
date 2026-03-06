import { pool } from "../db/pool.js";
import { ingestFileBuffer } from "./knowledge-ingestion-service.js";

type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface KnowledgeIngestJob {
  id: string;
  source_name: string | null;
  source_type: "file" | "pdf" | "website" | "manual";
  status: JobStatus;
  stage: string;
  progress: number;
  chunks_created: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface PendingFileJob {
  jobId: string;
  userId: string;
  fileName: string;
  mimeType?: string | null;
  buffer: Buffer;
}

const pendingJobs = new Map<string, PendingFileJob>();
const pendingQueue: string[] = [];
const runningJobs = new Set<string>();
let queueLoopRunning = false;

async function updateJobState(
  jobId: string,
  patch: Partial<{
    status: JobStatus;
    stage: string;
    progress: number;
    chunksCreated: number;
    errorMessage: string | null;
    completed: boolean;
  }>
): Promise<void> {
  await pool.query(
    `UPDATE knowledge_ingest_jobs
     SET
       status = COALESCE($2, status),
       stage = COALESCE($3, stage),
       progress = COALESCE($4, progress),
       chunks_created = COALESCE($5, chunks_created),
       error_message = $6,
       completed_at = CASE WHEN $7 THEN NOW() ELSE completed_at END,
       updated_at = NOW()
     WHERE id = $1`,
    [
      jobId,
      patch.status ?? null,
      patch.stage ?? null,
      patch.progress ?? null,
      patch.chunksCreated ?? null,
      patch.errorMessage ?? null,
      Boolean(patch.completed)
    ]
  );
}

async function runFileJob(job: PendingFileJob): Promise<void> {
  runningJobs.add(job.jobId);
  try {
    await updateJobState(job.jobId, {
      status: "processing",
      stage: "Extracting text",
      progress: 10,
      errorMessage: null
    });

    const chunksCreated = await ingestFileBuffer(job.userId, job.fileName, job.buffer, {
      mimeType: job.mimeType,
      onProgress: ({ stage, progress }) => updateJobState(job.jobId, { status: "processing", stage, progress })
    });

    await updateJobState(job.jobId, {
      status: "completed",
      stage: "Completed",
      progress: 100,
      chunksCreated,
      errorMessage: null,
      completed: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "File ingestion failed";
    await updateJobState(job.jobId, {
      status: "failed",
      stage: "Failed",
      progress: 100,
      errorMessage: message,
      completed: true
    });
  } finally {
    pendingJobs.delete(job.jobId);
    runningJobs.delete(job.jobId);
  }
}

async function runQueueLoop(): Promise<void> {
  if (queueLoopRunning) {
    return;
  }

  queueLoopRunning = true;
  try {
    while (pendingQueue.length > 0) {
      const nextJobId = pendingQueue.shift();
      if (!nextJobId) {
        continue;
      }

      const next = pendingJobs.get(nextJobId);
      if (!next || runningJobs.has(nextJobId)) {
        continue;
      }

      await runFileJob(next);
    }
  } finally {
    queueLoopRunning = false;
    if (pendingQueue.length > 0) {
      void runQueueLoop();
    }
  }
}

function scheduleFileJob(job: PendingFileJob): void {
  if (runningJobs.has(job.jobId) || pendingJobs.has(job.jobId)) {
    return;
  }

  pendingJobs.set(job.jobId, job);
  pendingQueue.push(job.jobId);
  setImmediate(() => {
    if (queueLoopRunning) {
      return;
    }
    void runQueueLoop();
  });
}

export async function createFileIngestionJobs(
  userId: string,
  files: Array<{ filename: string; mimeType?: string | null; buffer: Buffer }>
): Promise<KnowledgeIngestJob[]> {
  const created: KnowledgeIngestJob[] = [];

  for (const file of files) {
    const result = await pool.query<KnowledgeIngestJob>(
      `INSERT INTO knowledge_ingest_jobs (user_id, source_type, source_name, status, stage, progress)
       VALUES ($1, 'file', $2, 'queued', 'Queued', 0)
       RETURNING
         id,
         source_name,
         source_type,
         status,
         stage,
         progress,
         chunks_created,
         error_message,
         created_at,
         updated_at,
         completed_at`,
      [userId, file.filename]
    );

    const job = result.rows[0];
    if (!job) {
      continue;
    }

    created.push(job);
    scheduleFileJob({
      jobId: job.id,
      userId,
      fileName: file.filename,
      mimeType: file.mimeType,
      buffer: file.buffer
    });
  }

  return created;
}

export async function listIngestionJobs(userId: string, ids?: string[]): Promise<KnowledgeIngestJob[]> {
  if (ids && ids.length > 0) {
    const result = await pool.query<KnowledgeIngestJob>(
      `SELECT
         id,
         source_name,
         source_type,
         status,
         stage,
         progress,
         chunks_created,
         error_message,
         created_at,
         updated_at,
         completed_at
       FROM knowledge_ingest_jobs
       WHERE user_id = $1
         AND id = ANY($2::uuid[])
       ORDER BY created_at DESC`,
      [userId, ids]
    );
    return result.rows;
  }

  const result = await pool.query<KnowledgeIngestJob>(
    `SELECT
       id,
       source_name,
       source_type,
       status,
       stage,
       progress,
       chunks_created,
       error_message,
       created_at,
       updated_at,
       completed_at
     FROM knowledge_ingest_jobs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 40`,
    [userId]
  );
  return result.rows;
}
