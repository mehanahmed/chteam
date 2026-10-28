import type {
  CatalogProduct,
  RecordedWooCommerceOrder,
  StockCheckResult,
} from "../types.js";
import { SAMPLE_CATALOG } from "./fixtures/sample-catalog.js";

export class MockWooCommerceServer {
  private products: Map<number, CatalogProduct> = new Map();
  private orders: Map<number, RecordedWooCommerceOrder> = new Map();
  private nextOrderId = 9842;
  public simulateOutofStockRaceCondition = false;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.products.clear();
    this.orders.clear();
    this.nextOrderId = 9842;
    this.simulateOutofStockRaceCondition = false;

    // Deep copy sample catalog
    for (const p of SAMPLE_CATALOG) {
      this.products.set(p.id, JSON.parse(JSON.stringify(p)));
    }
  }

  public setCatalog(products: CatalogProduct[]): void {
    this.products.clear();
    for (const p of products) {
      this.products.set(p.id, JSON.parse(JSON.stringify(p)));
    }
  }

  public getProducts(): CatalogProduct[] {
    return Array.from(this.products.values());
  }

  public getProduct(id: number): CatalogProduct | null {
    return this.products.get(id) ?? null;
  }

  public updateProductStock(
    productId: number,
    variationId: number | null,
    quantity: number,
    status: "instock" | "outofstock" | "onbackorder",
  ): void {
    const product = this.products.get(productId);
    if (!product) return;

    if (variationId) {
      const v = product.variations.find(
        (varItem) => varItem.id === variationId,
      );
      if (v) {
        v.stock_quantity = quantity;
        v.stock_status = status;
      }
    } else {
      product.stock_quantity = quantity;
      product.stock_status = status;
    }
  }

  public updateProductPrice(productId: number, price: number): void {
    const product = this.products.get(productId);
    if (product) {
      product.price = price;
      for (const v of product.variations) {
        v.price = price;
      }
    }
  }

  public checkStock(
    productId: number,
    variationId: number | null,
    requestedQty: number = 1,
  ): StockCheckResult {
    const product = this.products.get(productId);
    if (!product) {
      return {
        available: false,
        availableQuantity: 0,
        unitPrice: 0,
        errorReason: "Product not found",
      };
    }

    if (variationId) {
      const variation = product.variations.find((v) => v.id === variationId);
      if (!variation) {
        return {
          available: false,
          availableQuantity: 0,
          unitPrice: product.price,
          errorReason: "Variation not found",
        };
      }

      if (
        variation.stock_status === "outofstock" ||
        (variation.stock_quantity !== null && variation.stock_quantity < 1)
      ) {
        return {
          available: false,
          availableQuantity: 0,
          unitPrice: variation.price,
          errorReason: "Out of stock",
        };
      }

      if (
        variation.stock_quantity !== null &&
        requestedQty > variation.stock_quantity
      ) {
        return {
          available: false,
          availableQuantity: variation.stock_quantity,
          unitPrice: variation.price,
          errorReason: `Only ${variation.stock_quantity} item(s) in stock`,
        };
      }

      return {
        available: true,
        availableQuantity: variation.stock_quantity,
        unitPrice: variation.price,
      };
    }

    // Simple product or parent stock check
    if (product.backorders_allowed) {
      return {
        available: true,
        availableQuantity: product.stock_quantity ?? 0,
        unitPrice: product.price,
        backordered: true,
      };
    }

    if (
      product.stock_status === "outofstock" ||
      (product.stock_quantity !== null && product.stock_quantity < 1)
    ) {
      return {
        available: false,
        availableQuantity: 0,
        unitPrice: product.price,
        errorReason: "Out of stock",
      };
    }

    if (
      product.stock_quantity !== null &&
      requestedQty > product.stock_quantity
    ) {
      return {
        available: false,
        availableQuantity: product.stock_quantity,
        unitPrice: product.price,
        errorReason: `Only ${product.stock_quantity} item(s) in stock`,
      };
    }

    return {
      available: true,
      availableQuantity: product.stock_quantity,
      unitPrice: product.price,
    };
  }

  public validateCoupon(
    code: string,
    subtotal: number,
  ): { valid: boolean; discountAmount: number; description?: string } {
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode === "WELCOME10" || cleanCode === "SAVE10") {
      const discount = Math.round(subtotal * 0.1 * 100) / 100;
      return { valid: true, discountAmount: discount, description: "10% off" };
    }
    if (cleanCode === "SAVE50") {
      return {
        valid: true,
        discountAmount: Math.min(50, subtotal),
        description: "৳50 off",
      };
    }
    if (cleanCode === "BIGDISCOUNT500") {
      return {
        valid: true,
        discountAmount: Math.min(500, subtotal),
        description: "৳500 off",
      };
    }
    return { valid: false, discountAmount: 0, description: "Invalid coupon" };
  }

  public createOrder(payload: any): RecordedWooCommerceOrder {
    if (this.simulateOutofStockRaceCondition) {
      throw new Error(
        "woocommerce_rest_out_of_stock: Product became out of stock during checkout",
      );
    }

    const orderId = payload.customOrderId ?? this.nextOrderId++;
    const lineItems = (payload.line_items || []).map((item: any) => ({
      product_id: Number(item.product_id),
      variation_id: item.variation_id ? Number(item.variation_id) : undefined,
      quantity: Number(item.quantity || 1),
      price: Number(item.price || item.unitPrice || 0),
      name: item.name,
    }));

    // Deduct stock for ordered items
    for (const item of lineItems) {
      const product = this.products.get(item.product_id);
      if (product) {
        if (item.variation_id) {
          const v = product.variations.find(
            (varItem) => varItem.id === item.variation_id,
          );
          if (v && v.stock_quantity !== null) {
            v.stock_quantity = Math.max(0, v.stock_quantity - item.quantity);
            if (v.stock_quantity === 0) v.stock_status = "outofstock";
          }
        } else if (product.stock_quantity !== null) {
          product.stock_quantity = Math.max(
            0,
            product.stock_quantity - item.quantity,
          );
          if (product.stock_quantity === 0) product.stock_status = "outofstock";
        }
      }
    }

    const order: RecordedWooCommerceOrder = {
      id: orderId,
      paymentMethod: payload.payment_method || payload.paymentMethod || "cod",
      billing: {
        first_name: payload.billing?.first_name || payload.customerName || "",
        phone: payload.billing?.phone || payload.phoneNumber || "",
        address_1: payload.billing?.address_1 || payload.deliveryAddress || "",
        city: payload.billing?.city || payload.city || "Dhaka",
      },
      shipping: {
        first_name: payload.shipping?.first_name || payload.customerName || "",
        phone: payload.shipping?.phone || payload.phoneNumber || "",
        address_1: payload.shipping?.address_1 || payload.deliveryAddress || "",
        city: payload.shipping?.city || payload.city || "Dhaka",
      },
      line_items: lineItems,
      shipping_lines: payload.shipping_lines || [
        {
          method_id: payload.shippingMethodId || "flat_rate",
          method_title: payload.shippingMethodTitle || "Standard Delivery",
          total: String(
            payload.deliveryFee !== undefined
              ? Number(payload.deliveryFee).toFixed(2)
              : "60.00",
          ),
        },
      ],
      customer_note: payload.customer_note || payload.notes || "",
      status: payload.status || "processing",
      total: String(
        payload.total !== undefined ? Number(payload.total).toFixed(2) : "0.00",
      ),
      meta_data: payload.meta_data || [],
    };

    this.orders.set(orderId, order);
    return order;
  }

  public updateOrder(
    orderId: number,
    update: Partial<RecordedWooCommerceOrder>,
  ): RecordedWooCommerceOrder | null {
    const existing = this.orders.get(orderId);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...update,
    };
    if (update.customer_note && existing.customer_note) {
      updated.customer_note = `${existing.customer_note}\n${update.customer_note}`;
    }
    this.orders.set(orderId, updated);
    return updated;
  }

  public getOrders(): RecordedWooCommerceOrder[] {
    return Array.from(this.orders.values());
  }

  public getOrder(id: number): RecordedWooCommerceOrder | null {
    return this.orders.get(id) ?? null;
  }

  public getLastOrder(): RecordedWooCommerceOrder | null {
    const all = this.getOrders();
    return all.length > 0 ? all[all.length - 1] : null;
  }
}
