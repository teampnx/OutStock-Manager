type GraphqlBody = {
  errors?: {
    graphQLErrors?: Array<{ message?: string; extensions?: unknown }>;
    message?: string;
  };
};

type ShopifyUserError = {
  field?: string[] | string | null;
  message?: string;
};

type BillingErrorLike = Error & {
  errorData?: unknown;
  body?: GraphqlBody;
  response?: { body?: GraphqlBody };
};

export function extractShopifyUserErrors(error: unknown): ShopifyUserError[] {
  if (!error || typeof error !== "object") {
    return [];
  }

  const billingError = error as BillingErrorLike;
  if (Array.isArray(billingError.errorData)) {
    return billingError.errorData.filter(
      (entry): entry is ShopifyUserError =>
        typeof entry === "object" && entry !== null && "message" in entry,
    );
  }

  return [];
}

export function formatShopifyUserErrors(userErrors: ShopifyUserError[]): string {
  if (!userErrors.length) {
    return "";
  }

  return userErrors
    .map((entry) => entry.message ?? "Unknown billing error")
    .filter(Boolean)
    .join("; ");
}

export function formatBillingError(error: unknown): string {
  const userErrors = extractShopifyUserErrors(error);
  if (userErrors.length) {
    return formatShopifyUserErrors(userErrors);
  }

  if (error instanceof Error) {
    const graphqlError = error as BillingErrorLike;

    const graphQLErrors =
      graphqlError.body?.errors?.graphQLErrors ??
      graphqlError.response?.body?.errors?.graphQLErrors;

    if (graphQLErrors?.length) {
      return graphQLErrors
        .map((entry) => entry.message ?? "Unknown GraphQL error")
        .join("; ");
    }

    return error.message;
  }

  return String(error);
}

export function logBillingRequestStart(
  shopDomain: string,
  params: {
    plan: string;
    amount: number;
    currencyCode: string;
    interval: string;
    isTest: boolean;
    returnUrl: string;
    appUrl: string;
  },
): void {
  console.error(
    `[billing] billing.request START shop=${shopDomain}`,
    JSON.stringify(params, null, 2),
  );
}

export function logBillingRequestFailure(
  shopDomain: string,
  error: unknown,
): void {
  const userErrors = extractShopifyUserErrors(error);
  console.error(
    `[billing] billing.request FAIL shop=${shopDomain}`,
    formatBillingError(error),
  );

  if (userErrors.length) {
    console.error(
      `[billing] billing.request userErrors shop=${shopDomain}:`,
      JSON.stringify(userErrors, null, 2),
    );
  }

  logBillingError("billing.request", shopDomain, error);
}

export function logBillingError(
  context: string,
  shopDomain: string,
  error: unknown,
): void {
  const message = formatBillingError(error);
  console.error(`[billing] ${context} failed for ${shopDomain}: ${message}`);

  if (error instanceof Error) {
    const graphqlError = error as Error & {
      body?: unknown;
      response?: unknown;
    };

    if (graphqlError.body) {
      console.error(
        `[billing] ${context} response body for ${shopDomain}:`,
        JSON.stringify(graphqlError.body, null, 2),
      );
    }

    if (graphqlError.response) {
      console.error(
        `[billing] ${context} response for ${shopDomain}:`,
        JSON.stringify(graphqlError.response, null, 2),
      );
    }

    if (error.stack) {
      console.error(`[billing] ${context} stack for ${shopDomain}:`, error.stack);
    }
  }
}

export function isAuthRedirectResponse(error: unknown): error is Response {
  return error instanceof Response;
}
