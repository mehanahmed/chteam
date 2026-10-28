import { beforeEach, describe, expect, test } from "bun:test";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const r3BoundaryTestCases: E2ETestCase[] = [
  {
    id: "TC-T2-R3-01",
    name: "Zero Stock / Completely Out of Stock Simple Product",
    tier: 2,
    feature: "R3",
    description:
      "Customer attempts to order Premium Leather Belt (stock: 0). AI intercepts and declines order.",
    steps: [
      {
        step: 1,
        description: "Customer requests out-of-stock Leather Belt",
        customerAction: {
          senderPhone: "8801723000001",
          text: "Premium Leather Belt ta order korbo",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Leather Belt", "সম্পূর্ণ স্টক আউট"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R3-02",
    name: "Requested Quantity Exceeds Available Stock",
    tier: 2,
    feature: "R3",
    description:
      "Customer requests 5 units when only 2 units remain in stock. AI offers available 2 units.",
    steps: [
      {
        step: 1,
        description: "Customer requests 5 units of Polo",
        customerAction: {
          senderPhone: "8801723000002",
          text: "ami 5 ta polo t-shirt (Navy, L) nite chai",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["মাত্র 2 পিস", "কনফার্ম করতে চান"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R3-03",
    name: "Negative or Zero Order Quantity in Natural Language",
    tier: 2,
    feature: "R3",
    description:
      "Customer enters negative quantity '-2 ta'. System rejects and prompts for valid quantity >= 1.",
    steps: [
      {
        step: 1,
        description: "Customer enters -2 quantity",
        customerAction: {
          senderPhone: "8801723000003",
          text: "vai -2 ta shirt pathan",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["সর্বনিম্ন ১ পিস", "কয় পিস নিতে চাচ্ছেন"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R3-04",
    name: "Mid-Checkout Concurrency Race Condition Stockout",
    tier: 2,
    feature: "R3",
    description:
      "Product sells out concurrently during order booking. System catches error cleanly and notifies customer gracefully.",
    steps: [
      {
        step: 1,
        description:
          "Customer completes checkout while race condition is simulated",
        setupAction: (harness: OpaqueBoxHarness) => {
          harness.wooMock.simulateOutofStockRaceCondition = true;
        },
        customerAction: {
          senderPhone: "8801723000004",
          text: "Name: Rafiq, Phone: 01711223344, Address: Banani Dhaka. Panjabi confirm koren.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: [
            "শেষ পিসটি অন্য একজন কাস্টমার অর্ডার করে ফেলেছেন",
            "অন্য কোনো কালার",
          ],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R3-05",
    name: "Non-Existent Variation Option Selection",
    tier: 2,
    feature: "R3",
    description:
      "Customer requests Size XXXL for Panjabi. System informs XXXL is not in matrix and lists available sizes.",
    steps: [
      {
        step: 1,
        description: "Customer requests XXXL size",
        customerAction: {
          senderPhone: "8801723000005",
          text: "Panjabi tar XXXL size hobe?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["XXXL সাইজ নেই", "M, L এবং XL"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R3-06",
    name: "Backorders Permitted vs Backorders Disabled",
    tier: 2,
    feature: "R3",
    description:
      "Customer requests Custom Fit Blazer (backorder allowed). System explains item is made-to-order (5-7 days).",
    steps: [
      {
        step: 1,
        description: "Customer asks for backorder item",
        customerAction: {
          senderPhone: "8801723000006",
          text: "Custom Fit Blazer order korbo",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["প্রি-অর্ডারে নেওয়া যাবে", "৫-৭ দিন"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R3-07",
    name: "Extreme Product Pricing & Zero Price / Promotional Items",
    tier: 2,
    feature: "R3",
    description:
      "Verifies zero-price gift item handling in WooCommerce store without NaN or division by zero.",
    steps: [
      {
        step: 1,
        description: "Checks promotional gift item price in mock store",
        expectations: {
          agentShouldReply: false,
        },
      },
    ],
  },
];

describe("Tier 2 - Feature R3: Boundary & Corner Cases", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of r3BoundaryTestCases) {
    test(`${tc.id}: ${tc.name}`, async () => {
      for (const step of tc.steps) {
        if (step.setupAction) {
          await step.setupAction(harness);
        }

        if (tc.id === "TC-T2-R3-07") {
          const promoItem = harness.wooMock.getProduct(999);
          expect(promoItem).not.toBeNull();
          expect(promoItem?.price).toBe(0);
          const order = harness.wooMock.createOrder({
            customerName: "Promo Winner",
            phoneNumber: "01711223344",
            deliveryAddress: "Uttara, Dhaka",
            line_items: [{ product_id: 999, quantity: 1, unitPrice: 0 }],
            deliveryFee: 60,
            total: 60,
          });
          expect(order.total).toBe("60.00");
          return;
        }

        if (step.customerAction) {
          await harness.sendCustomerWhatsAppMessage(step.customerAction);
          const reply = harness.getLastOutboundReply(
            step.customerAction.senderPhone,
          );

          if (step.expectations.agentShouldReply) {
            expect(reply).not.toBeNull();
            if (step.expectations.replyMustContain && reply) {
              for (const token of step.expectations.replyMustContain) {
                expect(reply.text.toLowerCase()).toContain(token.toLowerCase());
              }
            }
          }
        }
      }
    });
  }
});
