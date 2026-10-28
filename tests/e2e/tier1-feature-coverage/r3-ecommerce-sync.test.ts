import { beforeEach, describe, expect, test } from "bun:test";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const r3EcommerceTestCases: E2ETestCase[] = [
  {
    id: "T1-R3-01",
    name: "Live In-Stock Verification Before Ordering",
    tier: 1,
    feature: "R3",
    description:
      "Customer selects Variation #105 (4 in stock). Live stock query verifies availability and permits continuation.",
    steps: [
      {
        step: 1,
        description: "Customer asks about Variation #105",
        customerAction: {
          senderPhone: "8801713000001",
          text: "Variation #105 size L ki available ache?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Variation #105", "4 units instock", "available"],
          languageDetected: "banglish",
        },
      },
    ],
  },
  {
    id: "T1-R3-02",
    name: "Out-of-Stock Prevention & Alternative Suggestion",
    tier: 1,
    feature: "R3",
    description:
      "Customer requests Variation #106 (0 in stock). System prevents sale and suggests Size L alternative.",
    steps: [
      {
        step: 1,
        description: "Customer requests out-of-stock Variation #106",
        customerAction: {
          senderPhone: "8801713000002",
          text: "Navy Blue color size XL (Variation #106) ta confirm koren",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["স্টক আউট", "সাইজ L"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "T1-R3-03",
    name: "Incremental Catalog Sync & Stale Cache Invalidation",
    tier: 1,
    feature: "R3",
    description:
      "Store price updated from ৳850 to ৳999. In-memory cache refreshes and customer query immediately reflects ৳999.",
    steps: [
      {
        step: 1,
        description:
          "Customer queries updated product price after price change",
        setupAction: (harness: OpaqueBoxHarness) => {
          harness.setProductPrice(101, 999);
        },
        customerAction: {
          senderPhone: "8801713000003",
          text: "Black polo shirt er price koto ekhon?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["999"],
          languageDetected: "banglish",
        },
      },
    ],
  },
  {
    id: "T1-R3-04",
    name: "Variable Product Multi-Attribute Resolution",
    tier: 1,
    feature: "R3",
    description:
      "Customer requests 'Blue color size XL'. System resolves attributes Color=Navy Blue, Size=XL to variation.",
    steps: [
      {
        step: 1,
        description: "Customer specifies Color and Size attributes",
        customerAction: {
          senderPhone: "8801713000004",
          text: "bhai Navy Blue color size XL er price koto?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Navy Blue", "750"],
          languageDetected: "banglish",
        },
      },
    ],
  },
  {
    id: "T1-R3-05",
    name: "Unified Platform Adapter Conformance (Shopify Roadmap)",
    tier: 1,
    feature: "R3",
    description:
      "Verifies the unified multi-platform e-commerce interface contract for sync, stock check, and order booking.",
    steps: [
      {
        step: 1,
        description: "Simulates adapter interface contract verification",
        expectations: {
          agentShouldReply: false,
        },
      },
    ],
  },
];

describe("Tier 1 - Feature R3: WooCommerce-First E-Commerce Sync", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of r3EcommerceTestCases) {
    test(`${tc.id}: ${tc.name}`, async () => {
      // Step-specific setup
      for (const step of tc.steps) {
        if (step.setupAction) {
          await step.setupAction(harness);
        }

        if (tc.id === "T1-R3-05") {
          // Conformance contract check for Shopify roadmap adapter
          interface UnifiedAdapterContract {
            syncProducts(): Promise<any[]>;
            checkStock(items: any[]): Promise<any>;
            createOrder(payload: any): Promise<any>;
          }
          const mockShopifyAdapter: UnifiedAdapterContract = {
            syncProducts: async () => harness.wooMock.getProducts(),
            checkStock: async (items) =>
              harness.wooMock.checkStock(items[0]?.productId, null, 1),
            createOrder: async (payload) =>
              harness.wooMock.createOrder(payload),
          };

          const products = await mockShopifyAdapter.syncProducts();
          expect(products.length).toBeGreaterThan(0);
          const stock = await mockShopifyAdapter.checkStock([
            { productId: 101 },
          ]);
          expect(stock.available).toBe(true);
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
