import type { Job, JobStatus, JobType, Prisma } from "@prisma/client";
import prisma from "../db.server";

export type EnqueueJobInput = {
  shopDomain: string;
  shopId?: string | null;
  type: JobType;
  payload: Prisma.InputJsonValue;
  dedupeKey?: string | null;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
};

const DEFAULT_DEBOUNCE_MS = 3_000;

export async function resolveShopId(
  shopDomain: string,
): Promise<string | null> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  return shop?.id ?? null;
}

export async function enqueueJob(input: EnqueueJobInput): Promise<Job> {
  const shopId =
    input.shopId !== undefined ? input.shopId : await resolveShopId(input.shopDomain);

  const data = {
    shopDomain: input.shopDomain,
    shopId,
    type: input.type,
    payload: input.payload,
    priority: input.priority ?? 10,
    runAt: input.runAt ?? new Date(Date.now() + DEFAULT_DEBOUNCE_MS),
    maxAttempts: input.maxAttempts ?? 5,
    dedupeKey: input.dedupeKey ?? null,
  };

  if (data.dedupeKey) {
    return prisma.job.upsert({
      where: { dedupeKey: data.dedupeKey },
      create: { ...data, status: "PENDING" },
      update: {
        payload: data.payload,
        runAt: data.runAt,
        status: "PENDING",
        updatedAt: new Date(),
      },
    });
  }

  return prisma.job.create({
    data: { ...data, status: "PENDING" },
  });
}

export async function claimNextJob(): Promise<Job | null> {
  const now = new Date();

  const candidate = await prisma.job.findFirst({
    where: {
      status: "PENDING",
      runAt: { lte: now },
    },
    orderBy: [{ priority: "asc" }, { runAt: "asc" }, { createdAt: "asc" }],
  });

  if (!candidate) {
    return null;
  }

  const updated = await prisma.job.updateMany({
    where: {
      id: candidate.id,
      status: "PENDING",
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      updatedAt: now,
    },
  });

  if (updated.count === 0) {
    return null;
  }

  return prisma.job.findUnique({ where: { id: candidate.id } });
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      lastError: null,
      updatedAt: new Date(),
    },
  });
}

export async function failJob(jobId: string, error: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return;
  }

  const isDead = job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(60_000, 1_000 * 2 ** job.attempts);

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: isDead ? "DEAD" : "FAILED",
      lastError: error.slice(0, 2000),
      runAt: isDead ? job.runAt : new Date(Date.now() + backoffMs),
      updatedAt: new Date(),
    },
  });

  if (!isDead) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "PENDING" },
    });
  }
}

export async function countJobsByStatus(
  status: JobStatus,
): Promise<number> {
  return prisma.job.count({ where: { status } });
}
