import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient();
}

function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    return createPrismaClient();
  }

  const cached = global.prismaGlobal;
  if (cached?.shop) {
    return cached;
  }

  if (cached) {
    void cached.$disconnect();
  }

  global.prismaGlobal = createPrismaClient();
  return global.prismaGlobal;
}

const prisma = getPrismaClient();

export default prisma;
