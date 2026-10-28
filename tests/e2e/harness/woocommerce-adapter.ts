/**
 * In-Memory Adapter conforming MockWooCommerceServer to ECommercePlatformAdapter
 * Location: tests/e2e/harness/woocommerce-adapter.ts
 */

import type {
  ECommercePlatformAdapter,
  OrderBookingPayload,
  OrderBookingResult,
  StockValidationResult,
  UnifiedProduct,
  UnifiedProductVariation,
} from "../../../apps/api/src/services/ai-agent/ecommerce/ecommerce.interface.js";
import type { CatalogProduct } from "../types.js";
import type { MockWooCommerceServer } from "./mock-woocommerce.js";

export class MockWooCommerceAdapter implements ECommercePlatformAdapter {
  public readonly platform = "woocommerce" as const;
  private server: MockWooCommerceServer;

  constructor(server: MockWooCommerceServer) {
    this.server = server;
  }

  public async syncProducts(_modifiedAfter?: Date): Promise<UnifiedProduct[]> {
    const rawList = this.server.getProducts();
    return rawList.map((p) => this.mapToUnifiedProduct(p));
  }

  public async getProduct(id: string): Promise<UnifiedProduct | null> {
    const numId = Number.parseInt(id, 10);
    const p = this.server.getProduct(numId);
    if (!p) return null;
    return this.mapToUnifiedProduct(p);
  }

  public async checkStock(
    items: Array<{ productId: string; variationId?: string; quantity: number }>,
  ): Promise<StockValidationResult> {
    const validations = [];
    let allAvailable = true;
    let totalPrice = 0;

    for (const item of items) {
      const prodId = Number.parseInt(item.productId, 10);
      const varId = item.variationId
        ? Number.parseInt(item.variationId, 10)
        : null;
      const stockRes = this.server.checkStock(prodId, varId, item.quantity);

      validations.push({
        productId: item.productId,
        variationId: item.variationId,
        available: stockRes.available,
        availableQuantity: stockRes.availableQuantity,
        unitPrice: stockRes.unitPrice,
        reason: stockRes.errorReason,
      });

      if (!stockRes.available) {
        allAvailable = false;
      }
      totalPrice += stockRes.unitPrice * item.quantity;
    }

    return {
      available: allAvailable,
      items: validations,
      totalPrice,
      errorReason: allAvailable
        ? undefined
        : "One or more items are out of stock",
    };
  }

  public async createOrder(
    payload: OrderBookingPayload,
  ): Promise<OrderBookingResult> {
    try {
      const lineItems = payload.items.map((i) => ({
        product_id: Number.parseInt(i.productId, 10),
        variation_id: i.variationId ? Number.parseInt(i.variationId, 10) : null,
        quantity: i.quantity,
        price: i.unitPrice,
      }));

      const subtotal = lineItems.reduce(
        (acc, i) => acc + i.price * i.quantity,
        0,
      );
      const grandTotal =
        subtotal - (payload.discountAmount || 0) + payload.deliveryFee;
      const status =
        payload.deliveryZone === "outside_dhaka" ? "on-hold" : "processing";

      const rawOrder = this.server.createOrder({
        billing: {
          first_name: payload.customerName,
          phone: payload.phoneNumber,
          address_1: payload.deliveryAddress,
        },
        shipping: {
          first_name: payload.customerName,
          address_1: payload.deliveryAddress,
        },
        payment_method: payload.paymentMethod,
        shipping_total: payload.deliveryFee,
        discount_total: payload.discountAmount || 0,
        deliveryFee: payload.deliveryFee,
        total: grandTotal,
        status,
        line_items: lineItems,
        customer_note: payload.notes,
      });

      return {
        success: true,
        orderId: String(rawOrder.id),
        orderTotal: rawOrder.total,
        status: rawOrder.status,
        rawOrder,
      };
    } catch (error: any) {
      return {
        success: false,
        orderId: "",
        orderTotal: 0,
        status: "failed",
        error: error?.message || "Order booking failed",
      };
    }
  }

  public async handlePaymentReceipt(
    senderPhone: string,
    trxId: string,
    amount?: number,
  ): Promise<boolean> {
    const orders = this.server.getOrders();
    const cleanPhone = senderPhone.replace(/[^\d]/g, "");
    const matchingOrder = orders
      .slice()
      .reverse()
      .find((o) => {
        const orderPhone = (
          o.billing?.phone ||
          o.shipping?.phone ||
          ""
        ).replace(/[^\d]/g, "");
        return (
          (orderPhone &&
            (cleanPhone.includes(orderPhone) ||
              orderPhone.includes(cleanPhone))) ||
          o.status === "on-hold"
        );
      });

    if (matchingOrder) {
      this.server.updateOrder(matchingOrder.id, {
        status: "processing",
        customer_note: `bKash advance payment verified: TrxID ${trxId}, Amount: ${amount || 120} Tk`,
      });
      return true;
    }
    return false;
  }

  private mapToUnifiedProduct(p: CatalogProduct): UnifiedProduct {
    const variations: UnifiedProductVariation[] = (p.variations || []).map(
      (v) => ({
        id: String(v.id),
        sku: v.sku,
        price: v.price,
        regularPrice: v.regular_price,
        inStock: v.stock_status === "instock",
        stockQuantity: v.stock_quantity,
        backordersAllowed: p.backorders_allowed,
        attributes: v.attributes,
      }),
    );

    return {
      id: String(p.id),
      name: p.name,
      sku: p.sku,
      price: p.price,
      regularPrice: p.regular_price,
      description: p.description,
      images: p.images || [],
      inStock: p.stock_status === "instock",
      stockQuantity: p.stock_quantity,
      manageStock: p.manage_stock,
      backordersAllowed: p.backorders_allowed,
      categories: (p.categories || []).map((c, idx) => ({ id: idx, name: c })),
      attributes: (p.attributes || []).map((a) => ({
        name: a.name,
        options: a.options,
        variation: true,
      })),
      variations,
    };
  }
}
