import shopify from "../shopify.server";

export async function getAdminForShop(shopDomain: string) {
  const { admin, session } = await shopify.unauthenticated.admin(shopDomain);

  if (!session) {
    throw new Error(`No Shopify session found for shop: ${shopDomain}`);
  }

  return admin;
}
