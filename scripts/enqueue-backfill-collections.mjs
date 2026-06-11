import { PrismaClient } from "@prisma/client";

const shopDomain = "outstock-test-lionlx2x.myshopify.com";
const prisma = new PrismaClient();

const shop = await prisma.shop.findUnique({
  where: { shopDomain },
  select: { id: true },
});

if (!shop) {
  console.error(`Shop not found: ${shopDomain}`);
  process.exit(1);
}

const dedupeKey = `${shopDomain}:backfill-collections`;

const job = await prisma.job.upsert({
  where: { dedupeKey },
  create: {
    shopDomain,
    shopId: shop.id,
    type: "BACKFILL_COLLECTIONS",
    payload: { source: "one-time-backfill" },
    status: "PENDING",
    priority: 1,
    runAt: new Date(),
    dedupeKey,
  },
  update: {
    status: "PENDING",
    runAt: new Date(),
    attempts: 0,
    lastError: null,
    payload: { source: "one-time-backfill" },
  },
});

console.log(JSON.stringify({ jobId: job.id, status: job.status, type: job.type }));

await prisma.$disconnect();
