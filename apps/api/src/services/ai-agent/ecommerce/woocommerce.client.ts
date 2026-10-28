/**
 * WooCommerce REST API v3 Client
 * Implements ECommercePlatformAdapter for 2-way catalog sync, real-time stock
 * evaluation, and automated order booking with HTTPS Basic Auth.
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
import { inventoryService } from "./inventory.service.js";

const logger = createLogger("woocommerce-client");

export class WooCommerceError extends Error {
  public status: number;
  public code?: string;
  public data?: unknown;

  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message);
    this.name = "WooCommerceError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export interface WooCommerceConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  version?: string; // default: "wc/v3"
  timeoutMs?: number; // default: 15,000ms
  perPage?: number; // default: 50, max: 100
  customFetch?: FetchFn;
}

export interface WCProductImage {
  id: number;
  src: string;
  name?: string;
  alt?: string;
}

export interface WCProductAttribute {
  id: number;
  name: string;
  position?: number;
  visible?: boolean;
  variation?: boolean;
  options: string[];
}

export interface WCProduct {
  id: number;
  name: string;
  slug?: string;
  permalink?: string;
  type: string;
  status: string;
  featured?: boolean;
  description?: string;
  short_description?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  purchasable?: boolean;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: "instock" | "outofstock" | "onbackorder" | string;
  backorders_allowed?: boolean;
  categories?: Array<{ id: number; name: string; slug?: string }>;
  images?: WCProductImage[];
  attributes?: WCProductAttribute[];
  variations?: number[];
}

export interface WCDimensions {
  length: string;
  width: string;
  height: string;
}

export interface WCVariation {
  id: number;
  date_created?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  status?: string;
  purchasable?: boolean;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: "instock" | "outofstock" | "onbackorder" | string;
  backorders_allowed?: boolean;
  image?: WCProductImage;
  attributes?: Array<{
    id: number;
    name: string;
    option: string;
  }>;
}

export interface WCOrderResponse {
  id: number;
  order_key?: string;
  status: string;
  currency?: string;
  total: string;
  subtotal?: string;
  shipping_total?: string;
  discount_total?: string;
}

export class WooCommerceClient implements ECommercePlatformAdapter {
  public readonly platform = "woocommerce" as const;

  private baseUrl: string;
  private consumerKey: string;
  private consumerSecret: string;
  private version: string;
  private timeoutMs: number;
  private perPage: number;
  private fetchFn: FetchFn;

  constructor(config: WooCommerceConfig) {
    if (!config.baseUrl) {
      throw new Error("WooCommerceClient requires a valid baseUrl");
    }
    if (!config.consumerKey || !config.consumerSecret) {
      throw new Error(
        "WooCommerceClient requires consumerKey and consumerSecret for Basic Auth",
      );
    }

    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.version = config.version || "wc/v3";
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.perPage = Math.min(config.perPage ?? 50, 100);
    this.fetchFn = config.customFetch || globalThis.fetch;
  }

  /**
   * Internal URL builder handling basePath with or without /wp-json prefix
   */
  private buildUrl(
    endpoint: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    let base = this.baseUrl;

    if (!base.includes("/wp-json")) {
      base = `${base}/wp-json/${this.version}`;
    } else if (!base.includes(this.version)) {
      base = `${base}/${this.version}`;
    }

    const url = new URL(`${base}${cleanEndpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  /**
   * Internal HTTP request handler with Basic Auth, Timeout, and structured errors
   */
  private async request<T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
    } = {},
  ): Promise<{ data: T; headers: Headers }> {
    const url = this.buildUrl(endpoint, options.params);
    const method = options.method || "GET";

    const authHeader = `Basic ${Buffer.from(
      `${this.consumerKey}:${this.consumerSecret}`,
    ).toString("base64")}`;

    const headers: Record<string, string> = {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "OmniTeam-AIAgent-WooCommerceSync/1.0",
    };

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutTimer);

      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");
      const rawText = await response.text();
      // biome-ignore lint/suspicious/noExplicitAny: Raw JSON parse target
      let responseData: any = null;

      if (rawText && isJson) {
        try {
          responseData = JSON.parse(rawText);
        } catch {
          responseData = rawText;
        }
      } else {
        responseData = rawText;
      }

      if (!response.ok) {
        const errorMsg =
          responseData?.message ||
          responseData?.code ||
          `HTTP ${response.status} ${response.statusText}`;

        if (response.status === 401 || response.status === 403) {
          throw new WooCommerceError(
            `WooCommerce authentication failed (${response.status}): ${errorMsg}`,
            response.status,
            responseData?.code || "woocommerce_auth_error",
            responseData,
          );
        }

        if (response.status === 404) {
          throw new WooCommerceError(
            `WooCommerce resource not found (${response.status}): ${errorMsg}`,
            response.status,
            responseData?.code || "woocommerce_not_found",
            responseData,
          );
        }

        if (response.status >= 500) {
          throw new WooCommerceError(
            `WooCommerce server error (${response.status}): ${errorMsg}`,
            response.status,
            responseData?.code || "woocommerce_server_error",
            responseData,
          );
        }

        throw new WooCommerceError(
          `WooCommerce API error (${response.status}): ${errorMsg}`,
          response.status,
          responseData?.code || "woocommerce_api_error",
          responseData,
        );
      }

      return { data: responseData as T, headers: response.headers };
    } catch (err: unknown) {
      clearTimeout(timeoutTimer);
      if (err instanceof WooCommerceError) {
        throw err;
      }
      if ((err as Error).name === "AbortError" || controller.signal.aborted) {
        throw new WooCommerceError(
          `WooCommerce request timeout after ${this.timeoutMs}ms for ${endpoint}`,
          408,
          "woocommerce_timeout",
        );
      }
      throw new WooCommerceError(
        `WooCommerce network error: ${(err as Error).message}`,
        0,
        "woocommerce_network_error",
      );
    }
  }

  /**
   * Fetches variations for a variable product
   */
  public async getProductVariations(
    productId: string | number,
  ): Promise<UnifiedProductVariation[]> {
    try {
      const { data } = await this.request<WCVariation[]>(
        `/products/${productId}/variations`,
        { params: { per_page: 100 } },
      );

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((v) => this.normalizeVariation(v));
    } catch (err) {
      logger.warn(
        { error: formatError(err), productId },
        "Could not fetch variations for product",
      );
      return [];
    }
  }

  /**
   * Normalizes a WooCommerce variation into UnifiedProductVariation
   */
  public normalizeVariation(v: WCVariation): UnifiedProductVariation {
    const price = Number.parseFloat(v.price || v.regular_price || "0") || 0;
    const regularPrice =
      Number.parseFloat(v.regular_price || v.price || "0") || price;
    const salePrice = v.sale_price
      ? Number.parseFloat(v.sale_price)
      : undefined;

    const attributes: Record<string, string> = {};
    if (v.attributes && Array.isArray(v.attributes)) {
      for (const attr of v.attributes) {
        if (attr.name && attr.option) {
          attributes[attr.name] = attr.option;
        }
      }
    }

    return {
      id: String(v.id),
      sku: v.sku || "",
      price,
      regularPrice,
      salePrice,
      inStock: v.stock_status === "instock",
      stockQuantity: v.stock_quantity ?? null,
      manageStock: v.manage_stock ?? false,
      backordersAllowed: v.backorders_allowed ?? false,
      attributes,
      image: v.image?.src,
    };
  }

  /**
   * Normalizes a WooCommerce product into UnifiedProduct
   */
  public normalizeProduct(
    p: WCProduct,
    variations: UnifiedProductVariation[] = [],
  ): UnifiedProduct {
    const price = Number.parseFloat(p.price || p.regular_price || "0") || 0;
    const regularPrice =
      Number.parseFloat(p.regular_price || p.price || "0") || price;
    const salePrice = p.sale_price
      ? Number.parseFloat(p.sale_price)
      : undefined;

    return {
      id: String(p.id),
      name: p.name || "",
      sku: p.sku || "",
      price,
      regularPrice,
      salePrice,
      description: p.description || "",
      shortDescription: p.short_description || "",
      images: (p.images || []).map((img) => img.src).filter(Boolean),
      inStock: p.stock_status === "instock",
      stockQuantity: p.stock_quantity ?? null,
      manageStock: p.manage_stock ?? false,
      backordersAllowed: p.backorders_allowed ?? false,
      status: p.status,
      purchasable: p.purchasable ?? true,
      type: p.type || "simple",
      categories: (p.categories || []).map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
      })),
      attributes: (p.attributes || []).map((attr) => ({
        id: attr.id,
        name: attr.name,
        options: attr.options || [],
        variation: attr.variation ?? false,
      })),
      variations,
    };
  }

  /**
   * Fetches full product catalog with pagination & variation resolution
   */
  public async syncProducts(modifiedAfter?: Date): Promise<UnifiedProduct[]> {
    const products: UnifiedProduct[] = [];
    let page = 1;
    let totalPages = 1;

    const baseParams: Record<string, string | number | boolean | undefined> = {
      per_page: this.perPage,
      status: "publish",
    };

    if (modifiedAfter) {
      baseParams.modified_after = modifiedAfter.toISOString();
    }

    do {
      const { data, headers } = await this.request<WCProduct[]>("/products", {
        params: { ...baseParams, page },
      });

      // Parse pagination headers
      const totalPagesHeader =
        headers.get("x-wp-totalpages") || headers.get("X-WP-TotalPages");
      if (totalPagesHeader) {
        totalPages = Number.parseInt(totalPagesHeader, 10) || 1;
      }

      if (Array.isArray(data) && data.length > 0) {
        for (const rawProduct of data) {
          let variations: UnifiedProductVariation[] = [];

          if (
            rawProduct.type === "variable" &&
            rawProduct.variations &&
            rawProduct.variations.length > 0
          ) {
            variations = await this.getProductVariations(rawProduct.id);
          }

          products.push(this.normalizeProduct(rawProduct, variations));
        }
      } else {
        break;
      }

      page++;
    } while (page <= totalPages);

    logger.info(
      { totalSynced: products.length, totalPages },
      "WooCommerce catalog sync complete",
    );
    return products;
  }

  /**
   * Fetches single product by ID
   */
  public async getProduct(id: string): Promise<UnifiedProduct | null> {
    try {
      const { data } = await this.request<WCProduct>(`/products/${id}`);
      let variations: UnifiedProductVariation[] = [];

      if (
        data.type === "variable" &&
        data.variations &&
        data.variations.length > 0
      ) {
        variations = await this.getProductVariations(data.id);
      }

      return this.normalizeProduct(data, variations);
    } catch (err) {
      if (err instanceof WooCommerceError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Real-time stock verification for cart items
   */
  public async checkStock(
    items: StockCheckItem[],
  ): Promise<StockValidationResult> {
    const validationItems: StockItemValidation[] = [];

    for (const item of items) {
      try {
        let evalTarget: WCProduct | WCVariation | null = null;

        if (item.variationId) {
          const { data } = await this.request<WCVariation>(
            `/products/${item.productId}/variations/${item.variationId}`,
          );
          evalTarget = data;
        } else {
          const { data } = await this.request<WCProduct>(
            `/products/${item.productId}`,
          );
          evalTarget = data;
        }

        const evalResult = inventoryService.evaluateStock(
          evalTarget,
          item.quantity,
        );
        validationItems.push({
          productId: item.productId,
          variationId: item.variationId,
          available: evalResult.available,
          availableQuantity: evalResult.availableQuantity,
          unitPrice: evalResult.unitPrice,
          reason: evalResult.errorReason,
        });
      } catch (err) {
        validationItems.push({
          productId: item.productId,
          variationId: item.variationId,
          available: false,
          availableQuantity: 0,
          unitPrice: 0,
          reason:
            err instanceof Error ? err.message : "Failed to verify live stock",
        });
      }
    }

    const available = validationItems.every((v) => v.available);
    const totalPrice = validationItems.reduce((acc, curr) => {
      const req = items.find(
        (i) =>
          i.productId === curr.productId && i.variationId === curr.variationId,
      );
      return acc + curr.unitPrice * (req?.quantity ?? 1);
    }, 0);

    return {
      available,
      items: validationItems,
      totalPrice,
      errorReason: validationItems.find((v) => !v.available)?.reason,
    };
  }

  /**
   * Automated live order placement into WooCommerce
   */
  public async createOrder(
    payload: OrderBookingPayload,
  ): Promise<OrderBookingResult> {
    try {
      const zoneName =
        payload.deliveryZone === "inside_dhaka"
          ? "Inside Dhaka"
          : payload.deliveryZone === "sub_dhaka"
            ? "Sub-Dhaka"
            : "Outside Dhaka";

      const city =
        payload.deliveryZone === "outside_dhaka" ? "Outside Dhaka" : "Dhaka";

      // Outside Dhaka orders awaiting advance courier fee are placed on-hold or pending
      const initialStatus =
        payload.deliveryZone === "outside_dhaka" &&
        payload.paymentMethod === "cod"
          ? "on-hold"
          : "processing";

      const lineItems = payload.items.map((item) => ({
        product_id: Number.parseInt(item.productId, 10),
        ...(item.variationId
          ? { variation_id: Number.parseInt(item.variationId, 10) }
          : {}),
        quantity: item.quantity,
      }));

      const shippingLines = [
        {
          method_id: "flat_rate",
          method_title: `${zoneName} Delivery`,
          total: payload.deliveryFee.toFixed(2),
        },
      ];

      const couponLines =
        payload.discountAmount && payload.discountAmount > 0
          ? [
              {
                code: "DISCOUNT",
                discount: payload.discountAmount.toFixed(2),
              },
            ]
          : [];

      const paymentMethodTitles: Record<string, string> = {
        cod: "Cash on Delivery",
        bkash: "bKash Payment",
        nagad: "Nagad Payment",
      };

      const metaData = [
        { key: "_source", value: "omniteam_ai_agent" },
        { key: "_delivery_zone", value: payload.deliveryZone },
        ...(payload.customerJid
          ? [{ key: "_customer_jid", value: payload.customerJid }]
          : []),
        ...(payload.conversationId
          ? [{ key: "_conversation_id", value: payload.conversationId }]
          : []),
      ];

      const wcOrderPayload = {
        payment_method: payload.paymentMethod,
        payment_method_title:
          paymentMethodTitles[payload.paymentMethod] || "Cash on Delivery",
        set_paid: false,
        status: initialStatus,
        billing: {
          first_name: payload.customerName,
          address_1: payload.deliveryAddress,
          city,
          country: "BD",
          phone: payload.phoneNumber,
        },
        shipping: {
          first_name: payload.customerName,
          address_1: payload.deliveryAddress,
          city,
          country: "BD",
          phone: payload.phoneNumber,
        },
        line_items: lineItems,
        shipping_lines: shippingLines,
        coupon_lines: couponLines,
        customer_note:
          payload.notes || "Order booked via OmniTeam AI Assistant.",
        meta_data: metaData,
      };

      const { data } = await this.request<WCOrderResponse>("/orders", {
        method: "POST",
        body: wcOrderPayload,
      });

      return {
        success: true,
        orderId: String(data.id),
        orderTotal: Number.parseFloat(data.total || "0"),
        status: data.status,
        rawOrder: data,
      };
    } catch (err: unknown) {
      logger.error(
        { error: formatError(err), customer: payload.customerName },
        "WooCommerce order booking failed",
      );
      return {
        success: false,
        orderId: "",
        orderTotal: 0,
        status: "failed",
        error:
          err instanceof Error ? err.message : "Unknown order creation failure",
      };
    }
  }
}
