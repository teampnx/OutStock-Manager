import { PrismaClient } from "@prisma/client";

const shopDomain = "outstock-test-lionlx2x.myshopify.com";
const prisma = new PrismaClient();
const jobId = process.argv[2];

if (!jobId) {
  console.error("Usage: node scripts/run-backfill-collections.mjs <jobId>");
  process.exit(1);
}

const deadline = Date.now() + 120_000;

while (Date.now() < deadline) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    console.error("Job not found");
    process.exit(1);
  }

  if (job.status === "COMPLETED") {
    const collections = await prisma.collection.count({
      where: { shop: { shopDomain } },
    });
    const positions = await prisma.collectionProductPosition.count({
      where: { collection: { shop: { shopDomain } } },
    });
    console.log(
      JSON.stringify({
        jobStatus: job.status,
        collectionsInDb: collections,
        positionRows: positions,
      }),
    );
    await prisma.$disconnect();
    process.exit(0);
  }

  if (job.status === "FAILED" || job.status === "DEAD") {
    console.error(JSON.stringify({ jobStatus: job.status, lastError: job.lastError }));
    await prisma.$disconnect();
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));
}

console.error("Timed out waiting for job");
await prisma.$disconnect();
process.exit(1);
