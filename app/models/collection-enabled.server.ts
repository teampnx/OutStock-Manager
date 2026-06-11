import prisma from "../db.server";
import { toCollectionGid } from "../services/shopify-collections.server";
import { ensureShop } from "./shop.server";

export async function isCollectionEnabledForReorder(
  shopDomain: string,
  shopifyCollectionId: string,
): Promise<boolean> {
  const shop = await ensureShop(shopDomain);
  const collection = await prisma.collection.findUnique({
    where: {
      shopId_shopifyCollectionId: {
        shopId: shop.id,
        shopifyCollectionId: toCollectionGid(shopifyCollectionId),
      },
    },
    select: { enabled: true },
  });

  return collection?.enabled ?? false;
}
