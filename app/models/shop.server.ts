import type { Plan, Prisma } from "@prisma/client";
import prisma from "../db.server";

const SHOP_NAME_QUERY = `#graphql
  query OutStockShopName {
    shop {
      name
    }
  }
`;

export type ShopWithSettings = Prisma.ShopGetPayload<{
  include: { settings: true };
}>;

export async function fetchShopName(
  admin: { graphql: (query: string) => Promise<Response> },
): Promise<string | null> {
  try {
    const response = await admin.graphql(SHOP_NAME_QUERY);
    const json = await response.json();
    return json.data?.shop?.name ?? null;
  } catch {
    return null;
  }
}

export async function ensureShop(
  shopDomain: string,
  shopName?: string | null,
): Promise<ShopWithSettings> {
  const shop = await prisma.shop.upsert({
    where: { shopDomain },
    create: {
      shopDomain,
      shopName: shopName ?? null,
      plan: "FREE",
      settings: {
        create: {},
      },
    },
    update: {
      ...(shopName ? { shopName } : {}),
    },
    include: { settings: true },
  });

  if (!shop.settings) {
    await prisma.settings.create({
      data: { shopId: shop.id },
    });
    return prisma.shop.findUniqueOrThrow({
      where: { id: shop.id },
      include: { settings: true },
    });
  }

  return shop;
}

export async function getShopByDomain(
  shopDomain: string,
): Promise<ShopWithSettings | null> {
  return prisma.shop.findUnique({
    where: { shopDomain },
    include: { settings: true },
  });
}

export async function updateShopPlan(
  shopDomain: string,
  plan: Plan,
): Promise<ShopWithSettings> {
  return prisma.shop.update({
    where: { shopDomain },
    data: { plan },
    include: { settings: true },
  });
}
