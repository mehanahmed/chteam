/**
 * Comprehensive Unit Test Suite for Milestone 4
 * In-Chat Order Collection & Placement Engine
 * Location: apps/api/src/services/ai-agent/__tests__/order-flow.test.ts
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { AiOrchestratorService } from "../ai-orchestrator.service.js";
import { orderFlowManager } from "../conversation/order-flow.js";
import {
  convertBengaliDigitsToEnglish,
  extractSlotsFromText,
  getMissingSlotsPrompt,
  normalizeBdPhoneNumber,
  validateOrderSlots,
} from "../conversation/slot-filler.js";
import {
  calculateOrderPricing,
  detectDeliveryZone,
  formatZoneName,
  getAdvancePaymentPrompt,
  isAdvanceRequired,
} from "../ecommerce/delivery-rules.js";
import type {
  ECommercePlatformAdapter,
  OrderBookingPayload,
  OrderBookingResult,
  UnifiedProduct,
} from "../ecommerce/ecommerce.interface.js";
import {
  bookWooCommerceOrderTool,
  calculateOrderPricingTool,
  checkStockAndVariantsTool,
  executeAgentTool,
  GEMINI_AGENT_TOOLS,
  searchCatalogTool,
} from "../tools/agent-tools.js";

// Mock E-Commerce Platform Adapter
function createMockAdapter(
  overrides?: Partial<ECommercePlatformAdapter>,
): ECommercePlatformAdapter {
  const sampleProducts: UnifiedProduct[] = [
    {
      id: "101",
      name: "Premium Cotton Panjabi",
      sku: "PAN-101",
      price: 1850,
      regularPrice: 2200,
      description: "Fine cotton panjabi",
      images: ["https://store.local/pan-101.jpg"],
      inStock: true,
      stockQuantity: 15,
      categories: [{ id: 1, name: "Panjabi", slug: "panjabi" }],
      attributes: [{ name: "Size", options: ["M", "L", "XL"] }],
      variations: [
        {
          id: "1041",
          sku: "PAN-101-M",
          price: 1850,
          inStock: true,
          stockQuantity: 5,
          attributes: { Size: "M", Color: "White" },
        },
        {
          id: "1042",
          sku: "PAN-101-L",
          price: 1850,
          inStock: true,
          stockQuantity: 5,
          attributes: { Size: "L", Color: "White" },
        },
        {
          id: "1043",
          sku: "PAN-101-XL",
          price: 1850,
          inStock: true,
          stockQuantity: 5,
          attributes: { Size: "XL", Color: "White" },
        },
      ],
    },
    {
      id: "202",
      name: "Traditional Silk Saree",
      sku: "SAR-202",
      price: 4500,
      regularPrice: 5000,
      description: "Handloom traditional silk saree",
      images: ["https://store.local/sar-202.jpg"],
      inStock: true,
      stockQuantity: 3,
      categories: [{ id: 2, name: "Saree", slug: "saree" }],
      attributes: [],
      variations: [],
    },
  ];

  return {
    platform: "woocommerce",
    syncProducts: async () => sampleProducts,
    getProduct: async (id: string) =>
      sampleProducts.find((p) => p.id === id) || null,
    checkStock: async (items) => {
      const results = items.map((i) => ({
        productId: i.productId,
        variationId: i.variationId,
        available: true,
        availableQuantity: 10,
        unitPrice: 1850,
      }));
      return { available: true, items: results, totalPrice: 1850 };
    },
    createOrder: async (
      payload: OrderBookingPayload,
    ): Promise<OrderBookingResult> => ({
      success: true,
      orderId: "9842",
      orderTotal:
        payload.items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0) +
        payload.deliveryFee -
        (payload.discountAmount || 0),
      status:
        payload.deliveryZone === "outside_dhaka" ? "on-hold" : "processing",
    }),
    ...overrides,
  };
}

describe("Milestone 4: In-Chat Order Collection & Placement Engine", () => {
  // =========================================================================
  // 1. 11-Digit BD Mobile Phone Validation & Normalization
  // =========================================================================
  describe("1. 11-Digit Bangladeshi Mobile Phone Validation & Normalization", () => {
    it("validates standard 11-digit numbers for all BD mobile operators", () => {
      const testCases = [
        { input: "01711223344", operator: "Grameenphone" },
        { input: "01311223344", operator: "Grameenphone (013)" },
        { input: "01911223344", operator: "Banglalink" },
        { input: "01411223344", operator: "Banglalink (014)" },
        { input: "01811223344", operator: "Robi" },
        { input: "01611223344", operator: "Airtel" },
        { input: "01511223344", operator: "Teletalk" },
      ];

      for (const tc of testCases) {
        const result = normalizeBdPhoneNumber(tc.input);
        expect(result.isValid).toBe(true);
        expect(result.normalizedPhone).toBe(tc.input);
        expect(result.error).toBeUndefined();
      }
    });

    it("strips country code prefixes (+88, 88, 00880)", () => {
      expect(normalizeBdPhoneNumber("+8801711223344").normalizedPhone).toBe(
        "01711223344",
      );
      expect(normalizeBdPhoneNumber("8801811223344").normalizedPhone).toBe(
        "01811223344",
      );
      expect(normalizeBdPhoneNumber("008801911223344").normalizedPhone).toBe(
        "01911223344",
      );
    });

    it("strips whitespace, hyphens, parentheses, and formatting dots", () => {
      expect(normalizeBdPhoneNumber("01711-223344").normalizedPhone).toBe(
        "01711223344",
      );
      expect(normalizeBdPhoneNumber("01711 223 344").normalizedPhone).toBe(
        "01711223344",
      );
      expect(normalizeBdPhoneNumber("+88 01711-223-344").normalizedPhone).toBe(
        "01711223344",
      );
      expect(normalizeBdPhoneNumber("(01711) 223344").normalizedPhone).toBe(
        "01711223344",
      );
      expect(normalizeBdPhoneNumber("01711.223.344").normalizedPhone).toBe(
        "01711223344",
      );
    });

    it("converts Bengali numerals (০-৯) to standard English ASCII digits", () => {
      expect(convertBengaliDigitsToEnglish("০১২৩৪৫৬৭৮৯")).toBe("0123456789");
      expect(normalizeBdPhoneNumber("০১৭১১২২৩৩৪৪").normalizedPhone).toBe(
        "01711223344",
      );
      expect(normalizeBdPhoneNumber("+৮৮০১৭১১২২৩৩৪৪").normalizedPhone).toBe(
        "01711223344",
      );
      expect(normalizeBdPhoneNumber("০১৭১১-২২৩৩৪৪").normalizedPhone).toBe(
        "01711223344",
      );
    });

    it("prepends leading zero for 10-digit mobile number missing 0", () => {
      expect(normalizeBdPhoneNumber("1711223344").normalizedPhone).toBe(
        "01711223344",
      );
      expect(normalizeBdPhoneNumber("1811223344").normalizedPhone).toBe(
        "01811223344",
      );
    });

    it("rejects invalid numbers with descriptive errors", () => {
      // Too short
      const shortRes = normalizeBdPhoneNumber("0171122334");
      expect(shortRes.isValid).toBe(false);
      expect(shortRes.error).toContain("must be exactly 11 digits");

      // Too long
      const longRes = normalizeBdPhoneNumber("017112233445");
      expect(longRes.isValid).toBe(false);
      expect(longRes.error).toContain("must be exactly 11 digits");

      // Invalid operator prefix (010, 011, 012)
      const invalidOp = normalizeBdPhoneNumber("01112233445");
      expect(invalidOp.isValid).toBe(false);
      expect(invalidOp.error).toContain(
        "Invalid Bangladeshi mobile operator prefix",
      );

      // Empty or non-numeric
      expect(normalizeBdPhoneNumber("").isValid).toBe(false);
      expect(normalizeBdPhoneNumber(null).isValid).toBe(false);
      expect(normalizeBdPhoneNumber("call me on phone").isValid).toBe(false);
    });
  });

  // =========================================================================
  // 2. Geographic Delivery Zone Classification
  // =========================================================================
  describe("2. Geographic Delivery Zone Classification", () => {
    it("classifies Inside Dhaka addresses in English, Bengali, and Banglish", () => {
      const insideDhakaAddresses = [
        "House 12, Road 5, Dhanmondi, Dhaka",
        "Mirpur 10, Dhaka",
        "Sector 4, Uttara, Dhaka",
        "Gulshan-2, Dhaka",
        "Banani DOHS, Dhaka",
        "Bashundhara R/A, Block C, Dhaka",
        "Mohammadpur, Dhaka",
        "Badda Link Road, Dhaka",
        "Motijheel C/A",
        "Farmgate, Dhaka",
        "ধানমন্ডি ১২/এ, ঢাকা",
        "মিরপুর ২, ঢাকা ১২১৬",
        "উত্তরা সেক্টর ৭, ঢাকা",
        "বসুন্ধরা আবাসিক এলাকা",
        "dhaka dhanmondi te pathaben",
        "mirpur er address a diben",
      ];

      for (const addr of insideDhakaAddresses) {
        expect(detectDeliveryZone(addr)).toBe("inside_dhaka");
      }
    });

    it("classifies Sub-Dhaka / Suburbs addresses in English, Bengali, and Banglish", () => {
      const subDhakaAddresses = [
        "Savar Bazar Road",
        "Gazipur Chowrasta",
        "Narayanganj Chashara",
        "Keraniganj, Dhaka",
        "Tongi Station Road",
        "Ashulia, Baipayl",
        "Dhamrai Bazar",
        "Konabari, Gazipur",
        "Fatullah, Narayanganj",
        "সাভার বাজার বাসস্ট্যান্ড",
        "গাজীপুর চৌরাস্তা",
        "নারায়ণগঞ্জ চাষাড়া",
        "কেরানীগঞ্জ কদমতলী",
        "টঙ্গী বাজার",
        "আশুলিয়া বাইপাইল",
        "savar e pathaben please",
        "gazipur board bazar er kache",
      ];

      for (const addr of subDhakaAddresses) {
        expect(detectDeliveryZone(addr)).toBe("sub_dhaka");
      }
    });

    it("ensures Sub-Dhaka has precedence over Inside Dhaka when Dhaka is also mentioned", () => {
      // Customers frequently write "Savar, Dhaka" or "Gazipur, Dhaka"
      expect(detectDeliveryZone("Savar, Dhaka")).toBe("sub_dhaka");
      expect(detectDeliveryZone("Gazipur, Dhaka")).toBe("sub_dhaka");
      expect(detectDeliveryZone("Narayanganj, Dhaka")).toBe("sub_dhaka");
      expect(detectDeliveryZone("Tongi, Dhaka")).toBe("sub_dhaka");
      expect(detectDeliveryZone("সাভার, ঢাকা")).toBe("sub_dhaka");
    });

    it("classifies Outside Dhaka addresses across divisions and districts", () => {
      const outsideAddresses = [
        "GEC Circle, Chittagong",
        "Agrabad, Chattogram",
        "Zindabazar, Sylhet",
        "Rajshahi University Campus",
        "Shibbari More, Khulna",
        "Rangpur Sadar",
        "Cox's Bazar Hotel Motel Zone",
        "Cumilla Kandirpar",
        "Bogura Satmatha",
        "Barishal Sadar",
        "Mymensingh Town",
        "Noakhali Maijdee",
        "Feni Sadar",
        "Dinajpur",
        "চট্টগ্রাম জিইসি মোড়",
        "সিলেট জিন্দাবাজার",
        "রাজশাহী সাহেব বাজার",
        "কক্সবাজার",
        "Outside Dhaka",
        "Dhakar baire delivery hobe?",
        "ঢাকার বাইরে ডেলিভারি দিন",
        "গ্রামের বাড়ি নোয়াখালী",
      ];

      for (const addr of outsideAddresses) {
        expect(detectDeliveryZone(addr)).toBe("outside_dhaka");
      }
    });

    it("returns 'ambiguous' for addresses without city, district, or recognizable zone", () => {
      expect(detectDeliveryZone("House 12, Road 4")).toBe("ambiguous");
      expect(detectDeliveryZone("Flat 4A, Green Building")).toBe("ambiguous");
      expect(detectDeliveryZone("sector 10")).toBe("ambiguous");
      expect(detectDeliveryZone("")).toBe("ambiguous");
      expect(detectDeliveryZone("xyz random text")).toBe("ambiguous");
    });

    it("formats zone names accurately across languages", () => {
      expect(formatZoneName("inside_dhaka", "bangla")).toBe("ঢাকার ভেতরে");
      expect(formatZoneName("sub_dhaka", "bangla")).toContain("ঢাকা উপশহর");
      expect(formatZoneName("outside_dhaka", "bangla")).toContain("ঢাকার বাইরে");

      expect(formatZoneName("inside_dhaka", "english")).toBe("Inside Dhaka");
      expect(formatZoneName("sub_dhaka", "english")).toContain("Dhaka Suburbs");
      expect(formatZoneName("outside_dhaka", "english")).toContain(
        "Outside Dhaka",
      );
    });
  });

  // =========================================================================
  // 3. Mathematical Order Pricing Formulas
  // =========================================================================
  describe("3. Mathematical Order Pricing Formulas", () => {
    it("calculates basic subtotal and default zone delivery fees", () => {
      // Inside Dhaka: ৳80 fee
      const pInside = calculateOrderPricing({
        items: [{ unitPrice: 1850, quantity: 1 }],
        deliveryZone: "inside_dhaka",
      });
      expect(pInside.subtotal).toBe(1850);
      expect(pInside.deliveryFee).toBe(80);
      expect(pInside.discountAmount).toBe(0);
      expect(pInside.grandTotal).toBe(1930);

      // Sub-Dhaka: ৳120 fee
      const pSub = calculateOrderPricing({
        items: [{ unitPrice: 1850, quantity: 1 }],
        deliveryZone: "sub_dhaka",
      });
      expect(pSub.subtotal).toBe(1850);
      expect(pSub.deliveryFee).toBe(120);
      expect(pSub.grandTotal).toBe(1970);

      // Outside Dhaka: ৳150 fee
      const pOutside = calculateOrderPricing({
        items: [{ unitPrice: 1850, quantity: 1 }],
        deliveryZone: "outside_dhaka",
      });
      expect(pOutside.subtotal).toBe(1850);
      expect(pOutside.deliveryFee).toBe(150);
      expect(pOutside.grandTotal).toBe(2000);

      // Ambiguous zone: ৳0 fee until clarified
      const pAmb = calculateOrderPricing({
        items: [{ unitPrice: 1850, quantity: 1 }],
        deliveryZone: "ambiguous",
      });
      expect(pAmb.deliveryFee).toBe(0);
      expect(pAmb.grandTotal).toBe(1850);
    });

    it("correctly sums multi-item carts with varying quantities", () => {
      const pricing = calculateOrderPricing({
        items: [
          { unitPrice: 1850, quantity: 2 }, // 3700
          { unitPrice: 500, quantity: 3 }, // 1500
        ],
        deliveryZone: "inside_dhaka",
      });

      expect(pricing.subtotal).toBe(5200);
      expect(pricing.deliveryFee).toBe(80);
      expect(pricing.grandTotal).toBe(5280);
    });

    it("applies percentage discount coupon accurately", () => {
      const pricing = calculateOrderPricing({
        items: [{ unitPrice: 2000, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        coupon: { type: "percentage", value: 10 }, // 10% of 2000 = 200
      });

      expect(pricing.subtotal).toBe(2000);
      expect(pricing.discountAmount).toBe(200);
      expect(pricing.deliveryFee).toBe(80);
      expect(pricing.grandTotal).toBe(1880);
    });

    it("applies fixed discount coupon and clamps to subtotal", () => {
      const pricing = calculateOrderPricing({
        items: [{ unitPrice: 1500, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        coupon: { type: "fixed", value: 300 },
      });

      expect(pricing.subtotal).toBe(1500);
      expect(pricing.discountAmount).toBe(300);
      expect(pricing.grandTotal).toBe(1280);

      // Clamping check: coupon discount exceeds subtotal
      const clamped = calculateOrderPricing({
        items: [{ unitPrice: 150, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        coupon: { type: "fixed", value: 500 },
      });

      expect(clamped.discountAmount).toBe(150);
      expect(clamped.grandTotal).toBe(80); // 150 - 150 + 80 = 80
    });

    it("applies free delivery when subtotal reaches freeShippingThreshold", () => {
      // Threshold ৳3000
      const qualified = calculateOrderPricing({
        items: [{ unitPrice: 3500, quantity: 1 }],
        deliveryZone: "outside_dhaka",
        freeShippingThreshold: 3000,
      });

      expect(qualified.isFreeDelivery).toBe(true);
      expect(qualified.deliveryFee).toBe(0);
      expect(qualified.grandTotal).toBe(3500);

      // Below threshold
      const notQualified = calculateOrderPricing({
        items: [{ unitPrice: 2500, quantity: 1 }],
        deliveryZone: "outside_dhaka",
        freeShippingThreshold: 3000,
      });

      expect(notQualified.isFreeDelivery).toBe(false);
      expect(notQualified.deliveryFee).toBe(150);
      expect(notQualified.grandTotal).toBe(2650);
    });

    it("respects custom merchant delivery fee overrides", () => {
      const customPricing = calculateOrderPricing({
        items: [{ unitPrice: 1000, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        rates: {
          insideDhaka: 70,
          subDhaka: 100,
          outsideDhaka: 130,
        },
      });

      expect(customPricing.deliveryFee).toBe(70);
      expect(customPricing.grandTotal).toBe(1070);
    });
  });

  // =========================================================================
  // 4. Outside Dhaka Advance Payment Guard (RTO Fraud Prevention)
  // =========================================================================
  describe("4. Outside Dhaka Advance Payment Guard", () => {
    it("flags advance payment requirement for Outside Dhaka Cash on Delivery", () => {
      const pricing = calculateOrderPricing({
        items: [{ unitPrice: 1850, quantity: 1 }],
        deliveryZone: "outside_dhaka",
        paymentMethod: "cod",
        requireOutsideDhakaAdvance: true,
      });

      expect(pricing.advanceRequired).toBe(true);
      expect(pricing.advanceAmount).toBe(120);
      expect(pricing.codDueAmount).toBe(1880); // 2000 grandTotal - 120 advance = 1880
      expect(isAdvanceRequired("outside_dhaka", "cod", true)).toBe(true);
    });

    it("does NOT require advance payment for Inside Dhaka or Sub-Dhaka", () => {
      const insidePricing = calculateOrderPricing({
        items: [{ unitPrice: 1850, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        paymentMethod: "cod",
      });
      expect(insidePricing.advanceRequired).toBe(false);
      expect(insidePricing.advanceAmount).toBe(0);
      expect(insidePricing.codDueAmount).toBe(1930);

      const subPricing = calculateOrderPricing({
        items: [{ unitPrice: 1850, quantity: 1 }],
        deliveryZone: "sub_dhaka",
        paymentMethod: "cod",
      });
      expect(subPricing.advanceRequired).toBe(false);
      expect(subPricing.advanceAmount).toBe(0);
      expect(subPricing.codDueAmount).toBe(1970);
    });

    it("does NOT require courier advance when full order is prepaid via bKash or Nagad", () => {
      const bkashPricing = calculateOrderPricing({
        items: [{ unitPrice: 1850, quantity: 1 }],
        deliveryZone: "outside_dhaka",
        paymentMethod: "bkash",
      });
      expect(bkashPricing.advanceRequired).toBe(false);
      expect(isAdvanceRequired("outside_dhaka", "bkash", true)).toBe(false);
    });

    it("generates culturally authentic advance prompts in all three languages", () => {
      const bnPrompt = getAdvancePaymentPrompt(120, "bangla");
      expect(bnPrompt).toContain("১২০");
      expect(bnPrompt).toContain("বিকাশ অথবা নগদে");

      const enPrompt = getAdvancePaymentPrompt(120, "english");
      expect(enPrompt).toContain("120");
      expect(enPrompt).toContain("bKash or Nagad");

      const banglishPrompt = getAdvancePaymentPrompt(120, "banglish");
      expect(banglishPrompt).toContain("120");
      expect(banglishPrompt).toContain("bKash ba Nagad");
    });
  });

  // =========================================================================
  // 5. Conversational Slot Extraction & Missing Slot Detection
  // =========================================================================
  describe("5. Conversational Slot Extraction & Missing Slot Detection", () => {
    it("extracts all slots from a structured multiline message", () => {
      const text = `Name: Rahim Uddin
Phone: 01711223344
Address: House 12, Road 5, Block B, Dhanmondi, Dhaka
Payment: COD`;

      const slots = extractSlotsFromText(text);
      expect(slots.customerName).toBe("Rahim Uddin");
      expect(slots.phoneNumber).toBe("01711223344");
      expect(slots.deliveryAddress).toContain("Dhanmondi");
      expect(slots.deliveryZone).toBe("inside_dhaka");
      expect(slots.paymentMethod).toBe("cod");
    });

    it("extracts slots with Bengali script and Bengali numerals", () => {
      const text = `নাম: তামিম আহমেদ
মোবাইল: ০১৭১১২২৩৩৪৪
ঠিকানা: সাভার বাজার রোড, ঢাকা
পেমেন্ট: ক্যাশ অন ডেলিভারি`;

      const slots = extractSlotsFromText(text);
      expect(slots.customerName).toBe("তামিম আহমেদ");
      expect(slots.phoneNumber).toBe("01711223344");
      expect(slots.deliveryZone).toBe("sub_dhaka");
      expect(slots.paymentMethod).toBe("cod");
    });

    it("identifies missing slots and generates targeted conversational prompts", () => {
      // 1. Missing phone and address
      const validation1 = validateOrderSlots({
        customerName: "Rahim",
        items: [{ productId: "101", quantity: 1, price: 1850 }],
        paymentMethod: "cod",
      });
      expect(validation1.isComplete).toBe(false);
      expect(validation1.missingSlots).toContain("phoneNumber");
      expect(validation1.missingSlots).toContain("deliveryAddress");

      const prompt1 = getMissingSlotsPrompt(validation1, "banglish");
      expect(prompt1).toContain("mobile number");
      expect(prompt1).toContain("delivery address");

      // 2. Only phone number missing
      const validation2 = validateOrderSlots({
        customerName: "Rahim",
        deliveryAddress: "House 12, Road 5, Dhanmondi, Dhaka",
        deliveryZone: "inside_dhaka",
        items: [{ productId: "101", quantity: 1, price: 1850 }],
        paymentMethod: "cod",
      });
      expect(validation2.missingSlots).toEqual(["phoneNumber"]);
      const prompt2 = getMissingSlotsPrompt(validation2, "banglish");
      expect(prompt2).toContain("11-digit mobile number");

      // 3. Ambiguous zone prompt
      const validation3 = validateOrderSlots({
        customerName: "Rahim",
        phoneNumber: "01711223344",
        deliveryAddress: "House 12, Road 4",
        deliveryZone: "ambiguous",
        items: [{ productId: "101", quantity: 1, price: 1850 }],
        paymentMethod: "cod",
      });
      expect(validation3.missingSlots).toEqual(["deliveryZone"]);
      const prompt3 = getMissingSlotsPrompt(validation3, "banglish");
      expect(prompt3).toContain("Dhakar bhetore naki Dhakar baire");

      // 4. Invalid phone number feedback
      const validation4 = validateOrderSlots({
        customerName: "Rahim",
        phoneNumber: "0171122", // too short
        deliveryAddress: "Dhanmondi, Dhaka",
        deliveryZone: "inside_dhaka",
        items: [{ productId: "101", quantity: 1, price: 1850 }],
        paymentMethod: "cod",
      });
      const prompt4 = getMissingSlotsPrompt(validation4, "banglish");
      expect(prompt4).toContain("thik mone hocche na");
    });
  });

  // =========================================================================
  // 6. Conversational Order Booking State Machine & Live Order Placement
  // =========================================================================
  describe("6. Conversational Order Booking State Machine & Live Order Placement", () => {
    beforeEach(() => {
      orderFlowManager.clearSession("contact-test-1");
      orderFlowManager.clearSession("contact-test-outside");
    });

    it("executes complete end-to-end multi-turn order booking conversation", async () => {
      const adapter = createMockAdapter();
      const contactId = "contact-test-1";
      const companyId = "company-1";

      // Initialize session with a cart item
      const session = orderFlowManager.getOrCreateSession(
        companyId,
        contactId,
        "banglish",
      );
      orderFlowManager.addItem(session, {
        productId: "101",
        productName: "Premium Cotton Panjabi",
        variationId: "1043",
        size: "XL",
        color: "White",
        quantity: 1,
        price: 1850,
      });

      // Turn 1: Customer sends name and phone, but missing address
      const turn1 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "Amar nam Rahim Uddin, phone: 01711223344",
        adapter,
      });

      expect(turn1.state).toBe("COLLECTING_DETAILS");
      expect(turn1.slots.customerName).toBe("Rahim Uddin");
      expect(turn1.slots.phoneNumber).toBe("01711223344");
      expect(turn1.replyText).toContain("delivery address");

      // Turn 2: Customer provides Inside Dhaka delivery address
      const turn2 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "Address: House 12, Road 5, Block B, Dhanmondi, Dhaka",
        adapter,
      });

      // All slots now complete -> State machine generates order summary
      expect(turn2.state).toBe("AWAITING_ORDER_CONFIRMATION");
      expect(turn2.replyText).toContain("Order Summary");
      expect(turn2.replyText).toContain("Rahim Uddin");
      expect(turn2.replyText).toContain("01711223344");
      expect(turn2.replyText).toContain("Inside Dhaka");
      expect(turn2.replyText).toContain("৳80"); // delivery fee
      expect(turn2.replyText).toContain("৳1,930"); // grand total
      expect(turn2.replyText).toContain("Confirm");

      // Turn 3: Customer confirms order
      const turn3 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "Ji bhaiya, order confirm koren!",
        adapter,
      });

      expect(turn3.state).toBe("ORDER_PLACED");
      expect(turn3.isOrderPlaced).toBe(true);
      expect(turn3.orderResult?.orderId).toBe("9842");
      expect(turn3.replyText).toContain("Order Confirmed");
      expect(turn3.replyText).toContain("#9842");
      expect(turn3.replyText).toContain("৳1,930");
      expect(turn3.replyText).toContain("24-48 hours");
    });

    it("handles outside Dhaka advance payment requirement turn", async () => {
      const adapter = createMockAdapter();
      const contactId = "contact-test-outside";
      const companyId = "company-1";

      const session = orderFlowManager.getOrCreateSession(
        companyId,
        contactId,
        "banglish",
      );
      orderFlowManager.addItem(session, {
        productId: "101",
        productName: "Premium Cotton Panjabi",
        quantity: 1,
        price: 1850,
      });

      // Customer provides outside Dhaka address directly with full details
      const turn1 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: `Name: Farhan
Phone: 01811223344
Address: GEC Circle, Chittagong
Payment: COD`,
        adapter,
      });

      // State machine detects Outside Dhaka + COD -> prompts for courier advance
      expect(turn1.state).toBe("AWAITING_ADVANCE_CONFIRMATION");
      expect(turn1.replyText).toContain("courier charge");
      expect(turn1.replyText).toContain("advance");

      // Customer agrees to advance payment
      const turn2 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "Thik ache, ami 120 taka advance dibo",
        adapter,
      });

      expect(turn2.state).toBe("AWAITING_ORDER_CONFIRMATION");
      expect(turn2.replyText).toContain("Order Summary");
      expect(turn2.replyText).toContain("Advance Courier Charge");
      expect(turn2.replyText).toContain("৳120");

      // Customer confirms
      const turn3 = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "Yes, confirm koren",
        adapter,
      });

      expect(turn3.state).toBe("ORDER_PLACED");
      expect(turn3.orderResult?.status).toBe("on-hold"); // Outside Dhaka COD placed on-hold awaiting advance
      expect(turn3.replyText).toContain("#9842");
    });

    it("handles cancellation gracefully", async () => {
      const adapter = createMockAdapter();
      const contactId = "contact-test-cancel";
      const companyId = "company-1";

      const session = orderFlowManager.getOrCreateSession(
        companyId,
        contactId,
        "banglish",
      );
      orderFlowManager.addItem(session, {
        productId: "101",
        quantity: 1,
        price: 1850,
      });

      const turn = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "Lagbe na, order cancel koren",
        adapter,
      });

      expect(turn.state).toBe("CANCELLED");
      expect(turn.replyText).toContain("cancel kora hoyeche");
      expect(orderFlowManager.hasActiveSession(contactId)).toBe(false);
    });

    it("handles WooCommerce order creation errors gracefully", async () => {
      const failingAdapter = createMockAdapter({
        createOrder: async () => ({
          success: false,
          orderId: "",
          orderTotal: 0,
          status: "failed",
          error: "Selected variation is out of stock in warehouse",
        }),
      });

      const contactId = "contact-test-fail";
      const session = orderFlowManager.getOrCreateSession(
        "comp-1",
        contactId,
        "banglish",
      );
      orderFlowManager.addItem(session, {
        productId: "101",
        quantity: 1,
        price: 1850,
      });
      orderFlowManager.updateSlots(session, {
        customerName: "Rahim",
        phoneNumber: "01711223344",
        deliveryAddress: "Dhanmondi, Dhaka",
        deliveryZone: "inside_dhaka",
      });
      session.state = "AWAITING_ORDER_CONFIRMATION";

      const result = await orderFlowManager.processMessage({
        companyId: "comp-1",
        contactId,
        message: "Confirm koren",
        adapter: failingAdapter,
      });

      expect(result.isOrderPlaced).toBe(false);
      expect(result.replyText).toContain("out of stock");
    });
  });

  // =========================================================================
  // 7. Gemini Agent Tools & Function Calling Dispatcher
  // =========================================================================
  describe("7. Gemini Agent Tools & Function Calling Dispatcher", () => {
    it("defines valid tool schemas compliant with Google GenAI SDK", () => {
      expect(GEMINI_AGENT_TOOLS.functionDeclarations.length).toBe(4);

      const names = GEMINI_AGENT_TOOLS.functionDeclarations.map((t) => t.name);
      expect(names).toContain("search_catalog");
      expect(names).toContain("check_stock_and_variants");
      expect(names).toContain("calculate_order_pricing");
      expect(names).toContain("book_woocommerce_order");

      expect(searchCatalogTool.parameters.required).toContain("query");
      expect(checkStockAndVariantsTool.parameters.required).toContain(
        "productId",
      );
      expect(calculateOrderPricingTool.parameters.required).toContain("items");
      expect(calculateOrderPricingTool.parameters.required).toContain(
        "deliveryZone",
      );
      expect(bookWooCommerceOrderTool.parameters.required).toContain(
        "customerName",
      );
      expect(bookWooCommerceOrderTool.parameters.required).toContain(
        "phoneNumber",
      );
      expect(bookWooCommerceOrderTool.parameters.required).toContain(
        "deliveryAddress",
      );
    });

    it("executes search_catalog tool successfully", async () => {
      const adapter = createMockAdapter();
      const result = await executeAgentTool(
        "search_catalog",
        { query: "panjabi", limit: 3 },
        { adapter },
      );

      expect(result.success).toBe(true);
      // biome-ignore lint/suspicious/noExplicitAny: test assert
      const data = result.data as any;
      expect(data.totalFound).toBeGreaterThan(0);
      expect(data.products[0].name).toContain("Panjabi");
    });

    it("executes check_stock_and_variants tool successfully", async () => {
      const adapter = createMockAdapter();
      const result = await executeAgentTool(
        "check_stock_and_variants",
        { productId: "101", size: "XL", quantity: 1 },
        { adapter },
      );

      expect(result.success).toBe(true);
      // biome-ignore lint/suspicious/noExplicitAny: test assert
      const data = result.data as any;
      expect(data.available).toBe(true);
      expect(data.variationId).toBe("1043"); // resolved variation for size XL
    });

    it("executes calculate_order_pricing tool successfully", async () => {
      const adapter = createMockAdapter();
      const result = await executeAgentTool(
        "calculate_order_pricing",
        {
          items: [{ unitPrice: 1850, quantity: 2 }],
          deliveryZone: "sub_dhaka",
        },
        { adapter },
      );

      expect(result.success).toBe(true);
      // biome-ignore lint/suspicious/noExplicitAny: test assert
      const pricing = result.data as any;
      expect(pricing.subtotal).toBe(3700);
      expect(pricing.deliveryFee).toBe(120);
      expect(pricing.grandTotal).toBe(3820);
    });

    it("executes book_woocommerce_order tool successfully", async () => {
      const adapter = createMockAdapter();
      const result = await executeAgentTool(
        "book_woocommerce_order",
        {
          customerName: "Rahim Uddin",
          phoneNumber: "01711223344",
          deliveryAddress: "House 12, Road 5, Dhanmondi, Dhaka",
          deliveryZone: "inside_dhaka",
          items: [{ productId: "101", quantity: 1, unitPrice: 1850 }],
          deliveryFee: 80,
          paymentMethod: "cod",
        },
        { adapter },
      );

      expect(result.success).toBe(true);
      // biome-ignore lint/suspicious/noExplicitAny: test assert
      const order = result.data as any;
      expect(order.orderId).toBe("9842");
    });

    it("rejects book_woocommerce_order with invalid phone number", async () => {
      const adapter = createMockAdapter();
      const result = await executeAgentTool(
        "book_woocommerce_order",
        {
          customerName: "Rahim Uddin",
          phoneNumber: "0171122", // invalid length
          deliveryAddress: "House 12, Road 5, Dhanmondi, Dhaka",
          deliveryZone: "inside_dhaka",
          items: [{ productId: "101", quantity: 1, unitPrice: 1850 }],
          deliveryFee: 80,
          paymentMethod: "cod",
        },
        { adapter },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("must be exactly 11 digits");
    });
  });

  // =========================================================================
  // 8. Integration with AiOrchestratorService
  // =========================================================================
  describe("8. AiOrchestratorService Order Flow Integration", () => {
    it("routes message to OrderFlowManager when active session exists", async () => {
      const orchestrator = new AiOrchestratorService();
      const adapter = createMockAdapter();
      orchestrator.setEcommerceAdapter(adapter);

      const contactId = "contact-active-session";
      const companyId = "company-test";

      // Setup active order session with a product
      const session = orderFlowManager.getOrCreateSession(
        companyId,
        contactId,
        "banglish",
      );
      orderFlowManager.addItem(session, {
        productId: "101",
        productName: "Premium Cotton Panjabi",
        quantity: 1,
        price: 1850,
      });
      orderFlowManager.updateSlots(session, {
        customerName: "Rahim",
        phoneNumber: "01711223344",
        deliveryAddress: "House 12, Road 5, Dhanmondi, Dhaka",
        deliveryZone: "inside_dhaka",
      });
      session.state = "AWAITING_ORDER_CONFIRMATION";

      // Mock DB for suppression bypass
      orchestrator.setMockDb({
        selectFrom: () => ({
          select: () => ({
            where: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    executeTakeFirst: async () => undefined,
                  }),
                }),
              }),
              orderBy: () => ({
                limit: () => ({
                  executeTakeFirst: async () => undefined,
                }),
              }),
              executeTakeFirst: async () => undefined,
              execute: async () => [],
            }),
            executeTakeFirst: async () => undefined,
            execute: async () => [],
          }),
          innerJoin: () => ({
            select: () => ({
              where: () => ({
                execute: async () => [],
              }),
            }),
          }),
        }),
      });

      // Process message through order flow
      const step = await orderFlowManager.processMessage({
        companyId,
        contactId,
        message: "Confirm koren",
        adapter,
      });

      expect(step.state).toBe("ORDER_PLACED");
      expect(step.isOrderPlaced).toBe(true);
      expect(step.replyText).toContain("#9842");
    });
  });
});
