import { PrismaClient } from "@prisma/client";

const shopDomain = "outstock-test-lionlx2x.myshopify.com";
const productGid = "gid://shopify/Product/8946398134408";
const collectionGid = "gid://shopify/Collection/312002609288";
const inventoryItemId = "gid://shopify/InventoryItem/48208828039304";
const locationId = "gid://shopify/Location/83276169352";

const prisma = new PrismaClient();

async function shopifyGraphql(query, variables = {}) {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
  });
  if (!session?.accessToken) {
    throw new Error("No offline session found");
  }

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
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? "GraphQL error");
  }
  return json.data;
}

async function getAvailableQuantity() {
  const data = await shopifyGraphql(
    `#graphql
      query InventoryLevel($id: ID!, $locationId: ID!) {
        inventoryItem(id: $id) {
          inventoryLevel(locationId: $locationId) {
            quantities(names: ["available"]) {
              quantity
            }
          }
        }
      }
    `,
    { id: inventoryItemId, locationId },
  );
  return (
    data?.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity ?? 0
  );
}

async function setInventory(quantity) {
  const changeFromQuantity = await getAvailableQuantity();
  const data = await shopifyGraphql(
    `#graphql
      mutation SetInventory($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors { field message }
        }
      }
    `,
    {
      input: {
        name: "available",
        reason: "correction",
        quantities: [
          {
            inventoryItemId,
            locationId,
            quantity,
            changeFromQuantity,
          },
        ],
      },
    },
  );
  const errors = data?.inventorySetQuantities?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors[0]?.message ?? "inventorySetQuantities failed");
  }
}

async function getProductIndexInCollection() {
  const data = await shopifyGraphql(
    `#graphql
      query CollectionProducts($id: ID!) {
        collection(id: $id) {
          products(first: 250) {
            nodes { id title }
          }
        }
      }
    `,
    { id: collectionGid },
  );
  const nodes = data?.collection?.products?.nodes ?? [];
  const index = nodes.findIndex((node) => node.id === productGid);
  return { index, total: nodes.length, title: nodes[index]?.title ?? null };
}

async function waitForJob(type, afterMs, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jobs = await prisma.job.findMany({
      where: {
        type,
        shopDomain,
        updatedAt: { gte: new Date(afterMs) },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });
    const job = jobs.find((entry) => {
      const payload = entry.payload;
      return (
        typeof payload === "object" &&
        payload !== null &&
        payload.shopifyProductId === productGid &&
        payload.shopifyCollectionId === collectionGid
      );
    });
    if (job && (job.status === "COMPLETED" || job.status === "DEAD")) {
      return job;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for ${type}`);
}

async function main() {
  const before = await getProductIndexInCollection();
  console.log(
    JSON.stringify({ step: "before", position: before.index, total: before.total }),
  );

  const restockAt = Date.now();
  console.log(JSON.stringify({ step: "set_inventory", quantity: 1 }));
  await setInventory(1);
  const restoreJob = await waitForJob("RESTORE_PRODUCT_POSITION", restockAt);
  const afterRestore = await getProductIndexInCollection();
  console.log(
    JSON.stringify({
      step: "after_restore",
      restoreJob: { id: restoreJob.id, status: restoreJob.status, lastError: restoreJob.lastError },
      position: afterRestore.index,
      total: afterRestore.total,
    }),
  );

  const soldOutAt = Date.now();
  console.log(JSON.stringify({ step: "set_inventory", quantity: 0 }));
  await setInventory(0);
  const reorderJob = await waitForJob("REORDER_SOLD_OUT_PRODUCT", soldOutAt);
  const afterReorder = await getProductIndexInCollection();
  console.log(
    JSON.stringify({
      step: "after_reorder",
      reorderJob: { id: reorderJob.id, status: reorderJob.status, lastError: reorderJob.lastError },
      position: afterReorder.index,
      total: afterReorder.total,
      atBottom: afterReorder.index === afterReorder.total - 1,
    }),
  );

  await prisma.$disconnect();
  if (reorderJob.status !== "COMPLETED") {
    process.exit(1);
  }
  if (afterReorder.index !== afterReorder.total - 1) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
