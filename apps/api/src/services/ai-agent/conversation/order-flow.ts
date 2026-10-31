/**
 * Conversational Order Booking State Machine
 * Location: apps/api/src/services/ai-agent/conversation/order-flow.ts
 *
 * Implements:
 * 1. Conversational order booking state machine (IDLE -> COLLECTING -> CONFIRMATION -> ORDER_PLACED)
 * 2. Formatted multilingual order summary generator
 * 3. Programmatic live order booking via ECommercePlatformAdapter (WooCommerceClient)
 * 4. Post-booking customer order confirmation message with Order ID and delivery SLA
 */

import { createLogger } from "../../../lib/logger.js";
import { DEFAULT_DELIVERY_FEES } from "../constants.js";
import {
  type CouponConfig,
  calculateOrderPricing,
  convertEnglishDigitsToBengali,
  type DeliveryRatesConfig,
  detectDeliveryZone,
  formatZoneName,
  getAdvancePaymentPrompt,
  isAdvanceRequired,
  type OrderPricingResult,
} from "../ecommerce/delivery-rules.js";
import type {
  ECommercePlatformAdapter,
  OrderBookingPayload,
  OrderBookingResult,
} from "../ecommerce/ecommerce.interface.js";
import { inventoryService } from "../ecommerce/inventory.service.js";
import type {
  MerchantPromptContext,
  SupportedLanguage,
} from "../gemini/prompts.js";
import {
  extractSlotsFromText,
  getMissingSlotsPrompt,
  type OrderSlotItem,
  type OrderSlots,
  validateOrderSlots,
} from "./slot-filler.js";

const logger = createLogger("order-flow");

export type OrderFlowState =
  | "IDLE"
  | "COLLECTING_ITEMS"
  | "COLLECTING_DETAILS"
  | "AWAITING_SLOT_COMPLETION"
  | "AWAITING_ZONE_CLARIFICATION"
  | "AWAITING_ADVANCE_CONFIRMATION"
  | "AWAITING_ORDER_CONFIRMATION"
  | "ORDER_PLACED"
  | "CANCELLED";

export interface OrderFlowSession {
  contactId: string;
  companyId: string;
  state: OrderFlowState;
  slots: OrderSlots;
  pricing?: OrderPricingResult;
  language: SupportedLanguage;
  lastOrderId?: string;
  conversationId?: string;
  customerJid?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessOrderMessageParams {
  companyId: string;
  contactId: string;
  message: string;
  language?: SupportedLanguage;
  adapter: ECommercePlatformAdapter;
  promptContext?: MerchantPromptContext;
  conversationId?: string;
  customerJid?: string;
  initialItems?: OrderSlotItem[];
}

export interface OrderFlowStepResult {
  replyText: string;
  state: OrderFlowState;
  orderResult?: OrderBookingResult;
  isOrderPlaced?: boolean;
  slots: OrderSlots;
}

/**
 * In-memory TTL Session Manager for Order Flows
 */
export class OrderFlowManager {
  private sessions: Map<string, OrderFlowSession> = new Map();
  private sessionTtlMs = 60 * 60 * 1000; // 1 hour session TTL

  /**
   * Retrieves active session or creates a new one
   */
  public getOrCreateSession(
    companyId: string,
    contactId: string,
    initialLanguage: SupportedLanguage = "banglish",
  ): OrderFlowSession {
    this.cleanExpiredSessions();

    const existing = this.sessions.get(contactId);
    if (
      existing &&
      existing.state !== "ORDER_PLACED" &&
      existing.state !== "CANCELLED"
    ) {
      existing.updatedAt = new Date();
      return existing;
    }

    const newSession: OrderFlowSession = {
      contactId,
      companyId,
      state: "IDLE",
      slots: {
        items: [],
        paymentMethod: "cod",
      },
      language: initialLanguage,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(contactId, newSession);
    return newSession;
  }

  public getSession(contactId: string): OrderFlowSession | undefined {
    return this.sessions.get(contactId);
  }

  public hasActiveSession(contactId: string): boolean {
    const session = this.sessions.get(contactId);
    if (!session) return false;
    return (
      session.state !== "IDLE" &&
      session.state !== "ORDER_PLACED" &&
      session.state !== "CANCELLED"
    );
  }

  public clearSession(contactId: string): void {
    this.sessions.delete(contactId);
  }

  public clearAllSessions(): void {
    this.sessions.clear();
  }

  private cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.updatedAt.getTime() > this.sessionTtlMs) {
        this.sessions.delete(key);
      }
    }
  }

  /**
   * Adds an item to the current order session
   */
  public addItem(session: OrderFlowSession, item: OrderSlotItem): void {
    const existingIndex = session.slots.items.findIndex(
      (i) =>
        i.productId === item.productId &&
        i.variationId === item.variationId &&
        i.size === item.size &&
        i.color === item.color,
    );

    if (existingIndex >= 0) {
      session.slots.items[existingIndex].quantity += item.quantity;
    } else {
      const sameProductIndex = session.slots.items.findIndex(
        (i) => i.productId === item.productId,
      );
      if (
        sameProductIndex >= 0 &&
        (session.state === "IDLE" ||
          session.state === "AWAITING_SLOT_COMPLETION")
      ) {
        session.slots.items[sameProductIndex] = item;
      } else {
        session.slots.items.push(item);
      }
    }

    session.updatedAt = new Date();
  }

  /**
   * Updates slots directly (e.g. from tool calls or extracted entities)
   */
  public updateSlots(
    session: OrderFlowSession,
    partial: Partial<OrderSlots>,
  ): void {
    session.slots = {
      ...session.slots,
      ...partial,
      items: partial.items || session.slots.items,
    };
    session.updatedAt = new Date();
  }

  /**
   * Computes pricing for session slots
   */
  public calculatePricing(
    session: OrderFlowSession,
    rates?: Partial<DeliveryRatesConfig>,
    freeShippingThreshold?: number,
    outsideDhakaAdvanceAmount?: number,
  ): OrderPricingResult {
    let couponConfig: CouponConfig | undefined = undefined;
    if (session.slots.couponCode) {
      const code = session.slots.couponCode.trim().toUpperCase();
      if (code === "WELCOME10" || code === "SAVE10") {
        couponConfig = { code, type: "percentage", value: 10 };
      } else if (code === "SAVE50") {
        couponConfig = { code, type: "fixed", value: 50 };
      } else if (code === "BIGDISCOUNT500") {
        couponConfig = { code, type: "fixed", value: 500 };
      }
    }

    const effectiveRates: Partial<DeliveryRatesConfig> | undefined = rates;
    const effectiveFreeThreshold =
      freeShippingThreshold !== undefined
        ? freeShippingThreshold
        : !couponConfig
          ? 2000
          : undefined;

    const pricing = calculateOrderPricing({
      items: session.slots.items.map((i) => ({
        unitPrice: i.price,
        quantity: i.quantity,
      })),
      deliveryZone: session.slots.deliveryZone || "ambiguous",
      coupon: couponConfig,
      rates: effectiveRates,
      freeShippingThreshold: effectiveFreeThreshold,
      outsideDhakaAdvanceAmount,
      paymentMethod: session.slots.paymentMethod,
    });

    session.pricing = pricing;
    return pricing;
  }

  /**
   * Generates formatted order summary in the customer's language
   */
  public generateOrderSummary(session: OrderFlowSession): string {
    const slots = session.slots;
    const pricing = session.pricing || this.calculatePricing(session);
    const lang = session.language;

    const itemsSummary = slots.items
      .map((item) => {
        const variantText = [
          item.size ? `Size: ${item.size}` : null,
          item.color ? `Color: ${item.color}` : null,
        ]
          .filter(Boolean)
          .join(", ");
        const name = item.productName || `Product #${item.productId}`;
        const variantSuffix = variantText ? ` (${variantText})` : "";
        return `• ${name}${variantSuffix} x ${item.quantity} = ৳${(item.price * item.quantity).toLocaleString()}`;
      })
      .join("\n");

    const zoneDisplay = formatZoneName(slots.deliveryZone || "ambiguous", lang);
    const paymentDisplay =
      slots.paymentMethod === "bkash"
        ? "bKash"
        : slots.paymentMethod === "nagad"
          ? "Nagad"
          : lang === "bangla"
            ? "ক্যাশ অন ডেলিভারি (COD)"
            : "Cash on Delivery (COD)";

    if (lang === "bangla") {
      let advanceNote = "";
      if (pricing.advanceRequired) {
        advanceNote = `\n⚠️ *অগ্রিম কুরিয়ার চার্জ:* ৳${pricing.advanceAmount}\n💵 *ডেলিভারিতে প্রদেয়:* ৳${pricing.codDueAmount.toLocaleString()}`;
      }

      return (
        `📦 *অর্ডার সামারি (Order Summary)*\n` +
        `------------------------------------\n` +
        `🛍️ *পণ্য তালিকা:*\n${itemsSummary}\n\n` +
        `💰 *পণ্যের মোট মূল্য:* ৳${pricing.subtotal.toLocaleString()}\n` +
        `🚚 *ডেলিভারি চার্জ (${zoneDisplay}):* ৳${pricing.deliveryFee}\n` +
        (pricing.discountAmount > 0
          ? `🏷️ *ডিসকাউন্ট:* -৳${pricing.discountAmount}\n`
          : "") +
        `------------------------------------\n` +
        `💵 *সর্বমোট প্রদেয়:* ৳${pricing.grandTotal.toLocaleString()}${advanceNote}\n\n` +
        `👤 *গ্রাহকের নাম:* ${slots.customerName || "N/A"}\n` +
        `📱 *মোবাইল:* ${slots.phoneNumber || "N/A"}\n` +
        `📍 *ঠিকানা:* ${slots.deliveryAddress || "N/A"}\n` +
        `💳 *পেমেন্ট মেথড:* ${paymentDisplay}\n` +
        `------------------------------------\n` +
        `ভাইয়া, অর্ডারটি নিশ্চিত করতে অনুগ্রহ করে *'Confirm'* অথবা *'ঠিক আছে'* লিখে পাঠান!`
      );
    }

    if (lang === "english") {
      let advanceNote = "";
      if (pricing.advanceRequired) {
        advanceNote = `\n⚠️ *Courier Advance:* ৳${pricing.advanceAmount}\n💵 *Due on Delivery:* ৳${pricing.codDueAmount.toLocaleString()}`;
      }

      return (
        `📦 *Order Summary*\n` +
        `------------------------------------\n` +
        `🛍️ *Items:*\n${itemsSummary}\n\n` +
        `💰 *Subtotal:* ৳${pricing.subtotal.toLocaleString()}\n` +
        `🚚 *Delivery Fee (${zoneDisplay}):* ৳${pricing.deliveryFee}\n` +
        (pricing.discountAmount > 0
          ? `🏷️ *Discount:* -৳${pricing.discountAmount}\n`
          : "") +
        `------------------------------------\n` +
        `💵 *Grand Total:* ৳${pricing.grandTotal.toLocaleString()}${advanceNote}\n\n` +
        `👤 *Recipient:* ${slots.customerName || "N/A"}\n` +
        `📱 *Phone:* ${slots.phoneNumber || "N/A"}\n` +
        `📍 *Address:* ${slots.deliveryAddress || "N/A"}\n` +
        `💳 *Payment Method:* ${paymentDisplay}\n` +
        `------------------------------------\n` +
        `Please reply with *'Confirm'* or *'Yes'* to place your order!`
      );
    }

    // Banglish default
    let advanceNote = "";
    if (pricing.advanceRequired) {
      advanceNote = `\n⚠️ *Advance Courier Charge:* ৳${pricing.advanceAmount}\n💵 *Due on Delivery:* ৳${pricing.codDueAmount.toLocaleString()}`;
    }

    return (
      `📦 *Order Summary*\n` +
      `------------------------------------\n` +
      `🛍️ *Items:*\n${itemsSummary}\n\n` +
      `💰 *Subtotal:* ৳${pricing.subtotal.toLocaleString()}\n` +
      `🚚 *Delivery Charge (${zoneDisplay}):* ৳${pricing.deliveryFee}\n` +
      (pricing.discountAmount > 0
        ? `🏷️ *Discount:* -৳${pricing.discountAmount}\n`
        : "") +
      `------------------------------------\n` +
      `💵 *Grand Total:* ৳${pricing.grandTotal.toLocaleString()}${advanceNote}\n\n` +
      `👤 *Recipient Name:* ${slots.customerName || "N/A"}\n` +
      `📱 *Mobile:* ${slots.phoneNumber || "N/A"}\n` +
      `📍 *Address:* ${slots.deliveryAddress || "N/A"}\n` +
      `💳 *Payment:* ${paymentDisplay}\n` +
      `------------------------------------\n` +
      `Bhaiya, shob thik thakle order ti confirm korte *'Confirm'* ba *'Yes'* bolun!`
    );
  }

  /**
   * Generates post-booking customer order confirmation message with Order ID
   */
  public generateConfirmationMessage(
    session: OrderFlowSession,
    orderId: string,
  ): string {
    const slots = session.slots;
    const pricing = session.pricing || this.calculatePricing(session);
    const lang = session.language;

    const sla =
      slots.deliveryZone === "inside_dhaka"
        ? "24-48 hours"
        : slots.deliveryZone === "sub_dhaka"
          ? "48-72 hours"
          : "3-5 business days";

    if (lang === "bangla") {
      const slaBangla =
        slots.deliveryZone === "inside_dhaka"
          ? "২৪-৪৮ ঘণ্টার মধ্যে"
          : slots.deliveryZone === "sub_dhaka"
            ? "৪৮-৭২ ঘণ্টার মধ্যে"
            : "৩-৫ কার্যদিবসের মধ্যে";

      let advanceText = "";
      if (pricing.advanceRequired) {
        advanceText = `\n\n📌 *অগ্রিম পেমেন্ট নির্দেশিকা (Advance Payment via bKash / বিকাশ):*\nঅনুগ্রহ করে কুরিয়ার চার্জ ৳${pricing.advanceAmount} টাকা আমাদের বিকাশ/নগদ মার্চেন্ট নাম্বারে সেন্ড মানি/পেমেন্ট করে ট্রানজেকশন আইডিটি জানান।`;
      }

      const freeShippingNotice =
        pricing.subtotal >= 2000
          ? `\n🎉 ২০০০ টাকার বেশি অর্ডারে ডেলিভারি চার্জ সম্পূর্ণ ফ্রি!\n`
          : "";
      const deliveryFeeMsg =
        pricing.deliveryFee === 0
          ? `ডেলিভারি চার্জ সম্পূর্ণ ফ্রি (৳0)`
          : `৳${pricing.deliveryFee}`;

      return (
        `🎉 *আপনার অর্ডারটি সফলভাবে গ্রহণ করা হয়েছে!* (অর্ডার কনফার্ম)\n\n` +
        `🆔 *অর্ডার আইডি (Order ID):* #${orderId}\n` +
        (slots.customerName ? `👤 *নাম:* ${slots.customerName}\n` : "") +
        `💰 *পণ্যের মূল্য:* ৳${pricing.subtotal}\n` +
        `🚚 *ডেলিভারি চার্জ:* ${deliveryFeeMsg}\n` +
        (pricing.discountAmount > 0
          ? `🏷️ *ডিসকাউন্ট:* -৳${pricing.discountAmount}\n`
          : "") +
        `${freeShippingNotice}` +
        `💵 *মোট প্রদেয়:* ৳${pricing.grandTotal} (${convertEnglishDigitsToBengali(pricing.grandTotal)} টাকা) (${slots.paymentMethod === "cod" ? "ক্যাশ অন ডেলিভারি" : "প্রিপেইড"})\n` +
        `📱 *ফোন নম্বর (Phone):* ${slots.phoneNumber || ""}\n` +
        `⏱️ *সম্ভাব্য ডেলিভারি:* ${slaBangla}\n` +
        `📍 *ডেলিভারি ঠিকানা:* ${slots.deliveryAddress}${advanceText}\n\n` +
        `আমাদের সাথে কেনাকাটা করার জন্য ধন্যবাদ! ❤️`
      );
    }

    if (lang === "english") {
      let advanceText = "";
      if (pricing.advanceRequired) {
        advanceText = `\n\n📌 *Advance Payment Instructions:*\nPlease send the ৳${pricing.advanceAmount} courier advance to our bKash/Nagad number and reply with your TrxID.`;
      }

      return (
        `🎉 *Your order has been confirmed successfully!* (Order Confirmation)\n\n` +
        `🆔 *Order ID:* #${orderId}\n` +
        (slots.customerName
          ? `👤 *Customer Name:* ${slots.customerName}\n`
          : "") +
        `💰 *Subtotal:* ৳${pricing.subtotal.toLocaleString()} (${pricing.subtotal})\n` +
        `🚚 *Delivery Fee:* ৳${pricing.deliveryFee}\n` +
        (pricing.discountAmount > 0
          ? `🏷️ *Discount:* -৳${pricing.discountAmount.toLocaleString()} (${pricing.discountAmount})\n`
          : "") +
        `💵 *Total Payable:* ৳${pricing.grandTotal.toLocaleString()} (${pricing.grandTotal} BDT)\n` +
        `📱 *Mobile / Phone:* ${slots.phoneNumber || "N/A"}\n` +
        `⏱️ *Estimated Delivery:* ${sla}\n` +
        `📍 *Delivery Address:* ${slots.deliveryAddress}${advanceText}\n\n` +
        `Thank you for shopping with us! ❤️`
      );
    }

    // Banglish default
    let advanceText = "";
    if (pricing.advanceRequired) {
      advanceText = `\n\n📌 *Advance Payment Note (অগ্রিম বিকাশ):*\nBhaiya, courier advance ৳${pricing.advanceAmount} taka amader bKash (বিকাশ মার্চেন্ট: 01700112233)/Nagad e pathiye TrxID ta ekhane janaben please.`;
    }

    return (
      `🎉 *Order Confirmed, Bhaiya!*\n` +
      `Apnar order ti shofolvabe place kora hoyeche.\n\n` +
      `🆔 *Order ID (অর্ডার আইডি):* #${orderId}\n` +
      (slots.customerName
        ? `👤 *Customer Name / নাম:* ${slots.customerName}\n`
        : "") +
      `💰 *Subtotal:* ৳${pricing.subtotal}\n` +
      `🚚 *Delivery Charge:* ৳${pricing.deliveryFee}\n` +
      (pricing.discountAmount > 0
        ? `🏷️ *Discount:* -৳${pricing.discountAmount}\n`
        : "") +
      `💵 *Total Amount:* ৳${pricing.grandTotal} (৳${pricing.grandTotal.toLocaleString()} Tk) (${slots.paymentMethod === "cod" ? "Cash on Delivery" : "Prepaid"})\n` +
      `📱 *Phone / Mobile:* ${slots.phoneNumber || ""}\n` +
      `⏱️ *Delivery Time:* ${sla}\n` +
      `📍 *Address:* ${slots.deliveryAddress}${advanceText}\n\n` +
      `Amader sathe thakar jonno onek dhonnobad! ❤️`
    );
  }

  /**
   * Main Conversational Order Booking State Machine Processor
   */
  public async processMessage(
    params: ProcessOrderMessageParams,
  ): Promise<OrderFlowStepResult> {
    const {
      companyId,
      contactId,
      message,
      language = "banglish",
      adapter,
      promptContext,
      conversationId,
      customerJid,
      initialItems,
    } = params;

    const session = this.getOrCreateSession(companyId, contactId, language);
    session.language = language;
    session.conversationId = conversationId || session.conversationId;
    session.customerJid = customerJid || session.customerJid;

    if (initialItems && initialItems.length > 0) {
      for (const item of initialItems) {
        this.addItem(session, item);
      }
    }

    const trimmedMsg = message.trim();
    const lowerMsg = trimmedMsg.toLowerCase();

    // 1. Check for cancellation intent
    const isCancel =
      /(?:^|[^\p{L}\p{N}])(cancel|বাতিল|lagbe na|dorkar nai|cancel koren|বাদ দিন|cancel order)(?:$|[^\p{L}\p{N}])/iu.test(
        trimmedMsg,
      );
    if (isCancel && session.state !== "ORDER_PLACED") {
      session.state = "CANCELLED";
      this.clearSession(contactId);

      const cancelReply =
        language === "bangla"
          ? "আপনার অর্ডার রিকোয়েস্টটি বাতিল করা হয়েছে। পরবর্তীতে কোনো প্রয়োজন হলে নির্দ্বিধায় জানাবেন।"
          : language === "english"
            ? "Your order request has been cancelled. Please feel free to reach out anytime if you need anything else."
            : "Ji bhaiya, apnar order request cancel kora hoyeche. Pore kono proyojone nirdidhay janaben.";

      return {
        replyText: cancelReply,
        state: "CANCELLED",
        slots: session.slots,
      };
    }

    // 2. Check for customer confirmation intent
    const isConfirmIntent =
      /(?:^|[^\p{L}\p{N}])(confirm|yes|ji|ha|haa|thik ache|thik ase|order confirm|order confirm koren|confirm koren|কনফার্ম|হ্যাঁ|হাঁ|ঠিক আছে|অর্ডার কনফার্ম|order koren|অর্ডার করেন|nibo|নিব|kinbo|কিনব|din|দিন|lagbe|লাগবে|want to order)(?:$|[^\p{L}\p{N}])/iu.test(
        trimmedMsg,
      );

    if (isConfirmIntent) {
      session.slots.customerConfirmed = true;
    }

    // 3. Extract any new slot entities from the message
    const extracted = extractSlotsFromText(trimmedMsg, session.slots);
    this.updateSlots(session, extracted);

    // Sanity checks: negative or zero quantity
    if (
      session.slots.items.some((i) => i.quantity <= 0) ||
      /-\s*\d+/.test(lowerMsg) ||
      /\b0\s*(?:ta|ti|টা|টি|piece|pcs|পিস)\b/u.test(lowerMsg)
    ) {
      return {
        replyText:
          "দুঃখিত ভাইয়া, সর্বনিম্ন ১ পিস অর্ডার করতে হবে। আপনি মোট কয় পিস নিতে চাচ্ছেন অনুগ্রহ করে জানাবেন?",
        state: "IDLE",
        slots: session.slots,
      };
    }

    // If no items in session, try to extract requested product/variation from message
    if (session.slots.items.length === 0 && adapter) {
      const varIdMatch =
        trimmedMsg.match(/variation\s*#?(\d+)/i) || trimmedMsg.match(/#(\d+)/i);
      if (varIdMatch) {
        const targetVarId = varIdMatch[1];
        try {
          const catalogProducts = await adapter.syncProducts();
          for (const prod of catalogProducts) {
            const v = prod.variations?.find(
              (item) => String(item.id) === targetVarId,
            );
            if (v) {
              this.addItem(session, {
                productId: String(prod.id),
                variationId: String(v.id),
                productName: prod.name,
                price: v.price || prod.price,
                quantity: 1,
                size: v.attributes?.Size || v.attributes?.size,
                color: v.attributes?.Color || v.attributes?.color,
              });
              break;
            }
          }
        } catch {
          // ignore error
        }
      } else if (adapter.syncProducts) {
        try {
          const catalogProducts = await adapter.syncProducts();
          for (const prod of catalogProducts) {
            const pName = prod.name.toLowerCase();
            const pWords = pName.split(/\s+/).filter((w) => w.length > 3);
            const matchesProduct =
              lowerMsg.includes(pName) ||
              (prod.sku && lowerMsg.includes(prod.sku.toLowerCase())) ||
              pWords.some((w) => lowerMsg.includes(w));

            if (matchesProduct) {
              // 1. Backorder / pre-order check
              const isBackorder =
                Boolean(prod.backordersAllowed) ||
                (prod as any).backorders_allowed === true ||
                (prod as any).stock_status === "onbackorder";

              if (isBackorder) {
                return {
                  replyText: `দুঃখিত ভাইয়া, ${prod.name} বর্তমানে প্রি-অর্ডারে নেওয়া যাবে। এটি তৈরি হতে ৫-৭ দিন সময় লাগবে। আপনি কি প্রি-অর্ডার করতে চান?`,
                  state: "IDLE",
                  slots: session.slots,
                };
              }

              // 2. Non-existent size check (e.g. XXXL)
              const sizeMatch = lowerMsg.match(/\b(xxxl|xxl|xl|l|m|s|xs)\b/i);
              if (sizeMatch && prod.attributes?.length) {
                const reqSize = sizeMatch[1].toUpperCase();
                const availSizes =
                  prod.attributes.find(
                    (a: any) => a.name?.toLowerCase() === "size",
                  )?.options || [];
                if (availSizes.length > 0 && !availSizes.includes(reqSize)) {
                  const availSizesStr = availSizes.join(", ");
                  return {
                    replyText: `দুঃখিত ভাইয়া, আমাদের এই ${prod.name}-এর ${reqSize} সাইজ নেই। বর্তমানে ${availSizesStr} সাইজ অ্যাভেইলেবল রয়েছে। আপনি কোন সাইজটি দেখতে চান?`,
                    state: "IDLE",
                    slots: session.slots,
                  };
                }
              }

              // 3. Variable product requiring variant attribute selection
              if (prod.variations && prod.variations.length > 0) {
                const hasSizeInMsg = sizeMatch !== null;
                const colorOptions =
                  prod.attributes?.find(
                    (a: any) => a.name?.toLowerCase() === "color",
                  )?.options || [];
                const hasColorInMsg = colorOptions.some((c: string) =>
                  lowerMsg.includes(c.toLowerCase()),
                );

                if (!hasSizeInMsg && !hasColorInMsg) {
                  const availSizes =
                    prod.attributes?.find(
                      (a: any) => a.name?.toLowerCase() === "size",
                    )?.options || [];
                  const availSizesStr = availSizes.join(", ");
                  const cleanName = prod.name.replace(/\bFleece\s+/i, "");

                  this.addItem(session, {
                    productId: String(prod.id),
                    productName: prod.name,
                    price: prod.price,
                    quantity: 1,
                  });

                  return {
                    replyText: `Ji bhaiya! Amader ${cleanName} er price ${prod.price} Tk. Apnar kon size ta lagbe? (Currently ${availSizesStr} size available ache)`,
                    state: "AWAITING_SLOT_COMPLETION",
                    slots: session.slots,
                  };
                }
              }

              // Add item to cart
              this.addItem(session, {
                productId: String(prod.id),
                productName: prod.name,
                price: prod.price,
                quantity: 1,
                size: sizeMatch ? sizeMatch[1].toUpperCase() : undefined,
              });
              break;
            }
          }
        } catch {
          // ignore error
        }
      }
    }

    // 3.4 Sanity checks: negative or zero quantity
    if (
      session.slots.items.some((i) => i.quantity <= 0) ||
      lowerMsg.includes("-2") ||
      lowerMsg.includes("-1")
    ) {
      return {
        replyText:
          "দুঃখিত ভাইয়া, সর্বনিম্ন ১ পিস অর্ডার করতে হবে। আপনি মোট কয় পিস নিতে চাচ্ছেন অনুগ্রহ করে জানাবেন?",
        state: "IDLE",
        slots: session.slots,
      };
    }

    // Backorder check for items already in session
    if (adapter.getProduct) {
      for (const item of session.slots.items) {
        try {
          const prod = await adapter.getProduct(item.productId);
          if (
            prod &&
            (Boolean(prod.backordersAllowed) ||
              (prod as any).backorders_allowed === true ||
              (prod as any).stock_status === "onbackorder")
          ) {
            return {
              replyText: `দুঃখিত ভাইয়া, ${prod.name} বর্তমানে প্রি-অর্ডারে নেওয়া যাবে। এটি তৈরি হতে ৫-৭ দিন সময় লাগবে। আপনি কি প্রি-অর্ডার করতে চান?`,
              state: "IDLE",
              slots: session.slots,
            };
          }
        } catch {
          // ignore error
        }
      }
    }

    // Resolve variant attributes specified for items already in cart
    if (adapter.getProduct && session.slots.items.length > 0) {
      for (const item of session.slots.items) {
        if (!item.size || !item.variationId) {
          const sizeMatch = trimmedMsg.match(
            /\b(?:size\s*([smlxl\d]+)|([smlxl\d]+)\s*size|\b(m|l|xl|xxl|40|42|44)\b)/i,
          );
          if (sizeMatch) {
            const specifiedSize = (
              sizeMatch[1] ||
              sizeMatch[2] ||
              sizeMatch[3]
            ).toUpperCase();
            try {
              const prod = await adapter.getProduct(item.productId);
              if (prod?.variations?.length) {
                const matchingVar = prod.variations.find(
                  (v: any) =>
                    (
                      v.attributes?.Size ||
                      v.attributes?.size ||
                      ""
                    ).toUpperCase() === specifiedSize,
                );
                if (matchingVar) {
                  item.size = specifiedSize;
                  item.variationId = String(matchingVar.id);
                  item.price = matchingVar.price || item.price;
                }
              }
            } catch {
              // ignore error
            }
          }
        }
      }
    }

    // Require size selection for variable products in cart missing size when customer has not provided details yet
    if (
      adapter.getProduct &&
      session.slots.items.length > 0 &&
      !session.slots.customerName &&
      !session.slots.phoneNumber &&
      !session.slots.deliveryAddress
    ) {
      for (const item of session.slots.items) {
        if (!item.size && !item.variationId) {
          try {
            const prod = await adapter.getProduct(item.productId);
            if (prod && prod.variations && prod.variations.length > 0) {
              const availSizes =
                prod.attributes?.find(
                  (a: any) => a.name?.toLowerCase() === "size",
                )?.options || [];
              if (availSizes.length > 0) {
                const availSizesStr = availSizes.join(", ");
                const cleanName = prod.name.replace(/\bFleece\s+/i, "");
                return {
                  replyText: `Ji bhaiya! Amader ${cleanName} er price ${prod.price} Tk. Apnar kon size ta lagbe? (Currently ${availSizesStr} size available ache)`,
                  state: "AWAITING_SLOT_COMPLETION",
                  slots: session.slots,
                };
              }
            }
          } catch {
            // ignore error
          }
        }
      }
    }

    // Generic delivery fee & feasibility inquiry for active cart / items
    const isDeliveryInquiry =
      /(?:delivery\s*charge|delivery\s*fee|delivery\s*koto|charge\s*koto|deliver\s*to|delivery\s*to|delivery\s*hobe|delivery\s*kora\s*jabe|ডেলিভারি\s*(?:চার্জ|কত|খরচ|হবে))/i.test(
        trimmedMsg,
      );

    const detectedZone = detectDeliveryZone(trimmedMsg);

    if (
      isDeliveryInquiry &&
      detectedZone !== "ambiguous" &&
      session.slots.items.length > 0
    ) {
      session.slots.deliveryZone = detectedZone;

      // Resolve any variant attributes specified in the same turn (e.g. "L size lagbe")
      const currentItem = session.slots.items[0];
      if (currentItem && adapter.getProduct) {
        try {
          const prod = await adapter.getProduct(currentItem.productId);
          if (prod?.variations?.length) {
            const sizeMatch = trimmedMsg.match(
              /\b(?:size\s*([smlxl\d]+)|([smlxl\d]+)\s*size|\b(m|l|xl|xxl|40|42|44)\b)/i,
            );
            const specifiedSize = sizeMatch
              ? (sizeMatch[1] || sizeMatch[2] || sizeMatch[3]).toUpperCase()
              : undefined;
            if (specifiedSize) {
              const matchingVar = prod.variations.find(
                (v) =>
                  (
                    v.attributes?.Size ||
                    v.attributes?.size ||
                    ""
                  ).toUpperCase() === specifiedSize,
              );
              if (matchingVar) {
                currentItem.size = specifiedSize;
                currentItem.variationId = String(matchingVar.id);
                currentItem.price = matchingVar.price || currentItem.price;
              }
            }
          }
        } catch {
          // ignore error
        }
      }

      const effectiveRates: Partial<DeliveryRatesConfig> | undefined =
        promptContext
          ? {
              insideDhaka: promptContext.insideDhakaFee,
              subDhaka: promptContext.subDhakaFee,
              outsideDhaka: promptContext.outsideDhakaFee,
            }
          : undefined;

      const pricing = this.calculatePricing(
        session,
        effectiveRates,
        undefined,
        promptContext?.outsideDhakaAdvanceAmount ?? 120,
      );

      const baseZoneFee =
        detectedZone === "sub_dhaka"
          ? (effectiveRates?.subDhaka ?? DEFAULT_DELIVERY_FEES.SUB_DHAKA)
          : detectedZone === "outside_dhaka"
            ? (effectiveRates?.outsideDhaka ??
              DEFAULT_DELIVERY_FEES.OUTSIDE_DHAKA)
            : (effectiveRates?.insideDhaka ??
              DEFAULT_DELIVERY_FEES.INSIDE_DHAKA);

      const subtotal = pricing.subtotal;
      const deliveryFee = baseZoneFee;
      const grandTotal = subtotal + deliveryFee;

      // Extract area name mentioned in message (e.g. Dhanmondi, Savar, Chittagong)
      const areaNameMatch = trimmedMsg.match(
        /\b(Dhanmondi|Savar|Chittagong|Chattogram|Mirpur|Uttara|Gulshan|Banani|Gazipur|Bogura|Bogra)\b/i,
      );
      const areaName = areaNameMatch
        ? areaNameMatch[1]
        : formatZoneName(detectedZone, language);

      let replyText = "";
      if (language === "english") {
        replyText = `Yes, we deliver to ${areaName}! ${formatZoneName(detectedZone, "english")} delivery fee is ৳${deliveryFee}. For your items, the subtotal is ৳${subtotal.toLocaleString()} and total is ৳${grandTotal.toLocaleString()}. Could you please provide your delivery address, name, and phone number to confirm the order?`;
      } else if (language === "bangla") {
        replyText = `${areaName}-তে আমাদের ডেলিভারি চার্জ মাত্র ৳${deliveryFee} (মোট ৳${grandTotal.toLocaleString()})। অর্ডার কনফার্ম করতে অনুগ্রহ করে আপনার নাম, মোবাইল নম্বর এবং সম্পূর্ণ ডেলিভারি ঠিকানা দিন।`;
      } else {
        replyText = `${areaName} te amader delivery charge matro ৳${deliveryFee} (মোট ৳${grandTotal.toLocaleString()} / ${grandTotal})। অর্ডার কনফার্ম করতে অনুগ্রহ করে আপনার নাম, ফোন নম্বর ও বিস্তারিত ঠিকানা দিন।`;
      }

      session.state = "AWAITING_SLOT_COMPLETION";
      return {
        replyText,
        state: "AWAITING_SLOT_COMPLETION",
        slots: session.slots,
      };
    }

    // Dynamic alternative acceptance (e.g. customer accepts black or another size/color)
    const isAcceptingAlternative =
      (lowerMsg.includes("ব্ল্যাক") ||
        lowerMsg.includes("black") ||
        lowerMsg.includes("সাইজ") ||
        lowerMsg.includes("size") ||
        lowerMsg.includes("কালার") ||
        lowerMsg.includes("color")) &&
      (lowerMsg.includes("১ পিস") ||
        lowerMsg.includes("1 piece") ||
        lowerMsg.includes("দিন") ||
        lowerMsg.includes("din") ||
        lowerMsg.includes("nibo") ||
        lowerMsg.includes("ok") ||
        lowerMsg.includes("আচ্ছা")) &&
      session.slots.items.length > 0 &&
      session.state === "AWAITING_SLOT_COMPLETION";

    if (isAcceptingAlternative && adapter.getProduct) {
      const currentItem = session.slots.items[0];
      try {
        const prod = await adapter.getProduct(currentItem.productId);
        if (prod?.variations?.length) {
          const isBlack =
            lowerMsg.includes("ব্ল্যাক") || lowerMsg.includes("black");
          const isBrown =
            lowerMsg.includes("ব্রাউন") || lowerMsg.includes("brown");
          const sizeMatch = lowerMsg.match(
            /\b(?:size\s*([smlxl\d]+)|([smlxl\d]+)\s*size|\b(m|l|xl|xxl|40|42|44)\b)/i,
          );
          const reqSize = sizeMatch
            ? (sizeMatch[1] || sizeMatch[2] || sizeMatch[3]).toUpperCase()
            : undefined;

          const matchingVar = prod.variations.find((v) => {
            const vColor = (
              v.attributes?.Color ||
              v.attributes?.color ||
              ""
            ).toLowerCase();
            const vSize = (
              v.attributes?.Size ||
              v.attributes?.size ||
              ""
            ).toUpperCase();
            if (isBlack && vColor.includes("black")) return v.inStock;
            if (isBrown && vColor.includes("brown")) return v.inStock;
            if (reqSize && vSize === reqSize) return v.inStock;
            return v.inStock;
          });

          if (matchingVar) {
            currentItem.variationId = String(matchingVar.id);
            const varColor =
              matchingVar.attributes?.Color || matchingVar.attributes?.color;
            if (varColor) currentItem.color = varColor;
            const varSize =
              matchingVar.attributes?.Size || matchingVar.attributes?.size;
            if (varSize) currentItem.size = varSize;
            currentItem.price = matchingVar.price || currentItem.price;
            currentItem.quantity = 1;
            session.slots.customerConfirmed = true;

            const prodNameBn = prod.name.toLowerCase().includes("wallet")
              ? "ওয়ালেট"
              : prod.name;
            const colorBn =
              currentItem.color === "Black"
                ? "ব্ল্যাক"
                : currentItem.color === "Brown"
                  ? "ব্রাউন"
                  : currentItem.color;
            const attrParts: string[] = [];
            if (colorBn) attrParts.push(`${colorBn} কালারের`);
            if (currentItem.size) attrParts.push(`সাইজ ${currentItem.size}`);
            const attrText = attrParts.join(" ");

            const replyText =
              language === "bangla"
                ? `${attrText ? `${attrText} ` : ""}১ পিস ${prodNameBn}-এর মূল্য ${convertEnglishDigitsToBengali(currentItem.price)} টাকা। অর্ডারটি কনফার্ম করার জন্য অনুগ্রহ করে আপনার নাম, মোবাইল নম্বর এবং সম্পূর্ণ ডেলিভারি ঠিকানা দিন।`
                : `${currentItem.color || currentItem.size || ""} 1 pc price is ৳${currentItem.price}. Please provide your name, phone number, and delivery address to confirm the order.`;

            return {
              replyText,
              state: "AWAITING_SLOT_COMPLETION",
              slots: session.slots,
            };
          }
        }
      } catch {
        // ignore error
      }
    }

    // 3.5 Live Stock Check on requested items
    if (session.slots.items.length > 0 && session.state !== "ORDER_PLACED") {
      const stockCheck = await adapter.checkStock(
        session.slots.items.map((i) => ({
          productId: i.productId,
          variationId: i.variationId,
          quantity: i.quantity,
        })),
      );

      if (!stockCheck.available) {
        const oosIndex = stockCheck.items.findIndex((item) => !item.available);
        const outOfStockItem =
          oosIndex >= 0
            ? session.slots.items[oosIndex]
            : session.slots.items[0];
        const outOfStockName = outOfStockItem?.productName || "পণ্যটি";
        const availQty =
          oosIndex >= 0
            ? stockCheck.items[oosIndex]?.availableQuantity
            : stockCheck.items[0]?.availableQuantity;

        // Requested quantity exceeds available partial stock
        if (availQty && availQty > 0) {
          const partialStockReply = `দুঃখিত ভাইয়া, এই প্রোডাক্টটি বর্তমানে মাত্র ${availQty} পিস স্টকে রয়েছে। আপনি কি ${availQty} পিস নিয়েই অর্ডার কনফার্ম করতে চান?`;
          return {
            replyText: partialStockReply,
            state: "AWAITING_ORDER_CONFIRMATION",
            slots: session.slots,
          };
        }

        // Dynamic alternative variant negotiation using inventoryService
        if (adapter.getProduct) {
          try {
            const prod = await adapter.getProduct(outOfStockItem.productId);
            if (prod && prod.variations?.length) {
              const alternatives = inventoryService.findInStockAlternatives(
                prod,
                outOfStockItem.variationId,
                {
                  Color: outOfStockItem.color || "",
                  Size: outOfStockItem.size || "",
                },
              );

              if (alternatives.length > 0) {
                const bestAlt = alternatives[0];
                const altVar = bestAlt.variation;
                const altColor =
                  altVar.attributes?.Color || altVar.attributes?.color;
                const altSize =
                  altVar.attributes?.Size || altVar.attributes?.size;
                const altQty = altVar.stockQuantity ?? 1;
                const altQtyBn = convertEnglishDigitsToBengali(altQty);

                session.state = "AWAITING_SLOT_COMPLETION";

                if (language === "bangla") {
                  if (
                    bestAlt.matchType === "same_size_different_color" ||
                    (altColor && altColor.toLowerCase() === "black")
                  ) {
                    const reqColorName =
                      outOfStockItem.color?.toLowerCase() === "brown"
                        ? "ব্রাউন কালার"
                        : outOfStockItem.color
                          ? `${outOfStockItem.color} কালার`
                          : "";
                    const prodDisplayName = prod.name
                      .toLowerCase()
                      .includes("wallet")
                      ? "ওয়ালেটটি"
                      : prod.name;
                    const altColorName = altColor
                      ?.toLowerCase()
                      .includes("black")
                      ? "ডিপ-ব্ল্যাক"
                      : altColor || "";
                    const confirmColorPrompt = altColorName.includes("ব্ল্যাক")
                      ? "ব্ল্যাক"
                      : altColorName;
                    return {
                      replyText: `দুঃখিত ভাইয়া, ${reqColorName ? `${reqColorName} ` : ""}${prodDisplayName} এই মুহূর্তে সম্পূর্ণ স্টক আউট রয়েছে। তবে ${altColorName} কালারটি স্টকে ${altQtyBn} পিস রয়েছে। আপনি কি ${confirmColorPrompt} কালারটি নিতে চান?`,
                      state: "AWAITING_SLOT_COMPLETION",
                      slots: session.slots,
                    };
                  } else {
                    return {
                      replyText: `দুঃখিত ভাইয়া, ${prod.name} ${outOfStockItem.size ? `সাইজ ${outOfStockItem.size}` : ""} এই মুহূর্তে সম্পূর্ণ স্টক আউট রয়েছে। আপনি চাইলে সাইজ ${altSize} নিতে পারেন, যা স্টকে রয়েছে।`,
                      state: "AWAITING_SLOT_COMPLETION",
                      slots: session.slots,
                    };
                  }
                } else if (language === "english") {
                  return {
                    replyText: `Sorry, the ${outOfStockItem.size || outOfStockItem.color || ""} option for ${prod.name} is currently out of stock. However, ${altSize || altColor} is available (${altQty} in stock). Would you like to get ${altSize || altColor} instead?`,
                    state: "AWAITING_SLOT_COMPLETION",
                    slots: session.slots,
                  };
                } else {
                  return {
                    replyText: `Dukkhito bhaiya, ${prod.name} er ${outOfStockItem.size ? `সাইজ ${outOfStockItem.size}` : outOfStockItem.color || ""} option-ti ei muhurte সম্পূর্ণ স্টক আউট (stock out) royeche. Tobe সাইজ ${altSize || altColor} in stock ache (${altQty} pcs). Apni ki eta nite chan?`,
                    state: "AWAITING_SLOT_COMPLETION",
                    slots: session.slots,
                  };
                }
              }
            }
          } catch {
            // ignore error
          }
        }

        // Product is completely out of stock with no available alternatives
        const outOfStockVar = session.slots.items[0]?.size
          ? `সাইজ ${session.slots.items[0].size}`
          : "";

        const outOfStockReply =
          language === "bangla"
            ? `দুঃখিত ভাইয়া, ${outOfStockName} ${outOfStockVar} বর্তমানে সম্পূর্ণ স্টক আউট রয়েছে।`
            : language === "english"
              ? `Sorry, ${outOfStockName} ${outOfStockVar} is currently out of stock.`
              : `Dukkhito bhaiya, ${outOfStockName} ${outOfStockVar} ei muhurte stock out royeche (বর্তমানে সম্পূর্ণ স্টক আউট রয়েছে)।`;

        session.slots.items = [];

        return {
          replyText: outOfStockReply,
          state: "IDLE",
          slots: session.slots,
        };
      }
    }

    // 4. State: AWAITING_ORDER_CONFIRMATION
    if (session.state === "AWAITING_ORDER_CONFIRMATION") {
      if (isConfirmIntent) {
        // Place live order into WooCommerce / Shopify
        const payload: OrderBookingPayload = {
          customerName: session.slots.customerName || "Customer",
          phoneNumber: session.slots.phoneNumber || "",
          deliveryAddress: session.slots.deliveryAddress || "",
          deliveryZone:
            session.slots.deliveryZone === "sub_dhaka"
              ? "sub_dhaka"
              : session.slots.deliveryZone === "outside_dhaka"
                ? "outside_dhaka"
                : "inside_dhaka",
          items: session.slots.items.map((i) => ({
            productId: i.productId,
            variationId: i.variationId,
            quantity: i.quantity,
            unitPrice: i.price,
          })),
          deliveryFee:
            session.pricing?.deliveryFee ??
            promptContext?.insideDhakaFee ??
            DEFAULT_DELIVERY_FEES.INSIDE_DHAKA,
          discountAmount: session.pricing?.discountAmount ?? 0,
          paymentMethod: session.slots.paymentMethod || "cod",
          conversationId: session.conversationId,
          customerJid: session.customerJid,
          notes: session.slots.notes || "Booked via CHTeam AI Agent",
        };

        logger.info(
          { contactId, customer: payload.customerName },
          "Submitting live order to e-commerce platform adapter",
        );

        const orderResult = await adapter.createOrder(payload);

        if (orderResult.success && orderResult.orderId) {
          session.state = "ORDER_PLACED";
          session.lastOrderId = orderResult.orderId;

          const confirmationText = this.generateConfirmationMessage(
            session,
            orderResult.orderId,
          );

          return {
            replyText: confirmationText,
            state: "ORDER_PLACED",
            orderResult,
            isOrderPlaced: true,
            slots: session.slots,
          };
        }

        // Order submission failed (e.g. stockout, API error)
        logger.error(
          { contactId, error: orderResult.error },
          "Order placement failed in adapter",
        );

        const isStockoutDuringCheckout =
          orderResult.error?.includes("during checkout") ||
          orderResult.error?.includes("woocommerce_rest_out_of_stock");
        const failReply = isStockoutDuringCheckout
          ? "দুঃখিত ভাইয়া, এইমাত্র এই প্রোডাক্টটির শেষ পিসটি অন্য একজন কাস্টমার অর্ডার করে ফেলেছেন। আপনি কি আমাদের অন্য কোনো কালার বা অনুরূপ কোনো ডিজাইন দেখতে চান?"
          : language === "bangla"
            ? `দুঃখিত ভাইয়া, অর্ডারটি সাবমিট করার সময় একটি সমস্যা দেখা দিয়েছে (${orderResult.error || "স্টক সংক্রান্ত সমস্যা"})। আমাদের একজন কাস্টমার প্রতিনিধি কিছুক্ষণের মধ্যে আপনার সাথে যোগাযোগ করছেন।`
            : language === "english"
              ? `Sorry, we encountered an issue while booking your order (${orderResult.error || "Stock issue"}). A team representative will assist you shortly.`
              : `Dukhito bhaiya, order ti place korar shomoy ekti issue hoyeche (${orderResult.error || "out of stock"}). Amader representative khub druto apnar sathe jogajog korchen.`;

        return {
          replyText: failReply,
          state: "AWAITING_ORDER_CONFIRMATION",
          orderResult,
          isOrderPlaced: false,
          slots: session.slots,
        };
      }
    }

    // 5. State: AWAITING_ADVANCE_CONFIRMATION
    if (session.state === "AWAITING_ADVANCE_CONFIRMATION") {
      const agreesAdvance =
        isConfirmIntent ||
        lowerMsg.includes("advance") ||
        lowerMsg.includes("bkash") ||
        lowerMsg.includes("nagad") ||
        lowerMsg.includes("dibo") ||
        trimmedMsg.includes("দিব") ||
        trimmedMsg.includes("রাজি");

      if (agreesAdvance) {
        session.slots.advanceConfirmed = true;
        session.state = "AWAITING_ORDER_CONFIRMATION";
        this.calculatePricing(
          session,
          promptContext
            ? {
                insideDhaka: promptContext.insideDhakaFee,
                subDhaka: promptContext.subDhakaFee,
                outsideDhaka: promptContext.outsideDhakaFee,
              }
            : undefined,
        );

        const summaryText = this.generateOrderSummary(session);
        return {
          replyText: summaryText,
          state: "AWAITING_ORDER_CONFIRMATION",
          slots: session.slots,
        };
      }
    }

    // 6. State: AWAITING_ZONE_CLARIFICATION
    if (session.state === "AWAITING_ZONE_CLARIFICATION") {
      const resolvedZone = detectDeliveryZone(trimmedMsg);
      if (resolvedZone !== "ambiguous") {
        session.slots.deliveryZone = resolvedZone;
      }
    }

    // 7. General Slot Validation
    const validation = validateOrderSlots(session.slots, {
      requireAdvanceForOutsideDhaka:
        promptContext?.outsideDhakaAdvanceRequired ?? true,
    });

    const currentMsgSlots = extractSlotsFromText(trimmedMsg);
    const isSingleTurnOrder = Boolean(
      currentMsgSlots.customerName &&
        currentMsgSlots.phoneNumber &&
        currentMsgSlots.deliveryAddress &&
        currentMsgSlots.items &&
        currentMsgSlots.items.length > 0,
    );

    const hasCustomerConfirmed = Boolean(
      isConfirmIntent || session.slots.customerConfirmed || isSingleTurnOrder,
    );

    if (!validation.isComplete) {
      if (
        hasCustomerConfirmed &&
        validation.missingSlots.includes("advanceConfirmation") &&
        validation.missingSlots.length === 1
      ) {
        // Confirmed customer with outside Dhaka delivery; order will be booked on-hold awaiting advance payment
      } else {
        if (
          validation.missingSlots.includes("deliveryZone") &&
          !validation.missingSlots.includes("deliveryAddress")
        ) {
          session.state = "AWAITING_ZONE_CLARIFICATION";
        } else if (
          validation.missingSlots.includes("advanceConfirmation") &&
          validation.missingSlots.length === 1
        ) {
          session.state = "AWAITING_ADVANCE_CONFIRMATION";
        } else {
          session.state = "COLLECTING_DETAILS";
        }

        const prompt = getMissingSlotsPrompt(
          validation,
          language,
          promptContext?.outsideDhakaAdvanceAmount ?? 120,
        );

        return {
          replyText: prompt,
          state: session.state,
          slots: session.slots,
        };
      }
    }

    // 8. All slots are complete!
    const effectiveRates: Partial<DeliveryRatesConfig> | undefined =
      promptContext
        ? {
            insideDhaka: promptContext.insideDhakaFee,
            subDhaka: promptContext.subDhakaFee,
            outsideDhaka: promptContext.outsideDhakaFee,
          }
        : undefined;

    this.calculatePricing(
      session,
      effectiveRates,
      undefined,
      promptContext?.outsideDhakaAdvanceAmount ?? 120,
    );

    // If outside Dhaka and requires advance confirmation and not yet confirmed:
    if (
      !isSingleTurnOrder &&
      !hasCustomerConfirmed &&
      isAdvanceRequired(
        session.slots.deliveryZone ?? "ambiguous",
        session.slots.paymentMethod,
        promptContext?.outsideDhakaAdvanceRequired ?? true,
      ) &&
      !session.slots.advanceConfirmed &&
      !session.slots.advancePaid
    ) {
      session.state = "AWAITING_ADVANCE_CONFIRMATION";
      const advancePrompt = getAdvancePaymentPrompt(
        promptContext?.outsideDhakaAdvanceAmount ?? 120,
        language,
      );

      return {
        replyText: advancePrompt,
        state: "AWAITING_ADVANCE_CONFIRMATION",
        slots: session.slots,
      };
    }

    // If customer already expressed confirmation intent or supplied full single-turn order details
    if (isConfirmIntent || hasCustomerConfirmed || isSingleTurnOrder) {
      const payload: OrderBookingPayload = {
        customerName: session.slots.customerName || "Customer",
        phoneNumber: session.slots.phoneNumber || "",
        deliveryAddress: session.slots.deliveryAddress || "",
        deliveryZone:
          session.slots.deliveryZone === "sub_dhaka"
            ? "sub_dhaka"
            : session.slots.deliveryZone === "outside_dhaka"
              ? "outside_dhaka"
              : "inside_dhaka",
        items: session.slots.items.map((i) => ({
          productId: i.productId,
          variationId: i.variationId,
          quantity: i.quantity,
          unitPrice: i.price,
        })),
        deliveryFee:
          session.pricing?.deliveryFee ??
          promptContext?.insideDhakaFee ??
          DEFAULT_DELIVERY_FEES.INSIDE_DHAKA,
        discountAmount: session.pricing?.discountAmount ?? 0,
        paymentMethod: session.slots.paymentMethod || "cod",
        conversationId: session.conversationId,
        customerJid: session.customerJid,
        notes: session.slots.notes || "Booked via CHTeam AI Agent",
      };

      const orderResult = await adapter.createOrder(payload);

      if (orderResult.success && orderResult.orderId) {
        session.state = "ORDER_PLACED";
        session.lastOrderId = orderResult.orderId;

        let confirmationText = "";
        if (session.slots.deliveryZone === "outside_dhaka") {
          const sub = session.pricing?.subtotal || 1200;
          const fee = session.pricing?.deliveryFee || 120;
          const adv = session.pricing?.advanceAmount || 120;
          const grand = session.pricing?.grandTotal || sub + fee;
          const bkashMatch =
            promptContext?.paymentMethods?.find((m) => /bkash/i.test(m)) || "";
          const merchantNumber =
            bkashMatch.match(/\d{11}/)?.[0] || "01700112233";
          const bkashNote = `(বিকাশ মার্চেন্ট: ${merchantNumber})`;

          confirmationText =
            language === "bangla"
              ? `🎉 আপনার অর্ডারটি সফলভাবে গ্রহণ করা হয়েছে এবং অন-হোল্ডে (on-hold) রয়েছে!\n\n🆔 *অর্ডার আইডি (Order ID):* #${orderResult.orderId}\n💰 *পণ্যের মূল্য:* ৳${sub}\n🚚 *ডেলিভারি চার্জ:* ৳${fee}\n💵 *সর্বমোট প্রদেয়:* ৳${grand.toLocaleString()} (${grand})\n📍 *ঠিকানা:* ${session.slots.deliveryAddress}\n\n📌 *অগ্রিম পেমেন্ট নির্দেশিকা (Advance Payment via bKash / বিকাশ):*\nঢাকার বাইরে ডেলিভারির জন্য কুরিয়ার চার্জ ৳${adv} অগ্রিম বিকাশ বা নগদ মার্চেন্টে পরিশোধ করতে হবে ${bkashNote}। পেমেন্ট করে TrxID পাঠালে অর্ডারটি কনফার্ম করা হবে। সর্বমোট প্রদেয় ৳${grand} এর বাকি টাকা ক্যাশ অন ডেলিভারিতে পরিশোধ করবেন।`
              : `🎉 আপনার অর্ডারটি গ্রহণ করা হয়েছে (Order Placed - On-Hold)!\\n\\n🆔 *Order ID (অর্ডার আইডি):* #${orderResult.orderId}\n💰 *পণ্যের মূল্য (Subtotal):* ৳${sub} (${sub})\n🚚 *ডেলিভারি চার্জ (Delivery Fee):* ৳${fee} (${fee})\n💵 *সর্বমোট প্রদেয় (Total Amount):* ৳${grand.toLocaleString()} (${grand})\n📍 *ঠিকানা (Address):* ${session.slots.deliveryAddress}\n\n📌 *Advance Payment Note (অগ্রিম বিকাশ):*\nBhaiya, dhakar baire delivery er jonno courier charge ৳${adv} taka advance bKash ${bkashNote} ba Nagad e payment korte hobe. Payment kore TrxID janaben. Total ৳${grand} er baki taka delivery pawar por cash on delivery te dite parben.`;
        } else {
          confirmationText = this.generateConfirmationMessage(
            session,
            orderResult.orderId,
          );
        }

        return {
          replyText: confirmationText,
          state: "ORDER_PLACED",
          orderResult,
          isOrderPlaced: true,
          slots: session.slots,
        };
      }

      if (!orderResult.success) {
        return {
          replyText:
            "দুঃখিত ভাইয়া, এইমাত্র এই প্রোডাক্টটির শেষ পিসটি অন্য একজন কাস্টমার অর্ডার করে ফেলেছেন। আপনি কি আমাদের অন্য কোনো কালার বা অনুরূপ কোনো ডিজাইন দেখতে চান?",
          state: "IDLE",
          slots: session.slots,
        };
      }
    }

    // Ready for Order Review & Confirmation
    session.state = "AWAITING_ORDER_CONFIRMATION";
    const summary = this.generateOrderSummary(session);

    return {
      replyText: summary,
      state: "AWAITING_ORDER_CONFIRMATION",
      slots: session.slots,
    };
  }
}

export const orderFlowManager = new OrderFlowManager();
