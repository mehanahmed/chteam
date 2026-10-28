/**
 * Empirical Adversarial Challenger Test Suite
 * Location: tests/e2e/challenger2-adversarial.test.ts
 *
 * Verifies:
 * 1. Language Mirroring Protocol adherence across Bengali script, Banglish, and English without test-case hardcoding.
 * 2. 11-digit BD phone number extraction, normalization, and operator validation under edge-case formulations.
 * 3. Delivery zone classification (Inside Dhaka, Sub-Dhaka, Outside Dhaka, Ambiguous) under stress.
 * 4. Coupon code validation, discount limits, and mathematical pricing accuracy.
 * 5. Dynamic multi-turn order flow without hardcoded test shortcuts or e2e environment checks.
 *
 * EMPIRICAL CHALLENGER 2 FINDINGS DEMONSTRATED IN THIS SUITE:
 * - Bug 1: Language detection misclassifies common Banglish location inquiries ("apnader showroom kothay?") as English.
 * - Bug 2: Phone number extraction captures words like "number", "hocche", "ditechi" instead of the 11-digit number.
 * - Bug 3: Customer name extraction fails when conversational prefixes ("আমার নাম:", "Amar nam:") have colons.
 * - Bug 4: Order confirmation and cancellation in Bengali script ("কনফার্ম", "বাতিল") fail due to ASCII \b word boundary.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { orderFlowManager } from "../../apps/api/src/services/ai-agent/conversation/order-flow.js";
import {
  extractSlotsFromText,
  normalizeBdPhoneNumber,
} from "../../apps/api/src/services/ai-agent/conversation/slot-filler.js";
import {
  calculateOrderPricing,
  detectDeliveryZone,
} from "../../apps/api/src/services/ai-agent/ecommerce/delivery-rules.js";
import type {
  ECommercePlatformAdapter,
  OrderBookingPayload,
  OrderBookingResult,
  UnifiedProduct,
} from "../../apps/api/src/services/ai-agent/ecommerce/ecommerce.interface.js";
import {
  buildSystemPrompt,
  detectCustomerLanguage,
} from "../../apps/api/src/services/ai-agent/gemini/prompts.js";
import { HermeticGeminiModelMock } from "./harness/mock-gemini.js";

// Mock Adapter for arbitrary products
export function createMockAdapter(
  products: UnifiedProduct[] = [],
): ECommercePlatformAdapter {
  return {
    platform: "woocommerce",
    syncProducts: async () => products,
    getProduct: async (id: string) => products.find((p) => p.id === id) || null,
    checkStock: async (items) => {
      const results = items.map((i) => {
        const prod = products.find((p) => p.id === i.productId);
        if (!prod || !prod.inStock) {
          return {
            productId: i.productId,
            variationId: i.variationId,
            available: false,
            availableQuantity: 0,
            unitPrice: 0,
            errorReason: "Out of stock",
          };
        }
        if (i.variationId && prod.variations) {
          const v = prod.variations.find((vr) => vr.id === i.variationId);
          if (
            !v ||
            !v.inStock ||
            (v.stockQuantity !== null && v.stockQuantity < i.quantity)
          ) {
            return {
              productId: i.productId,
              variationId: i.variationId,
              available: false,
              availableQuantity: v?.stockQuantity ?? 0,
              unitPrice: v?.price || prod.price,
              errorReason: "Variation out of stock",
            };
          }
          return {
            productId: i.productId,
            variationId: i.variationId,
            available: true,
            availableQuantity: v.stockQuantity,
            unitPrice: v.price,
          };
        }
        if (prod.stockQuantity !== null && prod.stockQuantity < i.quantity) {
          return {
            productId: i.productId,
            available: false,
            availableQuantity: prod.stockQuantity,
            unitPrice: prod.price,
            errorReason: "Insufficient quantity",
          };
        }
        return {
          productId: i.productId,
          available: true,
          availableQuantity: prod.stockQuantity,
          unitPrice: prod.price,
        };
      });

      const allAvail = results.every((r) => r.available);
      return {
        available: allAvail,
        items: results,
      };
    },
    createOrder: async (
      payload: OrderBookingPayload,
    ): Promise<OrderBookingResult> => {
      return {
        success: true,
        orderId: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        orderTotal:
          payload.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0) +
          payload.deliveryFee -
          (payload.discountAmount || 0),
        status:
          payload.deliveryZone === "outside_dhaka" ? "on-hold" : "processing",
      };
    },
    updateOrderStatus: async () => true,
  };
}

describe("Empirical Challenger 2 Adversarial Stress Suite", () => {
  beforeEach(() => {
    orderFlowManager.clearAllSessions();
  });

  // =========================================================================
  // 1. Language Mirroring Protocol Verification
  // =========================================================================
  describe("1. Language Mirroring Protocol & Dialect Adherence", () => {
    it("correctly identifies Bengali Script across diverse colloquial formulations", () => {
      const bengaliPhrases = [
        "ভাইয়া এই পাঞ্জাবিটার প্রাইস কত?",
        "ঢাকার বাইরে কি ক্যাশ অন ডেলিভারি দেওয়া যাবে?",
        "আমি ২টি শার্ট নিতে চাচ্ছি, সাইজ এল আছে?",
        "আপনাদের শোরুমের ঠিকানাটা বলবেন প্লিজ?",
        "অর্ডারটি কনফার্ম করে দেন",
        "দাম কত ভাইয়া?",
      ];

      for (const phrase of bengaliPhrases) {
        const detected = detectCustomerLanguage(phrase);
        expect(detected).toBe("bangla");
      }
    });

    it("correctly identifies common Banglish phrases", () => {
      const banglishPhrases = [
        "bhaiya eta ki cotton fabric?",
        "chittagong e delivery charge koto pore?",
        "vai red color er hoodie hobe?",
        "order confirm koren, ami bKash kore dibo",
        "dhanmondi te koto dine delivery pabo?",
        "dam koto vai?",
      ];

      for (const phrase of banglishPhrases) {
        const detected = detectCustomerLanguage(phrase);
        expect(detected).toBe("banglish");
      }
    });

    it("detectCustomerLanguage correctly classifies Banglish location inquiries as Banglish", () => {
      // Inquiries asking for shop/showroom location in Banglish ("apnader showroom kothay?", "apnader dokan kothay?")
      // are accurately classified as "banglish" after adding "kothay", "apnader", "dokan" to BANGLISH_LEXICON.
      const showroomBanglish = "apnader showroom kothay?";
      const dokanBanglish = "apnader dokan kothay?";

      const lang1 = detectCustomerLanguage(showroomBanglish);
      const lang2 = detectCustomerLanguage(dokanBanglish);

      expect(lang1).toBe("banglish");
      expect(lang2).toBe("banglish");
    });

    it("correctly identifies English queries with full sentences and retail questions", () => {
      const englishPhrases = [
        "Hello, what are your business hours?",
        "How much is the delivery charge for Gulshan?",
        "Do you ship outside Dhaka via courier?",
        "Is this jacket available in size XL?",
        "Please confirm my order to Dhanmondi.",
        "Could you tell me the return policy?",
      ];

      for (const phrase of englishPhrases) {
        const detected = detectCustomerLanguage(phrase);
        expect(detected).toBe("english");
      }
    });

    it("HermeticGeminiModelMock mirrors language dynamically without test-case matching", async () => {
      const mock = new HermeticGeminiModelMock();
      const systemInstruction = buildSystemPrompt({
        storeName: "Elite Apparel",
        personaName: "Zara",
        personaTone: "friendly",
        businessHoursText: "Saturday to Thursday, 9:00 AM - 9:00 PM",
        isWithinBusinessHours: true,
        insideDhakaFee: 70,
        subDhakaFee: 110,
        outsideDhakaFee: 140,
        outsideDhakaAdvanceRequired: true,
        outsideDhakaAdvanceAmount: 140,
        paymentMethods: ["Cash on Delivery", "bKash"],
      });

      // 1. Turn in Bengali script -> Reply must contain Bengali script
      const resBangla = await mock.generateContent({
        model: "gemini-2.0-flash",
        contents: "শোরুমের লোকেশন কোথায়?",
        config: { systemInstruction },
      });
      expect(/[\u0980-\u09FF]/.test(resBangla.text)).toBe(true);

      // 2. Turn in English -> Reply must be in English
      const resEnglish = await mock.generateContent({
        model: "gemini-2.0-flash",
        contents: "Where is your showroom located?",
        config: { systemInstruction },
      });
      expect(resEnglish.text.toLowerCase()).toContain("showroom");
      expect(/[\u0980-\u09FF]/.test(resEnglish.text)).toBe(false);

      // 3. Turn in Banglish -> Reply must be in Banglish
      const resBanglish = await mock.generateContent({
        model: "gemini-2.0-flash",
        contents: "vai apnader showroom kothay?",
        config: { systemInstruction },
      });
      expect(resBanglish.text.toLowerCase()).toContain("showroom");
    });
  });

  // =========================================================================
  // 2. 11-digit BD Phone Number Extraction under Edge-Case Formulations
  // =========================================================================
  describe("2. 11-digit BD Phone Number Extraction & Validation Under Edge Cases", () => {
    it("normalizes all valid Bangladeshi operator prefixes (013-019)", () => {
      const validNumbers = [
        "01300112233", // GP
        "01400112233", // Banglalink
        "01500112233", // Teletalk
        "01600112233", // Airtel
        "01700112233", // GP
        "01800112233", // Robi
        "01900112233", // Banglalink
      ];

      for (const num of validNumbers) {
        const res = normalizeBdPhoneNumber(num);
        expect(res.isValid).toBe(true);
        expect(res.normalizedPhone).toBe(num);
      }
    });

    it("rejects unassigned or invalid BD operator prefixes (010, 011, 012)", () => {
      const invalidPrefixes = ["01012345678", "01112345678", "01212345678"];

      for (const num of invalidPrefixes) {
        const res = normalizeBdPhoneNumber(num);
        expect(res.isValid).toBe(false);
        expect(res.error).toContain(
          "Invalid Bangladeshi mobile operator prefix",
        );
      }
    });

    it("normalizes Bengali numerals with prefixes and delimiters", () => {
      const tests = [
        { input: "০১৭১১০০০০০০", expected: "01711000000" },
        { input: "+৮৮০১৭১১০০০০০০", expected: "01711000000" },
        { input: "৮৮০১৮১১০০০০০০", expected: "01811000000" },
        { input: "০১৯১১-০০০০০০", expected: "01911000000" },
        { input: "০১৬১১ ০০০০০০", expected: "01611000000" },
      ];

      for (const t of tests) {
        const res = normalizeBdPhoneNumber(t.input);
        expect(res.isValid).toBe(true);
        expect(res.normalizedPhone).toBe(t.expected);
      }
    });

    it("normalizes complex punctuation, spaces, and international prefixes", () => {
      const tests = [
        { input: "+880 1711-223344", expected: "01711223344" },
        { input: "008801811223344", expected: "01811223344" },
        { input: "8801911223344", expected: "01911223344" },
        { input: "(01711) 22-33-44", expected: "01711223344" },
        { input: "017 11 22 33 44", expected: "01711223344" },
        { input: "1711223344", expected: "01711223344" }, // 10 digits without leading zero
      ];

      for (const t of tests) {
        const res = normalizeBdPhoneNumber(t.input);
        expect(res.isValid).toBe(true);
        expect(res.normalizedPhone).toBe(t.expected);
      }
    });

    it("rejects invalid lengths and malformed inputs", () => {
      const invalidInputs = [
        "0171122334", // 10 digits starting with 01
        "017112233445", // 12 digits
        "01711-ABCDE", // non-digits
        "", // empty
        "   ", // spaces
        "01712", // 5 digits
      ];

      for (const input of invalidInputs) {
        const res = normalizeBdPhoneNumber(input);
        expect(res.isValid).toBe(false);
      }
    });

    it("extractSlotsFromText extracts phone numbers from standard structured sentences", () => {
      const sentences = [
        {
          text: "Phone: 01712-345678",
          expected: "01712345678",
        },
        {
          text: "নাম: আরিফুল ইসলাম, ঠিকানা: ধানমন্ডি ২৭, ঢাকা, ফোন: ০১৭১১০০০০০০",
          expected: "01711000000",
        },
        {
          text: "Please ship to Gulshan 1, House 12, Road 4. Contact: +880 1819 123 456",
          expected: "01819123456",
        },
      ];

      for (const s of sentences) {
        const slots = extractSlotsFromText(s.text);
        expect(slots.phoneNumber).toBe(s.expected);
      }
    });

    it("extractSlotsFromText extracts 11-digit phone number correctly even when connective filler follows phone", () => {
      // When a customer types "Amar phone number holo 01712-345678" or "phone number hocche 01712345678",
      // phone extraction extracts and normalizes the valid 11-digit BD number.
      const slots1 = extractSlotsFromText(
        "Amar phone number holo 01712-345678, eita te call diyen.",
      );
      const slots2 = extractSlotsFromText(
        "Amar phone number hocche 01712345678",
      );

      expect(slots1.phoneNumber).toBe("01712345678");
      expect(slots2.phoneNumber).toBe("01712345678");
    });
  });

  // =========================================================================
  // 3. Delivery Zone Detection Under Edge-Case Formulations
  // =========================================================================
  describe("3. Delivery Zone Detection Precedence & Edge Cases", () => {
    it("ensures Sub-Dhaka takes strict precedence over Dhaka tokens", () => {
      const subDhakaAddresses = [
        "Savar, Dhaka",
        "হেমায়েতপুর, সাভার, ঢাকা",
        "Gazipur Chowrasta, Dhaka",
        "Chashara, Narayanganj, Dhaka",
        "Tongi, Gazipur",
        "Ashulia, Savar",
        "Keraniganj, Dhaka",
      ];

      for (const addr of subDhakaAddresses) {
        const zone = detectDeliveryZone(addr);
        expect(zone).toBe("sub_dhaka");
      }
    });

    it("correctly identifies Inside Dhaka metro neighborhoods", () => {
      const insideDhakaAddresses = [
        "House 12, Road 5, Dhanmondi, Dhaka",
        "Sector 11, Uttara, Dhaka",
        "Gulshan 2, Dhaka 1212",
        "মিরপুর ১০, ঢাকা",
        "মোহাম্মদপুর, ঢাকা",
        "Banasree Block C, Dhaka",
      ];

      for (const addr of insideDhakaAddresses) {
        const zone = detectDeliveryZone(addr);
        expect(zone).toBe("inside_dhaka");
      }
    });

    it("handles the special case of Chittagong Road inside Dhaka", () => {
      const addr = "Chittagong Road, Jatrabari, Dhaka";
      const zone = detectDeliveryZone(addr);
      expect(zone).toBe("inside_dhaka");
    });

    it("correctly identifies Outside Dhaka districts and divisions", () => {
      const outsideDhakaAddresses = [
        "GEC Circle, Chittagong",
        "Zindabazar, Sylhet",
        "Shaheb Bazar, Rajshahi",
        "Satmatha, Bogura",
        "বগুড়া সদর, বগুড়া",
        "Maijdee Court, Noakhali",
        "Cox's Bazar Sadar",
        "Khulna Sadar, Khulna",
      ];

      for (const addr of outsideDhakaAddresses) {
        const zone = detectDeliveryZone(addr);
        expect(zone).toBe("outside_dhaka");
      }
    });

    it("flags ambiguous addresses that lack zone identifiers", () => {
      const ambiguousAddresses = [
        "House 5, Road 2",
        "Station road",
        "Near high school",
        "",
        "Amar basay pathaben",
      ];

      for (const addr of ambiguousAddresses) {
        const zone = detectDeliveryZone(addr);
        expect(zone).toBe("ambiguous");
      }
    });
  });

  // =========================================================================
  // 4. Coupon Validation & Pricing Math
  // =========================================================================
  describe("4. Coupon Validation & Pricing Math", () => {
    it("computes percentage discounts accurately (WELCOME10 / SAVE10)", () => {
      const pricing = calculateOrderPricing({
        items: [{ unitPrice: 1500, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        coupon: { code: "WELCOME10", type: "percentage", value: 10 },
        rates: { insideDhaka: 60 },
      });

      expect(pricing.subtotal).toBe(1500);
      expect(pricing.discountAmount).toBe(150);
      expect(pricing.deliveryFee).toBe(60);
      expect(pricing.grandTotal).toBe(1410); // 1500 - 150 + 60
    });

    it("computes fixed discounts accurately (SAVE50)", () => {
      const pricing = calculateOrderPricing({
        items: [{ unitPrice: 850, quantity: 2 }],
        deliveryZone: "sub_dhaka",
        coupon: { code: "SAVE50", type: "fixed", value: 50 },
        rates: { subDhaka: 100 },
      });

      expect(pricing.subtotal).toBe(1700);
      expect(pricing.discountAmount).toBe(50);
      expect(pricing.deliveryFee).toBe(100);
      expect(pricing.grandTotal).toBe(1750); // 1700 - 50 + 100
    });

    it("caps fixed discount to subtotal to prevent negative totals", () => {
      const pricing = calculateOrderPricing({
        items: [{ unitPrice: 300, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        coupon: { code: "BIGDISCOUNT500", type: "fixed", value: 500 },
        rates: { insideDhaka: 60 },
      });

      expect(pricing.subtotal).toBe(300);
      expect(pricing.discountAmount).toBe(300); // capped at subtotal
      expect(pricing.grandTotal).toBe(60); // 300 - 300 + 60
    });

    it("enforces outside Dhaka advance requirements on COD orders", () => {
      const pricing = calculateOrderPricing({
        items: [{ unitPrice: 1200, quantity: 1 }],
        deliveryZone: "outside_dhaka",
        paymentMethod: "cod",
        requireOutsideDhakaAdvance: true,
        outsideDhakaAdvanceAmount: 120,
        rates: { outsideDhaka: 120 },
      });

      expect(pricing.grandTotal).toBe(1320); // 1200 + 120
      expect(pricing.advanceRequired).toBe(true);
      expect(pricing.advanceAmount).toBe(120);
      expect(pricing.codDueAmount).toBe(1200); // 1320 - 120
    });

    it("waives advance payment requirement when paid via bKash/Nagad", () => {
      const pricing = calculateOrderPricing({
        items: [{ unitPrice: 1200, quantity: 1 }],
        deliveryZone: "outside_dhaka",
        paymentMethod: "bkash",
        requireOutsideDhakaAdvance: true,
        rates: { outsideDhaka: 120 },
      });

      expect(pricing.advanceRequired).toBe(false);
      expect(pricing.advanceAmount).toBe(0);
    });

    it("extractSlotsFromText captures coupon codes case-insensitively", () => {
      const texts = [
        "Use coupon WELCOME10 please",
        "amar kase coupon ache: save50",
        "Discount code: SAVE10",
        "apply bigdiscount500",
      ];

      const expectedCodes = ["WELCOME10", "SAVE50", "SAVE10", "BIGDISCOUNT500"];

      for (let i = 0; i < texts.length; i++) {
        const slots = extractSlotsFromText(texts[i]);
        expect(slots.couponCode).toBe(expectedCodes[i]);
      }
    });
  });

  // =========================================================================
  // 5. Dynamic Multi-Turn Conversational Order Booking State Machine
  // =========================================================================
  describe("5. Dynamic Multi-Turn Order Booking State Machine", () => {
    const testCatalog: UnifiedProduct[] = [
      {
        id: "prod-901",
        name: "Casual Denim Jacket",
        sku: "JAC-901",
        price: 2400,
        regularPrice: 2800,
        description: "Denim jacket",
        images: ["https://example.com/jac.jpg"],
        inStock: true,
        stockQuantity: 10,
        attributes: [{ name: "Size", options: ["M", "L", "XL"] }],
        variations: [
          {
            id: "var-9011",
            sku: "JAC-901-M",
            price: 2400,
            inStock: true,
            stockQuantity: 4,
            attributes: { Size: "M" },
          },
          {
            id: "var-9012",
            sku: "JAC-901-L",
            price: 2400,
            inStock: true,
            stockQuantity: 4,
            attributes: { Size: "L" },
          },
          {
            id: "var-9013",
            sku: "JAC-901-XL",
            price: 2400,
            inStock: false, // out of stock!
            stockQuantity: 0,
            attributes: { Size: "XL" },
          },
        ],
      },
    ];

    it("Customer name extraction succeeds with 'আমার নাম:' or 'Amar nam:' prefix", () => {
      // When a customer writes "নাম: তানভীর", name is extracted.
      const slots1 = extractSlotsFromText("নাম: তানভীর আহমেদ");
      expect(slots1.customerName).toBe("তানভীর আহমেদ");

      // When they write conversational "আমার নাম: তানভীর আহমেদ" or "Amar nam: Tanvir", it correctly extracts the name.
      const slots2 = extractSlotsFromText("আমার নাম: তানভীর আহমেদ");
      const slots3 = extractSlotsFromText("Amar nam: Tanvir Ahmed");
      expect(slots2.customerName).toBe("তানভীর আহমেদ");
      expect(slots3.customerName).toBe("Tanvir Ahmed");
    });

    it("Bengali script confirmation 'কনফার্ম' triggers order booking with Unicode word boundaries", async () => {
      const adapter = createMockAdapter(testCatalog);
      const contactId = "contact-bengali-confirm";
      const companyId = "company-bengali-test";

      const session = orderFlowManager.getOrCreateSession(companyId, contactId);
      session.state = "AWAITING_ORDER_CONFIRMATION";
      session.slots = {
        customerName: "তানভীর আহমেদ",
        phoneNumber: "01712345678",
        deliveryAddress: "হেমায়েতপুর, সাভার, ঢাকা",
        deliveryZone: "sub_dhaka",
        paymentMethod: "cod",
        items: [
          {
            productId: "prod-901",
            variationId: "var-9012",
            quantity: 1,
            price: 2400,
          },
        ],
      };

      // Customer responds with "কনফার্ম" in Bengali script
      const res = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "কনফার্ম",
        language: "bangla",
        adapter,
      });

      // Confirms that order IS placed with Unicode-aware word boundary matching
      expect(res.state).toBe("ORDER_PLACED");
      expect(res.isOrderPlaced).toBe(true);
    });

    it("executes a complete multi-turn order across language switching using standard prefixes", async () => {
      const adapter = createMockAdapter(testCatalog);
      const contactId = "contact-stress-01";
      const companyId = "company-stress-test";

      // Turn 1: Customer asks about product in English
      const step1 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "I want to buy the Casual Denim Jacket in size L",
        language: "english",
        adapter,
        initialItems: [
          {
            productId: "prod-901",
            variationId: "var-9012",
            productName: "Casual Denim Jacket",
            size: "L",
            quantity: 1,
            price: 2400,
          },
        ],
      });

      expect(step1.slots.items.length).toBe(1);
      expect(step1.slots.items[0].size).toBe("L");

      // Turn 2: Customer asks about delivery charge to Savar in Banglish
      const step2 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "Savar e delivery charge koto pore?",
        language: "banglish",
        adapter,
      });

      expect(step2.slots.deliveryZone).toBe("sub_dhaka");
      expect(step2.replyText).toContain("Savar");
      expect(step2.replyText).toContain("৳120"); // default sub_dhaka fee

      // Turn 3: Customer provides full details with 'confirm'
      const step3 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message:
          "নাম: তানভীর আহমেদ\nঠিকানা: হেমায়েতপুর, সাভার, ঢাকা\nফোন: ০১৭১২-৩৪৫৬৭৮\norder confirm koren",
        language: "bangla",
        adapter,
      });

      expect(step3.slots.customerName).toBe("তানভীর আহমেদ");
      expect(step3.slots.phoneNumber).toBe("01712345678");
      expect(step3.slots.deliveryZone).toBe("sub_dhaka");
      expect(step3.state).toBe("ORDER_PLACED");
      expect(step3.isOrderPlaced).toBe(true);
      expect(step3.orderResult?.success).toBe(true);
      expect(step3.replyText).toContain(step3.orderResult?.orderId || "");
    });

    it("dynamically recommends in-stock alternative when requested variation is sold out", async () => {
      const adapter = createMockAdapter(testCatalog);
      const contactId = "contact-stress-02";
      const companyId = "company-stress-test";

      // Request XL which has stockQuantity: 0
      const step1 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "Casual Denim Jacket size XL lagbe",
        language: "banglish",
        adapter,
        initialItems: [
          {
            productId: "prod-901",
            variationId: "var-9013",
            productName: "Casual Denim Jacket",
            size: "XL",
            quantity: 1,
            price: 2400,
          },
        ],
      });

      // State machine should detect stockout and suggest in-stock alternatives (M or L)
      expect(step1.replyText.toLowerCase()).toContain("stock out");
      expect(step1.replyText).toContain("M");
    });
  });
});
