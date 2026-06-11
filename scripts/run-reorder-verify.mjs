import { PrismaClient } from "@prisma/client";

const shopDomain = "outstock-test-lionlx2x.myshopify.com";
const productGid = "gid://shopify/Product/8946398134408";
const collectionGid = "gid://shopify/Collection/312002609288";

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

async function getProductIndex(admin) {
  const response = await admin.graphql(
    `#graphql
      query CollectionProducts($id: ID!) {
        collection(id: $id) {
          products(first: 250) {
            nodes { id title }
          }
        }
      }
    `,
    { variables: { id: collectionGid } },
  );
  const json = await response.json();
  const nodes = json.data?.collection?.products?.nodes ?? [];
  const index = nodes.findIndex((node) => node.id === productGid);
  return { index, total: nodes.length };
}

async function main() {
  process.env.DISABLE_JOB_WORKER = "true";
  const { reorderSoldOutProductInCollection, restoreProductPositionInCollection } =
    await import("../app/models/collection-reorder.server.ts");

  const admin = await getAdmin();

  const beforeSoldOut = await getProductIndex(admin);
  console.log(
    JSON.stringify({ step: "before_sold_out_reorder", ...beforeSoldOut }),
  );

  await reorderSoldOutProductInCollection(
    shopDomain,
    admin,
    collectionGid,
    productGid,
  );

  const afterSoldOut = await getProductIndex(admin);
  console.log(
    JSON.stringify({
      step: "after_sold_out_reorder",
      ...afterSoldOut,
      atBottom: afterSoldOut.index === afterSoldOut.total - 1,
    }),
  );

  await restoreProductPositionInCollection(
    shopDomain,
    admin,
    collectionGid,
    productGid,
    "ORIGINAL",
  );

  const afterRestore = await getProductIndex(admin);
  console.log(
    JSON.stringify({
      step: "after_restore",
      ...afterRestore,
      restoredToOriginal: afterRestore.index === 0,
    }),
  );

  await prisma.$disconnect();

  if (afterSoldOut.index !== afterSoldOut.total - 1) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
