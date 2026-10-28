import { beforeEach, describe, expect, test } from "bun:test";
import {
  BKASH_RECEIPT_TC_T3_05,
  COMPETITOR_SCREENSHOT_AARONG,
  PRODUCT_SCREENSHOT_KURTI,
} from "../harness/fixtures/sample-receipts.js";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const tier3CrossFeatureTestCases: E2ETestCase[] = [
  {
    id: "TC-T3-01",
    name: "Vision R2 + Banglish R1 + Variable Stockout Fallback R3",
    tier: 3,
    feature: "CROSS",
    description:
      "Customer sends Kurti photo requesting Size M in Banglish. Size M is out of stock, AI recommends in-stock L and XL.",
    steps: [
      {
        step: 1,
        description: "Customer sends photo requesting size M",
        customerAction: {
          senderPhone: "8801730000001",
          media: PRODUCT_SCREENSHOT_KURTI,
          text: "bhai ei dress ta hobe? Size M lagbe amar.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: [
            "Floral Georgette Kurti",
            "M size-ti ei muhurte stock out",
            "L ebong XL size available",
          ],
          languageDetected: "banglish",
          orderExpected: { created: false },
        },
      },
    ],
  },
  {
    id: "TC-T3-02",
    name: "Vision R2 + Banglish R1 + Outside Dhaka Delivery R4 + Advance Payment Guard R4",
    tier: 3,
    feature: "CROSS",
    description:
      "Customer sends full details for Outside Dhaka order in Banglish. System creates on-hold order and requires ৳120 advance.",
    steps: [
      {
        step: 1,
        description: "Customer provides full Rangpur order details",
        customerAction: {
          senderPhone: "8801730000002",
          text: "bhai eta order confirm koren. Name: Tanvir Islam, Phone: 01711998877, Address: Station Road, Rangpur Sadar, Rangpur. Size XL Panjabi.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Order", "120", "অগ্রিম বিকাশ", "1920"],
          orderExpected: {
            created: true,
            deliveryZone: "outside_dhaka",
            deliveryFee: 120,
            total: 1920,
            status: "on-hold",
          },
        },
      },
    ],
  },
  {
    id: "TC-T3-03",
    name: "Banglish R1 + Partial Phone Slot Filling R4 + Ambiguous Address R4 + Coupon R4",
    tier: 3,
    feature: "CROSS",
    description:
      "Customer provides invalid 10-digit phone, ambiguous Mirpur address, and coupon SAVE50. AI prompts for corrections.",
    steps: [
      {
        step: 1,
        description:
          "Customer sends partial info with invalid phone and ambiguous address",
        customerAction: {
          senderPhone: "8801730000003",
          text: "ami 1 ta hoodie nibo, nam Rahim, phone 0171122334, thikana Mirpur, coupon SAVE50",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: [
            "৫০ টাকা ডিসকাউন্ট কুপনটি যুক্ত করা হয়েছে",
            "১১ ডিজিটের সঠিক মোবাইল নম্বর",
            "মিরপুরের বিস্তারিত ঠিকানা",
          ],
          languageDetected: "bangla",
          orderExpected: { created: false },
        },
      },
    ],
  },
  {
    id: "TC-T3-04",
    name: "Mid-Checkout Stockout R3 + Customer Complaint R5 + Agent Interception R5",
    tier: 3,
    feature: "CROSS",
    description:
      "Concurrent stockout occurs; customer reacts with fury. System detects complaint, tags contact, human agent takes over.",
    steps: [
      {
        step: 1,
        description: "Customer tries to book while item sells out",
        setupAction: (harness: OpaqueBoxHarness) => {
          harness.wooMock.simulateOutofStockRaceCondition = true;
        },
        customerAction: {
          senderPhone: "8801730000004",
          text: "Name: Rafiq, Phone: 01711223344, Address: Dhanmondi Dhaka. Panjabi confirm koren.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["শেষ পিসটি অন্য একজন কাস্টমার অর্ডার করে ফেলেছেন"],
        },
      },
      {
        step: 2,
        description: "Customer reacts furiously with complaint",
        setupAction: (harness: OpaqueBoxHarness) => {
          harness.wooMock.simulateOutofStockRaceCondition = false;
        },
        customerAction: {
          senderPhone: "8801730000004",
          text: "ki faltu service toder! age bolli ache ekhon bolos nai! scammer page! manush er sathe kotha bolbo!",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["আন্তরিকভাবে দুঃখিত", "ম্যানেজার"],
          tagsExpected: {
            mustInclude: ["ai-paused", "needs-human", "complaint"],
          },
        },
      },
      {
        step: 3,
        description: "Human agent claims chat and sends manual reply",
        agentAction: {
          type: "manual_send",
          agentId: "agent-lead-01",
          phone: "8801730000004",
          text: "Assalamu Alaikum Rafiq bhai, ami Customer Support Lead. Stock checking issue tar jonno amra antorikbhabe dukkhito.",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
    ],
  },
  {
    id: "TC-T3-05",
    name: "Multimodal Receipt OCR R2 + Outside Dhaka Order Confirmation R4 + bKash TrxID Verification",
    tier: 3,
    feature: "CROSS",
    description:
      "Customer with on-hold order sends bKash screenshot for ৳120 advance. Vision verifies TrxID and advances order to processing.",
    steps: [
      {
        step: 1,
        description:
          "Customer books outside Dhaka order creating on-hold status",
        customerAction: {
          senderPhone: "8801730000005",
          text: "Name: Mehedi, Phone: 01819876543, Address: Nasirabad, Chittagong. Panjabi confirm koren.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["120", "অগ্রিম"],
          orderExpected: {
            created: true,
            status: "on-hold",
          },
        },
      },
      {
        step: 2,
        description: "Customer uploads bKash screenshot for ৳120",
        customerAction: {
          senderPhone: "8801730000005",
          media: BKASH_RECEIPT_TC_T3_05,
          text: "bKash kore dilam",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["9K32MX41L7", "120", "Order Confirmed"],
          orderExpected: {
            created: true,
            status: "processing",
          },
        },
      },
    ],
  },
  {
    id: "TC-T3-06",
    name: "Bengali Script R1 + Multi-Item Cart R3 + Sub-Dhaka Zone R4 + Free Shipping Threshold R4",
    tier: 3,
    feature: "CROSS",
    description:
      "Customer orders 2 items (৳2400) in Bengali script to Gazipur. Subtotal >= ৳2000 triggers Free Delivery.",
    steps: [
      {
        step: 1,
        description: "Customer orders 2 items in Gazipur exceeding ৳2000",
        customerAction: {
          senderPhone: "8801730000006",
          text: "আমি ১টি ফর্মাল শার্ট (সাইজ 40) এবং ১টি ডেনিম জিন্স (সাইজ 32) নিব। ডেলিভারি: গাজীপুর চৌরাস্তা। নাম: হাসান মাহমুদ, ফোন: 01611223344, ঠিকানা: বাসা ১৮, রোড ২, চান্দনা চৌরাস্তা, গাজীপুর।",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["২০০০ টাকার বেশি", "ডেলিভারি চার্জ সম্পূর্ণ ফ্রি", "২৪০০"],
          orderExpected: {
            created: true,
            deliveryZone: "sub_dhaka",
            deliveryFee: 0,
            total: 2400,
            status: "processing",
          },
        },
      },
    ],
  },
  {
    id: "TC-T3-07",
    name: "English Corporate Inquiry R1 + Bulk Quantity Sanity R4 + Out-of-Scope Agent Handoff R5",
    tier: 3,
    feature: "CROSS",
    description:
      "Customer requests 300 custom shirts in English. System escalates to enterprise desk and tags needs-human.",
    steps: [
      {
        step: 1,
        description: "Customer sends 300-unit corporate inquiry",
        customerAction: {
          senderPhone: "8801730000007",
          text: "Hello, we are looking to procure 300 units of your Oxford Cotton Shirts with our corporate logo embroidered for our upcoming tech summit in Dhaka. Can you provide a quotation and lead time?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: [
            "B2B sales team",
            "50 units",
            "corporate representative",
          ],
          tagsExpected: {
            mustInclude: ["needs-human", "ai-paused"],
          },
          orderExpected: { created: false },
        },
      },
    ],
  },
  {
    id: "TC-T3-08",
    name: "Vision R2 + Competitor Catalog Screenshot R2 + Trilingual Fallback R1 + In-Stock Catalog Recommendation R3",
    tier: 3,
    feature: "CROSS",
    description:
      "Customer sends photo of competitor dress. Vision extracts style/color, AI recommends 2 in-stock party gowns.",
    steps: [
      {
        step: 1,
        description: "Customer sends competitor dress screenshot",
        customerAction: {
          senderPhone: "8801730000008",
          media: COMPETITOR_SCREENSHOT_AARONG,
          text: "ei rokom party dress ache apnader kache?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: [
            "হুবহু এই ব্র্যান্ডের মডেলটি আমাদের নেই",
            "Emerald Green Georgette Party Gown",
            "Silk Embroidered Party Gown",
          ],
          languageDetected: "banglish",
          orderExpected: { created: false },
        },
      },
    ],
  },
];

describe("Tier 3 - Cross-Feature Pairwise & Combinatorial Interactions", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of tier3CrossFeatureTestCases) {
    test(`${tc.id}: ${tc.name}`, async () => {
      for (const step of tc.steps) {
        if (step.setupAction) {
          await step.setupAction(harness);
        }

        if (step.agentAction) {
          const targetPhone = step.agentAction.phone || "8801730000000";
          if (step.agentAction.type === "manual_send") {
            await harness.sendAgentManualReply(
              targetPhone,
              step.agentAction.agentId,
              step.agentAction.text || "",
            );
          } else if (step.agentAction.type === "assign") {
            await harness.assignContactToHuman(
              targetPhone,
              step.agentAction.agentId,
            );
          } else if (step.agentAction.type === "pause") {
            await harness.setAiPauseState(targetPhone, true);
          } else if (step.agentAction.type === "resume") {
            await harness.setAiPauseState(targetPhone, false);
          }
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

          if (step.expectations.tagsExpected?.mustInclude) {
            const tags = harness.getContactTags(
              step.customerAction.senderPhone,
            );
            for (const tag of step.expectations.tagsExpected.mustInclude) {
              expect(tags).toContain(tag);
            }
          }

          if (step.expectations.orderExpected) {
            const orders = harness.getCreatedOrders();
            if (step.expectations.orderExpected.created) {
              expect(orders.length).toBeGreaterThan(0);
              const lastOrder = harness.getLastCreatedOrder();
              expect(lastOrder).not.toBeNull();
              if (step.expectations.orderExpected.status) {
                expect(lastOrder?.status).toBe(
                  step.expectations.orderExpected.status,
                );
              }
              if (step.expectations.orderExpected.deliveryFee !== undefined) {
                const shippingLine = lastOrder?.shipping_lines[0];
                expect(Number(shippingLine?.total)).toBe(
                  step.expectations.orderExpected.deliveryFee,
                );
              }
              if (step.expectations.orderExpected.total !== undefined) {
                expect(Number(lastOrder?.total)).toBe(
                  step.expectations.orderExpected.total,
                );
              }
            }
          }
        }
      }
    });
  }
});
