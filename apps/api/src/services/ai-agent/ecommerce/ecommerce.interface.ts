/**
 * Unified E-Commerce Platform Abstraction Layer
 * Provides uniform contracts for WooCommerce, Shopify, and future multi-platform connectors.
 */

export type FetchFn = (
  input: RequestInfo | URL | string,
  init?: RequestInit,
) => Promise<Response>;

export interface UnifiedProductAttribute {
  id?: number;
  name: string;
  options: string[];
  variation?: boolean;
}

export interface UnifiedProductVariation {
  id: string;
  sku: string;
  price: number;
  regularPrice?: number;
  salePrice?: number;
  inStock: boolean;
  stockQuantity: number | null;
  manageStock?: boolean;
  backordersAllowed?: boolean;
  attributes: Record<string, string>; // e.g. { "Size": "XL", "Color": "Black" }
  image?: string;
}

export interface UnifiedProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  regularPrice: number;
  salePrice?: number;
  description: string;
  shortDescription?: string;
  images: string[];
  inStock: boolean;
  stockQuantity: number | null;
  manageStock?: boolean;
  backordersAllowed?: boolean;
  status?: string;
  purchasable?: boolean;
  type?: string; // "simple" | "variable" | "grouped" | "external"
  categories?: Array<{ id: number | string; name: string; slug?: string }>;
  attributes: Array<{
    id?: number;
    name: string;
    options: string[];
    variation?: boolean;
  }>;
  variations: UnifiedProductVariation[];
}

export interface StockCheckItem {
  productId: string;
  variationId?: string;
  quantity: number;
}

export interface StockItemValidation {
  productId: string;
  variationId?: string;
  available: boolean;
  availableQuantity: number | null;
  unitPrice: number;
  reason?: string;
}

export interface StockValidationResult {
  available: boolean;
  items: StockItemValidation[];
  totalPrice?: number;
  errorReason?: string;
}

export interface StockCheckResult {
  available: boolean;
  availableQuantity: number | null;
  unitPrice: number;
  errorReason?: string;
}

export interface OrderBookingItem {
  productId: string;
  variationId?: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderBookingPayload {
  customerName: string;
  phoneNumber: string; // 11 digits BD
  deliveryAddress: string;
  deliveryZone: "inside_dhaka" | "sub_dhaka" | "outside_dhaka";
  items: OrderBookingItem[];
  deliveryFee: number;
  discountAmount?: number;
  paymentMethod: "cod" | "bkash" | "nagad";
  notes?: string;
  conversationId?: string;
  customerJid?: string;
}

export interface OrderBookingResult {
  success: boolean;
  orderId: string;
  orderTotal: number;
  status: string;
  error?: string;
  rawOrder?: unknown;
}

export interface InStockAlternative {
  variation: UnifiedProductVariation;
  matchType:
    | "same_color_different_size"
    | "same_size_different_color"
    | "available_option";
  label: string;
}

export interface ECommercePlatformAdapter {
  readonly platform: "woocommerce" | "shopify";
  syncProducts(modifiedAfter?: Date): Promise<UnifiedProduct[]>;
  checkStock(
    items: Array<{ productId: string; variationId?: string; quantity: number }>,
  ): Promise<StockValidationResult>;
  createOrder(payload: OrderBookingPayload): Promise<OrderBookingResult>;
  getProduct?(id: string): Promise<UnifiedProduct | null>;
}
