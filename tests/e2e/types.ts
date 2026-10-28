/**
 * OmniTeam WATeamInbox E2E Testing Suite (Feature 25)
 * Scenario definitions, input types, and assertion contracts.
 */

export interface CustomerMessageInput {
  senderPhone: string; // e.g. "8801711223344"
  senderName?: string;
  text?: string;
  media?: {
    mimeType: string;
    base64Data: string;
    fileName?: string;
  };
  timestamp?: number;
}

export interface OutboundMessageRecord {
  recipientJid: string;
  text: string;
  mediaUrl?: string;
  timestamp: Date;
}

export interface RecordedWooCommerceOrder {
  id: number;
  paymentMethod: string;
  billing: {
    first_name: string;
    phone: string;
    address_1: string;
    city: string;
  };
  shipping: {
    first_name: string;
    phone: string;
    address_1: string;
    city: string;
  };
  line_items: Array<{
    product_id: number;
    variation_id?: number;
    quantity: number;
    price?: number;
    name?: string;
  }>;
  shipping_lines: Array<{
    method_id: string;
    method_title: string;
    total: string;
  }>;
  customer_note?: string;
  status: string;
  total: string;
  meta_data: Array<{ key: string; value: string }>;
}

export type DeliveryZone =
  | "inside_dhaka"
  | "sub_dhaka"
  | "outside_dhaka"
  | "ambiguous";

export interface ProductVariation {
  id: number;
  sku: string;
  price: number;
  regular_price: number;
  sale_price?: number;
  stock_quantity: number | null;
  stock_status: "instock" | "outofstock" | "onbackorder";
  attributes: Record<string, string>; // e.g. { "Size": "L", "Color": "Black" }
}

export interface CatalogProduct {
  id: number;
  name: string;
  sku: string;
  price: number;
  regular_price: number;
  sale_price?: number;
  description: string;
  categories: string[];
  images: string[];
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: "instock" | "outofstock" | "onbackorder";
  backorders_allowed?: boolean;
  attributes: Array<{ name: string; options: string[] }>;
  variations: ProductVariation[];
}

export interface StockCheckResult {
  available: boolean;
  availableQuantity: number | null;
  unitPrice: number;
  errorReason?: string;
  backordered?: boolean;
}

export interface E2ETestStep {
  step: number;
  description: string;
  customerAction?: CustomerMessageInput;
  agentAction?: {
    type: "manual_send" | "assign" | "pause" | "resume";
    agentId: string;
    text?: string;
    phone?: string;
  };
  setupAction?: (harness: any) => void | Promise<void>;
  expectations: {
    agentShouldReply: boolean;
    replyMustContain?: string[];
    replyMustNotContain?: string[];
    replyPattern?: RegExp;
    languageDetected?: "bangla" | "banglish" | "english" | "code_mixed";
    tagsExpected?: {
      mustInclude?: string[];
      mustNotInclude?: string[];
    };
    orderExpected?: {
      created: boolean;
      deliveryZone?: "inside_dhaka" | "sub_dhaka" | "outside_dhaka";
      deliveryFee?: number;
      total?: number;
      status?: string;
      orderId?: number;
      lineItemCount?: number;
    };
    realtimeEventExpected?: {
      type: string;
      payloadCheck?: (payload: any) => boolean;
    };
  };
}

export interface E2ETestCase {
  id: string; // e.g. "T1-R1-01"
  name: string;
  tier: 1 | 2 | 3 | 4 | 5;
  feature: "R1" | "R2" | "R3" | "R4" | "R5" | "CROSS";
  description: string;
  steps: E2ETestStep[];
}
