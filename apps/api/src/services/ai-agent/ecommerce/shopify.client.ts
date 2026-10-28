/**
 * Shopify Admin GraphQL API Adapter
 * Conforms to ECommercePlatformAdapter for Shopify roadmap integration.
 */

import { createLogger, formatError } from "../../../lib/logger.js";
import type {
  ECommercePlatformAdapter,
  FetchFn,
  OrderBookingPayload,
  OrderBookingResult,
  StockCheckItem,
  StockItemValidation,
  StockValidationResult,
  UnifiedProduct,
  UnifiedProductVariation,
} from "./ecommerce.interface.js";

const logger = createLogger("shopify-client");

export class ShopifyError extends Error {
  public status: number;
  public code?: string;
  public userErrors?: Array<{ field?: string[]; message: string }>;

  constructor(
    message: string,
    status: number,
    code?: string,
    userErrors?: Array<{ field?: string[]; message: string }>,
  ) {
    super(message);
    this.name = "ShopifyError";
    this.status = status;
    this.code = code;
    this.userErrors = userErrors;
  }
}

export interface ShopifyConfig {
  shopDomain: string; // e.g. "mystore.myshopify.com"
  accessToken: string; // "shpat_..."
  apiVersion?: string; // default: "2024-04"
  timeoutMs?: number; // default: 15,000ms
  customFetch?: FetchFn;
}

interface ShopifyGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: unknown }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

export class ShopifyClient implements ECommercePlatformAdapter {
  public readonly platform = "shopify" as const;

  private shopDomain: string;
  private accessToken: string;
  private apiVersion: string;
  private timeoutMs: number;
  private fetchFn: FetchFn;

  constructor(config: ShopifyConfig) {
    if (!config.shopDomain) {
      throw new Error("ShopifyClient requires a valid shopDomain");
    }
    if (!config.accessToken) {
      throw new Error("ShopifyClient requires a valid accessToken");
    }

    this.shopDomain = config.shopDomain
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion || "2024-04";
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.fetchFn = config.customFetch || globalThis.fetch;
  }

  private getGraphQLEndpoint(): string {
    return `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
  }

  /**
   * Helper to execute GraphQL queries/mutations
   */
  public async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const endpoint = this.getGraphQLEndpoint();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": this.accessToken,
          Accept: "application/json",
          "User-Agent": "OmniTeam-ShopifyAdapter/1.0",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new ShopifyError(
            `Shopify authentication failed (${response.status}): Invalid access token or permissions`,
            response.status,
            "shopify_auth_error",
          );
        }
        if (response.status === 429) {
          throw new ShopifyError(
            "Shopify API rate limit exceeded (HTTP 429)",
            429,
            "shopify_throttled",
          );
        }
        throw new ShopifyError(
          `Shopify HTTP error: ${response.status} ${response.statusText}`,
          response.status,
          "shopify_http_error",
        );
      }

      const body = (await response.json()) as ShopifyGraphQLResponse<T>;

      if (body.errors && body.errors.length > 0) {
        const errorMsg = body.errors.map((e) => e.message).join("; ");
        throw new ShopifyError(
          `Shopify GraphQL error: ${errorMsg}`,
          200,
          "shopify_graphql_error",
        );
      }

      if (!body.data) {
        throw new ShopifyError(
          "Shopify returned empty data response",
          200,
          "shopify_empty_data",
        );
      }

      return body.data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ShopifyError) {
        throw err;
      }
      if ((err as Error).name === "AbortError" || controller.signal.aborted) {
        throw new ShopifyError(
          `Shopify request timeout after ${this.timeoutMs}ms`,
          408,
          "shopify_timeout",
        );
      }
      throw new ShopifyError(
        `Shopify network error: ${(err as Error).message}`,
        0,
        "shopify_network_error",
      );
    }
  }

  /**
   * Format variant or product ID into standard Shopify GID if necessary
   */
  private ensureGid(id: string, type: "Product" | "ProductVariant"): string {
    if (id.startsWith("gid://shopify/")) {
      return id;
    }
    return `gid://shopify/${type}/${id}`;
  }

  /**
   * Strip Shopify GID prefix to return clean ID
   */
  private extractIdFromGid(gid: string): string {
    return gid.replace(/^gid:\/\/shopify\/[^/]+\//, "");
  }

  /**
   * Sync active products from Shopify via GraphQL
   */
  public async syncProducts(modifiedAfter?: Date): Promise<UnifiedProduct[]> {
    const queryString = modifiedAfter
      ? `status:active updated_at:>=${modifiedAfter.toISOString()}`
      : "status:active";

    const query = `
      query GetProducts($first: Int!, $query: String, $after: String) {
        products(first: $first, query: $query, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              description
              handle
              status
              totalInventory
              images(first: 10) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
              options {
                name
                values
              }
              variants(first: 50) {
                edges {
                  node {
                    id
                    sku
                    price
                    compareAtPrice
                    availableForSale
                    inventoryQuantity
                    selectedOptions {
                      name
                      value
                    }
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    interface SyncProductsQueryData {
      products: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        // biome-ignore lint/suspicious/noExplicitAny: GraphQL schema response node
        edges: Array<{ node: any }>;
      };
    }

    const unifiedProducts: UnifiedProduct[] = [];
    let hasNextPage = true;
    let afterCursor: string | null = null;

    while (hasNextPage) {
      const data: SyncProductsQueryData =
        await this.graphql<SyncProductsQueryData>(query, {
          first: 50,
          query: queryString,
          after: afterCursor,
        });

      for (const edge of data.products.edges) {
        const node = edge.node;
        const variations: UnifiedProductVariation[] = [];

        if (node.variants?.edges) {
          // biome-ignore lint/suspicious/noExplicitAny: GraphQL variant edge
          for (const vEdge of node.variants.edges as any[]) {
            const v = vEdge.node;
            const attributes: Record<string, string> = {};
            if (v.selectedOptions && Array.isArray(v.selectedOptions)) {
              for (const opt of v.selectedOptions) {
                attributes[opt.name] = opt.value;
              }
            }

            const varPrice = Number.parseFloat(v.price || "0") || 0;
            const varRegularPrice = v.compareAtPrice
              ? Number.parseFloat(v.compareAtPrice) || varPrice
              : varPrice;

            variations.push({
              id: this.extractIdFromGid(v.id),
              sku: v.sku || "",
              price: varPrice,
              regularPrice: varRegularPrice,
              salePrice: v.compareAtPrice ? varPrice : undefined,
              inStock: v.availableForSale ?? false,
              stockQuantity: v.inventoryQuantity ?? null,
              manageStock: true,
              backordersAllowed: false,
              attributes,
              image: v.image?.url,
            });
          }
        }

        const primaryVariant = variations[0];
        const defaultPrice = primaryVariant?.price ?? 0;
        const defaultRegularPrice =
          primaryVariant?.regularPrice ?? defaultPrice;

        unifiedProducts.push({
          id: this.extractIdFromGid(node.id),
          name: node.title,
          sku: primaryVariant?.sku || "",
          price: defaultPrice,
          regularPrice: defaultRegularPrice,
          salePrice: primaryVariant?.salePrice,
          description: node.description || "",
          images: (node.images?.edges || [])
            // biome-ignore lint/suspicious/noExplicitAny: image edge
            .map((img: any) => img.node?.url)
            .filter(Boolean),
          inStock: node.totalInventory > 0 || variations.some((v) => v.inStock),
          stockQuantity: node.totalInventory ?? null,
          manageStock: true,
          backordersAllowed: false,
          status: node.status?.toLowerCase() === "active" ? "publish" : "draft",
          purchasable: node.status?.toLowerCase() === "active",
          type: variations.length > 1 ? "variable" : "simple",
          attributes: (node.options || []).map(
            (opt: { name: string; values: string[] }) => ({
              name: opt.name,
              options: opt.values || [],
              variation: true,
            }),
          ),
          variations,
        });
      }

      hasNextPage = data.products.pageInfo.hasNextPage;
      afterCursor = data.products.pageInfo.endCursor;
    }

    logger.info(
      { totalSynced: unifiedProducts.length },
      "Shopify catalog sync completed",
    );
    return unifiedProducts;
  }

  /**
   * Real-time stock verification for variant items
   */
  public async checkStock(
    items: StockCheckItem[],
  ): Promise<StockValidationResult> {
    const validatedItems: StockItemValidation[] = [];

    const query = `
      query CheckVariant($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            id
            title
            price
            availableForSale
            inventoryQuantity
          }
          ... on Product {
            id
            title
            totalInventory
            status
          }
        }
      }
    `;

    for (const item of items) {
      try {
        const targetGid = item.variationId
          ? this.ensureGid(item.variationId, "ProductVariant")
          : this.ensureGid(item.productId, "Product");

        // biome-ignore lint/suspicious/noExplicitAny: GraphQL node response
        const data = await this.graphql<{ node: any }>(query, {
          id: targetGid,
        });

        if (!data.node) {
          validatedItems.push({
            productId: item.productId,
            variationId: item.variationId,
            available: false,
            availableQuantity: 0,
            unitPrice: 0,
            reason: "Item not found in Shopify catalog",
          });
          continue;
        }

        const node = data.node;
        const isVariant = !!node.availableForSale !== undefined;
        const availableForSale = isVariant
          ? node.availableForSale
          : node.status === "ACTIVE" && (node.totalInventory ?? 0) > 0;
        const availableQuantity = isVariant
          ? (node.inventoryQuantity ?? null)
          : (node.totalInventory ?? null);
        const unitPrice = isVariant ? Number.parseFloat(node.price || "0") : 0;

        const isQtySufficient =
          availableQuantity === null || availableQuantity >= item.quantity;
        const available = availableForSale && isQtySufficient;

        let reason: string | undefined;
        if (!availableForSale) {
          reason = "Variant is out of stock";
        } else if (!isQtySufficient) {
          reason = `Only ${availableQuantity} items in stock (requested: ${item.quantity})`;
        }

        validatedItems.push({
          productId: item.productId,
          variationId: item.variationId,
          available,
          availableQuantity,
          unitPrice,
          reason,
        });
      } catch (err) {
        validatedItems.push({
          productId: item.productId,
          variationId: item.variationId,
          available: false,
          availableQuantity: 0,
          unitPrice: 0,
          reason:
            err instanceof Error ? err.message : "Shopify stock check failed",
        });
      }
    }

    const available = validatedItems.every((v) => v.available);
    const totalPrice = validatedItems.reduce((acc, curr) => {
      const req = items.find(
        (i) =>
          i.productId === curr.productId && i.variationId === curr.variationId,
      );
      return acc + curr.unitPrice * (req?.quantity ?? 1);
    }, 0);

    return {
      available,
      items: validatedItems,
      totalPrice,
      errorReason: validatedItems.find((v) => !v.available)?.reason,
    };
  }

  /**
   * Create order in Shopify via GraphQL mutation
   */
  public async createOrder(
    payload: OrderBookingPayload,
  ): Promise<OrderBookingResult> {
    const mutation = `
      mutation OrderCreate($order: OrderCreateOrderInput!) {
        orderCreate(order: $order) {
          order {
            id
            name
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            displayFinancialStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const lineItems = payload.items.map((item) => ({
      variantId: this.ensureGid(
        item.variationId || item.productId,
        "ProductVariant",
      ),
      quantity: item.quantity,
    }));

    const orderInput = {
      shippingAddress: {
        name: payload.customerName,
        address1: payload.deliveryAddress,
        city:
          payload.deliveryZone === "outside_dhaka" ? "Outside Dhaka" : "Dhaka",
        country: "Bangladesh",
        countryCode: "BD",
        phone: payload.phoneNumber,
      },
      billingAddress: {
        name: payload.customerName,
        address1: payload.deliveryAddress,
        city:
          payload.deliveryZone === "outside_dhaka" ? "Outside Dhaka" : "Dhaka",
        country: "Bangladesh",
        countryCode: "BD",
        phone: payload.phoneNumber,
      },
      lineItems,
      customAttributes: [
        { key: "source", value: "omniteam_ai_agent" },
        { key: "delivery_zone", value: payload.deliveryZone },
        { key: "payment_method", value: payload.paymentMethod },
        ...(payload.customerJid
          ? [{ key: "customer_jid", value: payload.customerJid }]
          : []),
      ],
      note: payload.notes || "Order booked via OmniTeam AI Agent",
    };

    try {
      interface OrderCreateMutationResult {
        orderCreate: {
          order?: {
            id: string;
            name: string;
            currentTotalPriceSet?: {
              shopMoney?: {
                amount: string;
                currencyCode: string;
              };
            };
            displayFinancialStatus?: string;
          };
          userErrors?: Array<{ field?: string[]; message: string }>;
        };
      }

      const res = await this.graphql<OrderCreateMutationResult>(mutation, {
        order: orderInput,
      });

      if (res.orderCreate.userErrors && res.orderCreate.userErrors.length > 0) {
        const errMsg = res.orderCreate.userErrors
          .map((e) => e.message)
          .join("; ");
        return {
          success: false,
          orderId: "",
          orderTotal: 0,
          status: "failed",
          error: `Shopify userError: ${errMsg}`,
        };
      }

      const createdOrder = res.orderCreate.order;
      if (!createdOrder) {
        return {
          success: false,
          orderId: "",
          orderTotal: 0,
          status: "failed",
          error: "Shopify did not return an order object",
        };
      }

      const total = Number.parseFloat(
        createdOrder.currentTotalPriceSet?.shopMoney?.amount || "0",
      );

      return {
        success: true,
        orderId: this.extractIdFromGid(createdOrder.id) || createdOrder.name,
        orderTotal: total,
        status: createdOrder.displayFinancialStatus || "created",
        rawOrder: createdOrder,
      };
    } catch (err) {
      logger.error(
        { error: formatError(err), customer: payload.customerName },
        "Shopify order booking failed",
      );
      return {
        success: false,
        orderId: "",
        orderTotal: 0,
        status: "failed",
        error:
          err instanceof Error
            ? err.message
            : "Unknown Shopify order creation failure",
      };
    }
  }
}
