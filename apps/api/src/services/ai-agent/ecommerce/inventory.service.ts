/**
 * Real-Time Inventory & Stock Verification Service
 * Validates product & variation availability, manages stock caches,
 * prevents recommending or selling out-of-stock items, and suggests
 * in-stock alternatives when requested variants are unavailable.
 */

import { createLogger } from "../../../lib/logger.js";
import type {
  ECommercePlatformAdapter,
  InStockAlternative,
  StockCheckItem,
  StockCheckResult,
  StockItemValidation,
  StockValidationResult,
  UnifiedProduct,
} from "./ecommerce.interface.js";

const logger = createLogger("inventory-service");

export interface InventoryItemLike {
  id?: string | number;
  purchasable?: boolean;
  status?: string;
  stock_status?: "instock" | "outofstock" | "onbackorder" | string;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  backorders_allowed?: boolean;
  price?: string | number;
  regular_price?: string | number;
  sale_price?: string | number;
  inStock?: boolean;
  stockQuantity?: number | null;
  manageStock?: boolean;
  backordersAllowed?: boolean;
}

export interface InventoryServiceOptions {
  cacheTtlMs?: number; // default: 60,000ms (1 minute)
}

interface CachedStockEntry {
  result: StockCheckResult;
  expiresAt: number;
}

export class InventoryService {
  private cache: Map<string, CachedStockEntry> = new Map();
  private cacheTtlMs: number;

  constructor(options: InventoryServiceOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  /**
   * Synchronous real-time stock evaluator for any product or variation payload
   */
  public evaluateStock(
    item: InventoryItemLike,
    requestedQuantity = 1,
  ): StockCheckResult {
    const rawPrice = item.price ?? item.regular_price ?? 0;
    const unitPrice =
      typeof rawPrice === "number"
        ? rawPrice
        : Number.parseFloat(rawPrice || "0") || 0;

    // 1. Purchasable check
    if (item.purchasable === false) {
      return {
        available: false,
        availableQuantity: 0,
        unitPrice,
        errorReason: "Product is not purchasable",
      };
    }

    // 2. Status check (must be publish or active if defined)
    if (item.status && item.status !== "publish" && item.status !== "active") {
      return {
        available: false,
        availableQuantity: 0,
        unitPrice,
        errorReason: `Product status is '${item.status}' (expected publish)`,
      };
    }

    // 3. Stock status check
    const stockStatus = item.stock_status?.toLowerCase();
    const isOut = stockStatus === "outofstock" || item.inStock === false;

    if (isOut) {
      return {
        available: false,
        availableQuantity: 0,
        unitPrice,
        errorReason: "Item is out of stock",
      };
    }

    // 4. Managed stock quantity check
    const manageStock = item.manage_stock ?? item.manageStock ?? false;
    const stockQty = item.stock_quantity ?? item.stockQuantity ?? null;
    const backordersAllowed =
      item.backorders_allowed ?? item.backordersAllowed ?? false;

    if (manageStock && stockQty !== null) {
      if (stockQty <= 0 && !backordersAllowed) {
        return {
          available: false,
          availableQuantity: 0,
          unitPrice,
          errorReason: "Item is completely sold out",
        };
      }

      if (stockQty < requestedQuantity && !backordersAllowed) {
        return {
          available: false,
          availableQuantity: stockQty,
          unitPrice,
          errorReason: `Only ${stockQty} item(s) available in stock (requested: ${requestedQuantity})`,
        };
      }
    }

    return {
      available: true,
      availableQuantity: stockQty,
      unitPrice,
    };
  }

  /**
   * Finds alternative in-stock variants of a product when requested variation is sold out
   */
  public findInStockAlternatives(
    product: UnifiedProduct,
    requestedVariationId?: string,
    requestedAttributes?: Record<string, string>,
  ): InStockAlternative[] {
    if (!product.variations || product.variations.length === 0) {
      return [];
    }

    // Identify target attributes from the requested variation or explicit attributes
    let targetAttrs: Record<string, string> = { ...requestedAttributes };
    if (requestedVariationId) {
      const requestedVar = product.variations.find(
        (v) => String(v.id) === String(requestedVariationId),
      );
      if (requestedVar) {
        targetAttrs = { ...requestedVar.attributes, ...targetAttrs };
      }
    }

    const targetColor =
      targetAttrs.Color ||
      targetAttrs.color ||
      targetAttrs.Colour ||
      targetAttrs.colour;
    const targetSize = targetAttrs.Size || targetAttrs.size;

    const availableVars = product.variations.filter((v) => {
      if (
        requestedVariationId &&
        String(v.id) === String(requestedVariationId)
      ) {
        return false;
      }
      const evalResult = this.evaluateStock(v, 1);
      return evalResult.available;
    });

    const alternatives: InStockAlternative[] = [];

    for (const v of availableVars) {
      const vColor =
        v.attributes.Color ||
        v.attributes.color ||
        v.attributes.Colour ||
        v.attributes.colour;
      const vSize = v.attributes.Size || v.attributes.size;

      const attrSummary = Object.entries(v.attributes)
        .map(([k, val]) => `${k}: ${val}`)
        .join(", ");

      if (
        targetColor &&
        vColor &&
        vColor.toLowerCase() === targetColor.toLowerCase() &&
        (!targetSize || vSize?.toLowerCase() !== targetSize.toLowerCase())
      ) {
        alternatives.push({
          variation: v,
          matchType: "same_color_different_size",
          label: `Available in ${vSize || "other size"} (Same Color: ${vColor})`,
        });
      } else if (
        targetSize &&
        vSize &&
        vSize.toLowerCase() === targetSize.toLowerCase() &&
        (!targetColor || vColor?.toLowerCase() !== targetColor.toLowerCase())
      ) {
        alternatives.push({
          variation: v,
          matchType: "same_size_different_color",
          label: `Available in ${vColor || "other color"} (Same Size: ${vSize})`,
        });
      } else {
        alternatives.push({
          variation: v,
          matchType: "available_option",
          label: `Available option (${attrSummary || "In Stock"})`,
        });
      }
    }

    // Sort: same color first, then same size, then other available
    alternatives.sort((a, b) => {
      const priority = {
        same_color_different_size: 1,
        same_size_different_color: 2,
        available_option: 3,
      };
      return priority[a.matchType] - priority[b.matchType];
    });

    return alternatives;
  }

  /**
   * Evaluates stock for an entire cart/order using the platform adapter
   * Supports caching to minimize external API roundtrips
   */
  public async validateCartStock(
    adapter: ECommercePlatformAdapter,
    items: StockCheckItem[],
    options: { bypassCache?: boolean; ttlMs?: number } = {},
  ): Promise<StockValidationResult> {
    if (!items || items.length === 0) {
      return {
        available: true,
        items: [],
        totalPrice: 0,
      };
    }

    const now = Date.now();
    const bypassCache = options.bypassCache ?? false;
    const ttlMs = options.ttlMs ?? this.cacheTtlMs;

    // Check if all items are already cached
    const validatedItems: StockItemValidation[] = [];
    const uncachedItems: StockCheckItem[] = [];

    for (const item of items) {
      const cacheKey = `${adapter.platform}:${item.productId}:${item.variationId || "simple"}`;
      const cached = this.cache.get(cacheKey);

      if (!bypassCache && cached && cached.expiresAt > now) {
        // Cached entry present and fresh; verify requested quantity
        const isQtyAvailable =
          cached.result.availableQuantity === null ||
          cached.result.availableQuantity >= item.quantity;
        validatedItems.push({
          productId: item.productId,
          variationId: item.variationId,
          available: cached.result.available && isQtyAvailable,
          availableQuantity: cached.result.availableQuantity,
          unitPrice: cached.result.unitPrice,
          reason: isQtyAvailable
            ? cached.result.errorReason
            : `Requested ${item.quantity}, only ${cached.result.availableQuantity} available`,
        });
      } else {
        uncachedItems.push(item);
      }
    }

    if (uncachedItems.length > 0) {
      try {
        const liveResult = await adapter.checkStock(uncachedItems);

        for (const itemResult of liveResult.items) {
          const cacheKey = `${adapter.platform}:${itemResult.productId}:${itemResult.variationId || "simple"}`;
          this.cache.set(cacheKey, {
            result: {
              available: itemResult.available,
              availableQuantity: itemResult.availableQuantity,
              unitPrice: itemResult.unitPrice,
              errorReason: itemResult.reason,
            },
            expiresAt: now + ttlMs,
          });
          validatedItems.push(itemResult);
        }
      } catch (err) {
        logger.error(
          { error: err, adapter: adapter.platform },
          "Failed to validate stock via platform adapter",
        );
        return {
          available: false,
          items: items.map((i) => ({
            productId: i.productId,
            variationId: i.variationId,
            available: false,
            availableQuantity: 0,
            unitPrice: 0,
            reason:
              err instanceof Error ? err.message : "Stock validation failure",
          })),
          errorReason:
            err instanceof Error ? err.message : "Failed to verify stock",
        };
      }
    }

    const allAvailable = validatedItems.every((item) => item.available);
    const totalPrice = validatedItems.reduce((acc, item) => {
      const requestedItem = items.find(
        (i) =>
          i.productId === item.productId && i.variationId === item.variationId,
      );
      const qty = requestedItem?.quantity ?? 1;
      return acc + item.unitPrice * qty;
    }, 0);

    const firstUnavailable = validatedItems.find((item) => !item.available);

    return {
      available: allAvailable,
      items: validatedItems,
      totalPrice,
      errorReason: firstUnavailable?.reason,
    };
  }

  public clearCache(): void {
    this.cache.clear();
  }
}

export const inventoryService = new InventoryService();
