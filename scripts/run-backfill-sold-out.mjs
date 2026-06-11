import { PrismaClient } from "@prisma/client";

const shopDomain = "outstock-test-lionlx2x.myshopify.com";
const prisma = new PrismaClient();

async function getAdmin() {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
  });
  if (!session?.accessToken) {
    throw new Error("No offline session found");
  }

  return {
    graphql: async (query, options = {}) => {
      const response = await fetch(
        `https://${shopDomain}/admin/api/2026-04/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken,
          },
          body: JSON.stringify({
            query,
            variables: options.variables ?? {},
          }),
        },
      );
      return response;
    },
  };
}

async function main() {
  process.env.DISABLE_JOB_WORKER = "true";
  const { backfillSoldOutProductsForShop } = await import(
    "../app/models/collection-reorder.server.ts"
  );

  const admin = await getAdmin();
  const result = await backfillSoldOutProductsForShop(shopDomain, admin);

  console.log(JSON.stringify({ step: "backfill_complete", ...result }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
