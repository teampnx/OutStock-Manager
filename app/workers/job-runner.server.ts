import { claimNextJob, completeJob, failJob } from "../models/job.server";
import { processJob } from "./handlers/index.server";

const POLL_INTERVAL_MS = 2_000;
const MAX_JOBS_PER_TICK = 3;

let started = false;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) {
    return;
  }

  ticking = true;
  try {
    for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
      const job = await claimNextJob();
      if (!job) {
        break;
      }

      try {
        await processJob(job);
        await completeJob(job.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown job error";
        console.error(
          `[job-worker] Job ${job.id} failed (${job.type}):`,
          message,
        );
        await failJob(job.id, message);
      }
    }
  } finally {
    ticking = false;
  }
}

export function startJobRunner(): void {
  if (started || process.env.DISABLE_JOB_WORKER === "true") {
    return;
  }

  started = true;
  console.log("[job-worker] Started background job runner");

  void tick();
  setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
}
