import { PrismaClient } from "@prisma/client";

const shopDomain = "outstock-test-lionlx2x.myshopify.com";
const prisma = new PrismaClient();

async function shopifyGraphql(query, variables = {}) {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
  });
  if (!session?.accessToken) throw new Error("No session");

  const response = await fetch(
    `https://${shopDomain}/admin/api/2026-04/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  return response.json();
}

async function liveIndex(collectionGid, productGid) {
  const json = await shopifyGraphql(
    `query($id:ID!){collection(id:$id){products(first:250){nodes{id}}}}`,
    { id: collectionGid },
  );
  const nodes = json.data?.collection?.products?.nodes ?? [];
  return nodes.findIndex((n) => n.id === productGid);
}

async function main() {
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  const soldOut = await prisma.trackedProduct.findMany({
    where: { shopId: shop.id, isSoldOut: true },
    select: { id: true, title: true, shopifyProductId: true },
    orderBy: { title: "asc" },
  });

  const rows = [];
  for (const product of soldOut) {
    const memberships = await prisma.collectionProductPosition.findMany({
      where: {
        trackedProductId: product.id,
        collection: { shopId: shop.id, sortOrder: "MANUAL" },
      },
      include: { collection: true },
    });

    for (const m of memberships) {
      const index = await liveIndex(
        m.collection.shopifyCollectionId,
        product.shopifyProductId,
      );
      const total = (
        await shopifyGraphql(
          `query($id:ID!){collection(id:$id){products(first:250){nodes{id}}}}`,
          { id: m.collection.shopifyCollectionId },
        )
      ).data?.collection?.products?.nodes?.length ?? 0;

      rows.push({
        product: product.title,
        collection: m.collection.title,
        liveIndex: index,
        total,
        atBottom: index === total - 1,
        dbCurrent: m.currentPosition,
        dbOriginal: m.originalPosition,
      });
    }
  }

  console.log(JSON.stringify({ soldOutCount: soldOut.length, rows }, null, 2));
  await prisma.$disconnect();
}

main();
