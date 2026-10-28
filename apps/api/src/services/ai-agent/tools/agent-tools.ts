/**
 * Gemini Function-Calling Tool Declarations & Dispatcher
 * Location: apps/api/src/services/ai-agent/tools/agent-tools.ts
 *
 * Implements:
 * 1. search_catalog: Product discovery across merchant catalog
 * 2. check_stock_and_variants: Real-time stock & variation matrix verification
 * 3. calculate_order_pricing: Subtotal, coupon discount, delivery fee, and advance calculation
 * 4. book_woocommerce_order: Automated live WooCommerce order placement
 */

import { normalizeBdPhoneNumber } from "../conversation/slot-filler.js";
import {
  calculateOrderPricing,
  type DeliveryZone,
  type OrderPricingResult,
} from "../ecommerce/delivery-rules.js";
import type {
  ECommercePlatformAdapter,
  OrderBookingPayload,
  OrderBookingResult,
  StockValidationResult,
} from "../ecommerce/ecommerce.interface.js";
import type { MerchantPromptContext } from "../gemini/prompts.js";

export interface AgentToolContext {
  adapter: ECommercePlatformAdapter;
  companyId?: string;
  contactId?: string;
  promptContext?: MerchantPromptContext;
  conversationId?: string;
  customerJid?: string;
}

export interface AgentToolResult {
  tool: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * 1. search_catalog tool declaration
 */
export const searchCatalogTool = {
  name: "search_catalog",
  description:
    "Search the merchant's e-commerce catalog by keyword, product name, SKU, or category to find matching items with prices and stock status.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search keywords, product title, SKU, or garment description (e.g. 'Panjabi', 'Cotton Shirt', 'PAN-101')",
      },
      category: {
        type: "string",
        description: "Optional product category name or slug to filter by",
      },
      limit: {
        type: "number",
        description: "Maximum number of items to return (default: 5)",
      },
    },
    required: ["query"],
  },
};

/**
 * 2. check_stock_and_variants tool declaration
 */
export const checkStockAndVariantsTool = {
  name: "check_stock_and_variants",
  description:
    "Check live inventory availability, current price, and variation options (e.g. Size, Color) for a specific product ID before taking an order.",
  parameters: {
    type: "object",
    properties: {
      productId: {
        type: "string",
        description: "The WooCommerce or Shopify Product ID",
      },
      variationId: {
        type: "string",
        description: "Optional variation ID for variable products",
      },
      size: {
        type: "string",
        description: "Optional size name (e.g. 'M', 'L', 'XL', 'XXL')",
      },
      color: {
        type: "string",
        description:
          "Optional color name (e.g. 'Black', 'Navy Blue', 'Maroon')",
      },
      quantity: {
        type: "number",
        description: "Quantity desired to verify stock against (default: 1)",
      },
    },
    required: ["productId"],
  },
};

/**
 * 3. calculate_order_pricing tool declaration
 */
export const calculateOrderPricingTool = {
  name: "calculate_order_pricing",
  description:
    "Calculate the financial breakdown of an order: subtotal, coupon discounts, zone-based delivery fee, grand total, and outside Dhaka courier advance.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "List of items in the cart",
        items: {
          type: "object",
          properties: {
            productId: { type: "string" },
            variationId: { type: "string" },
            unitPrice: { type: "number" },
            quantity: { type: "number" },
          },
          required: ["unitPrice", "quantity"],
        },
      },
      deliveryZone: {
        type: "string",
        enum: ["inside_dhaka", "sub_dhaka", "outside_dhaka", "ambiguous"],
        description: "Classified delivery zone of customer's shipping address",
      },
      couponCode: {
        type: "string",
        description: "Optional discount coupon code",
      },
      paymentMethod: {
        type: "string",
        enum: ["cod", "bkash", "nagad"],
        description: "Payment method selected by the customer (default: 'cod')",
      },
    },
    required: ["items", "deliveryZone"],
  },
};

/**
 * 4. book_woocommerce_order tool declaration
 */
export const bookWooCommerceOrderTool = {
  name: "book_woocommerce_order",
  description:
    "Submit a confirmed customer order into the merchant's live WooCommerce store with full billing, shipping, line items, and zone delivery fee.",
  parameters: {
    type: "object",
    properties: {
      customerName: {
        type: "string",
        description: "Full recipient customer name",
      },
      phoneNumber: {
        type: "string",
        description: "Strict 11-digit Bangladeshi mobile number (013-019)",
      },
      deliveryAddress: {
        type: "string",
        description: "Complete physical delivery address",
      },
      deliveryZone: {
        type: "string",
        enum: ["inside_dhaka", "sub_dhaka", "outside_dhaka"],
        description: "Target delivery zone",
      },
      items: {
        type: "array",
        description: "Items to order",
        items: {
          type: "object",
          properties: {
            productId: { type: "string" },
            variationId: { type: "string" },
            quantity: { type: "number" },
            unitPrice: { type: "number" },
          },
          required: ["productId", "quantity", "unitPrice"],
        },
      },
      deliveryFee: {
        type: "number",
        description: "Delivery fee in BDT",
      },
      discountAmount: {
        type: "number",
        description: "Discount amount in BDT (if any)",
      },
      paymentMethod: {
        type: "string",
        enum: ["cod", "bkash", "nagad"],
        description: "Payment method (default: 'cod')",
      },
      notes: {
        type: "string",
        description: "Optional customer note or instructions",
      },
    },
    required: [
      "customerName",
      "phoneNumber",
      "deliveryAddress",
      "deliveryZone",
      "items",
      "deliveryFee",
      "paymentMethod",
    ],
  },
};

/**
 * Standard Google GenAI SDK tool structure
 */
export const GEMINI_AGENT_TOOLS = {
  functionDeclarations: [
    searchCatalogTool,
    checkStockAndVariantsTool,
    calculateOrderPricingTool,
    bookWooCommerceOrderTool,
  ],
};

/**
 * Execution dispatcher that routes Gemini function calls to e-commerce and pricing services
 */
export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentToolContext,
): Promise<AgentToolResult> {
  const { adapter, promptContext, conversationId, customerJid } = context;

  switch (toolName) {
    case "search_catalog": {
      try {
        const query = String(args.query || "").toLowerCase();
        const limit = Number(args.limit) || 5;
        const category = args.category
          ? String(args.category).toLowerCase()
          : undefined;

        const allProducts = await adapter.syncProducts();
        const matches = allProducts
          .filter((p) => {
            const nameMatch = p.name.toLowerCase().includes(query);
            const skuMatch = p.sku.toLowerCase().includes(query);
            const descMatch = (p.description || "")
              .toLowerCase()
              .includes(query);
            const catMatch = category
              ? p.categories?.some((c) =>
                  c.name.toLowerCase().includes(category),
                )
              : true;

            return (nameMatch || skuMatch || descMatch) && catMatch;
          })
          .slice(0, limit);

        const summarized = matches.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          inStock: p.inStock,
          stockQuantity: p.stockQuantity,
          variationsCount: p.variations.length,
          availableSizes: [
            ...new Set(
              p.variations
                .map((v) => v.attributes.Size || v.attributes.size)
                .filter(Boolean),
            ),
          ],
          availableColors: [
            ...new Set(
              p.variations
                .map((v) => v.attributes.Color || v.attributes.color)
                .filter(Boolean),
            ),
          ],
        }));

        return {
          tool: toolName,
          success: true,
          data: {
            query,
            totalFound: matches.length,
            products: summarized,
          },
        };
      } catch (err: unknown) {
        return {
          tool: toolName,
          success: false,
          error: err instanceof Error ? err.message : "Catalog search failed",
        };
      }
    }

    case "check_stock_and_variants": {
      try {
        const productId = String(args.productId || "");
        let variationId = args.variationId
          ? String(args.variationId)
          : undefined;
        const requestedQuantity = Number(args.quantity) || 1;
        const requestedSize = args.size
          ? String(args.size).toLowerCase()
          : undefined;
        const requestedColor = args.color
          ? String(args.color).toLowerCase()
          : undefined;

        // If product has variations and user specified size/color, find matching variation
        if (adapter.getProduct) {
          const product = await adapter.getProduct(productId);
          if (
            product &&
            product.variations &&
            product.variations.length > 0 &&
            !variationId
          ) {
            const matched = product.variations.find((v) => {
              const vSize = (
                v.attributes.Size ||
                v.attributes.size ||
                ""
              ).toLowerCase();
              const vColor = (
                v.attributes.Color ||
                v.attributes.color ||
                ""
              ).toLowerCase();
              const sizeOk = !requestedSize || vSize === requestedSize;
              const colorOk = !requestedColor || vColor === requestedColor;
              return sizeOk && colorOk;
            });
            if (matched) {
              variationId = matched.id;
            }
          }
        }

        const stockResult: StockValidationResult = await adapter.checkStock([
          {
            productId,
            variationId,
            quantity: requestedQuantity,
          },
        ]);

        return {
          tool: toolName,
          success: true,
          data: {
            productId,
            variationId,
            requestedQuantity,
            available: stockResult.available,
            details: stockResult.items[0],
          },
        };
      } catch (err: unknown) {
        return {
          tool: toolName,
          success: false,
          error:
            err instanceof Error ? err.message : "Stock verification failed",
        };
      }
    }

    case "calculate_order_pricing": {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: Raw item argument mapping
        const rawItems = (args.items as any[]) || [];
        const items = rawItems.map((i) => ({
          unitPrice: Number(i.unitPrice) || 0,
          quantity: Number(i.quantity) || 1,
        }));
        const deliveryZone = (args.deliveryZone as DeliveryZone) || "ambiguous";
        const couponCode = args.couponCode
          ? String(args.couponCode)
          : undefined;
        const paymentMethod = (args.paymentMethod as string) || "cod";

        const pricing: OrderPricingResult = calculateOrderPricing({
          items,
          deliveryZone,
          coupon: couponCode
            ? { code: couponCode, type: "fixed", value: 0 }
            : undefined,
          rates: promptContext
            ? {
                insideDhaka: promptContext.insideDhakaFee,
                subDhaka: promptContext.subDhakaFee,
                outsideDhaka: promptContext.outsideDhakaFee,
              }
            : undefined,
          outsideDhakaAdvanceAmount: promptContext?.outsideDhakaAdvanceAmount,
          requireOutsideDhakaAdvance:
            promptContext?.outsideDhakaAdvanceRequired,
          paymentMethod,
        });

        return {
          tool: toolName,
          success: true,
          data: pricing,
        };
      } catch (err: unknown) {
        return {
          tool: toolName,
          success: false,
          error:
            err instanceof Error ? err.message : "Pricing calculation failed",
        };
      }
    }

    case "book_woocommerce_order": {
      try {
        const phoneValidation = normalizeBdPhoneNumber(
          String(args.phoneNumber || ""),
        );
        if (!phoneValidation.isValid || !phoneValidation.normalizedPhone) {
          return {
            tool: toolName,
            success: false,
            error:
              phoneValidation.error ||
              "Invalid Bangladeshi mobile phone number",
          };
        }

        // biome-ignore lint/suspicious/noExplicitAny: Raw item mapping
        const rawItems = (args.items as any[]) || [];
        const items = rawItems.map((i) => ({
          productId: String(i.productId),
          variationId: i.variationId ? String(i.variationId) : undefined,
          quantity: Number(i.quantity) || 1,
          unitPrice: Number(i.unitPrice) || 0,
        }));

        const payload: OrderBookingPayload = {
          customerName: String(args.customerName || ""),
          phoneNumber: phoneValidation.normalizedPhone,
          deliveryAddress: String(args.deliveryAddress || ""),
          deliveryZone: args.deliveryZone as
            | "inside_dhaka"
            | "sub_dhaka"
            | "outside_dhaka",
          items,
          deliveryFee: Number(args.deliveryFee) || 0,
          discountAmount: args.discountAmount ? Number(args.discountAmount) : 0,
          paymentMethod:
            (args.paymentMethod as "cod" | "bkash" | "nagad") || "cod",
          notes: args.notes ? String(args.notes) : undefined,
          conversationId,
          customerJid,
        };

        const result: OrderBookingResult = await adapter.createOrder(payload);

        return {
          tool: toolName,
          success: result.success,
          data: result,
          error: result.error,
        };
      } catch (err: unknown) {
        return {
          tool: toolName,
          success: false,
          error: err instanceof Error ? err.message : "Order placement failed",
        };
      }
    }

    default:
      return {
        tool: toolName,
        success: false,
        error: `Unknown agent tool: ${toolName}`,
      };
  }
}
