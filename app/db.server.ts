import { Prisma, PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient();
}

// Delegates that must exist on a warm Prisma client during dev HMR.
// If a delegate is missing, the cached client predates a `prisma generate`
// and must be recreated (e.g. after adding ActivityLog in Phase 4A).
const REQUIRED_DELEGATES = ["shop", "activityLog"] as const;

// Scalar fields that must exist on generated models after migrations.
// A stale cached client throws PrismaClientValidationError for unknown fields
// (e.g. `enabled`, `lastSortedAt`, `enabledAt`, `lastSortAttemptAt`).
const REQUIRED_COLLECTION_SCALAR_FIELDS = [
  "enabled",
  "lastSortedAt",
  "enabledAt",
  "lastSortAttemptAt",
] as const;

function hasRequiredDelegates(client: PrismaClient): boolean {
  return REQUIRED_DELEGATES.every(
    (delegate) => delegate in client && Boolean(client[delegate as keyof PrismaClient]),
  );
}

function hasRequiredCollectionFields(): boolean {
  return REQUIRED_COLLECTION_SCALAR_FIELDS.every(
    (field) => field in Prisma.CollectionScalarFieldEnum,
  );
}

function isPrismaClientCurrent(client: PrismaClient): boolean {
  return hasRequiredDelegates(client) && hasRequiredCollectionFields();
}

export function resetPrismaClient(): void {
  const cached = global.prismaGlobal;
  if (cached) {
    void cached.$disconnect();
    global.prismaGlobal = undefined;
  }
}

function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    return createPrismaClient();
  }

  const cached = global.prismaGlobal;
  if (cached && isPrismaClientCurrent(cached)) {
    return cached;
  }

  if (cached) {
    console.warn(
      "[db] Recreating stale Prisma client (missing delegates or schema fields). " +
        "Restart the dev server if queries still fail after migrations.",
    );
    void cached.$disconnect();
  }

  global.prismaGlobal = createPrismaClient();
  return global.prismaGlobal;
}

// Proxy so callers always use the current client after dev HMR / migrations.
// A module-level `const prisma = getPrismaClient()` would freeze a stale instance.
const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});

export default prisma;
