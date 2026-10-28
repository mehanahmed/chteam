import { beforeEach, describe, expect, test } from "bun:test";
import {
  BKASH_RECEIPT_SCENARIO_3,
  PRODUCT_SCREENSHOT_PANJABI,
} from "../harness/fixtures/sample-receipts.js";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const tier4RealWorldTestCases: E2ETestCase[] = [
  {
    id: "TC-T4-01",
    name: "Scenario 1: Happy Path Social-Commerce Order with Screenshot & Banglish (Inside Dhaka COD)",
    tier: 4,
    feature: "CROSS",
    description:
      "Multi-turn flow: screenshot inquiry -> size negotiation -> full slot completion -> order booked in WooCommerce.",
    steps: [
      {
        step: 1,
        description:
          "Customer sends Panjabi screenshot asking price & availability",
        customerAction: {
          senderPhone: "8801741000001",
          media: PRODUCT_SCREENSHOT_PANJABI,
          text: "vai eta hobe? price koto porbe?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["1800", "PANJ-BLK-01", "40", "42", "44"],
          languageDetected: "banglish",
        },
      },
      {
        step: 2,
        description: "Customer asks for L size and Dhanmondi delivery charge",
        customerAction: {
          senderPhone: "8801741000001",
          text: "L size lagbe. Dhanmondi te delivery charge koto?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Dhanmondi", "60", "1860"],
          languageDetected: "banglish",
        },
      },
      {
        step: 3,
        description: "Customer sends name, phone, and full address",
        customerAction: {
          senderPhone: "8801741000001",
          text: "Okay confirm koren. Name: Tanvir Ahmed, Phone: 01712345678, Address: House 45, Road 8/A, Dhanmondi, Dhaka.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Order ID", "1800", "60", "1860", "Dhanmondi"],
          orderExpected: {
            created: true,
            deliveryZone: "inside_dhaka",
            deliveryFee: 60,
            total: 1860,
            status: "processing",
          },
        },
      },
    ],
  },
  {
    id: "TC-T4-02",
    name: "Scenario 2: Out-of-Stock Variant Negotiation & Upsell with Language Mirroring (Bengali Script)",
    tier: 4,
    feature: "CROSS",
    description:
      "Customer inquires in Bengali script, negotiates around an out-of-stock color, and completes order for available color.",
    steps: [
      {
        step: 1,
        description: "Customer asks for leather wallet in Bengali script",
        customerAction: {
          senderPhone: "8801742000002",
          text: "আসসালামু আলাইকুম, আপনাদের প্রিমিয়াম লেদার ওয়ালেটটি কি স্টকে আছে?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["ওয়ালাইকুম আসসালাম", "১২৫০", "ব্রাউন নাকি ব্ল্যাক"],
          languageDetected: "bangla",
        },
      },
      {
        step: 2,
        description: "Customer requests 2 units of out-of-stock Brown color",
        customerAction: {
          senderPhone: "8801742000002",
          text: "ব্রাউন কালারটি ২ পিস লাগবে।",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: [
            "ব্রাউন কালার ওয়ালেটটি এই মুহূর্তে সম্পূর্ণ স্টক আউট",
            "ডিপ-ব্ল্যাক",
            "৭ পিস",
          ],
          languageDetected: "bangla",
        },
      },
      {
        step: 3,
        description: "Customer accepts Black color alternative",
        customerAction: {
          senderPhone: "8801742000002",
          text: "আচ্ছা সমস্যা নেই, ব্ল্যাক কালারের ১ পিসই দিন।",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["১২৫০", "নাম", "মোবাইল নম্বর", "ডেলিভারি ঠিকানা"],
          languageDetected: "bangla",
        },
      },
      {
        step: 4,
        description: "Customer provides full details in Mirpur, Dhaka",
        customerAction: {
          senderPhone: "8801742000002",
          text: "নাম: মো: রফিকুল ইসলাম, ফোন: 01811223344, ঠিকানা: বাসা ১২, রোড ৩, ব্লক বি, মিরপুর-১০, ঢাকা।",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["অর্ডার", "রফিকুল", "1310", "মিরপুর"],
          orderExpected: {
            created: true,
            deliveryZone: "inside_dhaka",
            deliveryFee: 60,
            total: 1310,
            status: "processing",
          },
        },
      },
    ],
  },
  {
    id: "TC-T4-03",
    name: "Scenario 3: Outside Dhaka Order with Advance Payment Guard & Receipt OCR (Chattogram COD + bKash Advance)",
    tier: 4,
    feature: "CROSS",
    description:
      "Customer in Chattogram books order, receives ৳120 advance instruction, uploads receipt, order advances to processing.",
    steps: [
      {
        step: 1,
        description: "Customer inquires about polo delivery to Chittagong",
        customerAction: {
          senderPhone: "8801743000003",
          text: "vai polo t-shirt navy blue XL delivery hobe Chittagong?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Chittagong", "750", "120", "অগ্রিম বিকাশ"],
          languageDetected: "banglish",
        },
      },
      {
        step: 2,
        description: "Customer confirms order details",
        customerAction: {
          senderPhone: "8801743000003",
          text: "Haa confirm korbo. Name: Mehedi Hasan, 01819876543, House 12, Nasirabad, Chattogram.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["120", "বিকাশ মার্চেন্ট: 01700112233", "TrxID"],
          orderExpected: {
            created: true,
            status: "on-hold",
          },
        },
      },
      {
        step: 3,
        description: "Customer uploads bKash payment screenshot",
        customerAction: {
          senderPhone: "8801743000003",
          media: BKASH_RECEIPT_SCENARIO_3,
          text: "payment done, 120 tk pathaisi",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["9L43KP889A", "120", "Order Confirmed"],
          orderExpected: {
            created: true,
            status: "processing",
          },
        },
      },
    ],
  },
  {
    id: "TC-T4-04",
    name: "Scenario 4: Multi-Item Cart with Sub-Dhaka Zone, Coupon Code, and Slot Clarification",
    tier: 4,
    feature: "CROSS",
    description:
      "Customer orders Linen Shirt + Chino Pant to Savar, provides SAVE10 coupon, clarifies 10-digit phone, gets order #.",
    steps: [
      {
        step: 1,
        description: "Customer requests 2 items in Savar in English",
        customerAction: {
          senderPhone: "8801744000004",
          text: "Hi, I want to order 1 Linen Shirt (White, L) and 1 Chino Pant (Beige, 32). Do you deliver to Savar?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Savar", "100", "2,500", "2,600"],
          languageDetected: "english",
        },
      },
      {
        step: 2,
        description: "Customer provides coupon SAVE10 and incomplete details",
        customerAction: {
          senderPhone: "8801744000004",
          text: "Yes confirm. I have coupon code 'SAVE10'. My name is Shakil, phone: 0171122334, address: Savar Bazar.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["SAVE10", "-৳250", "10 digits", "Savar Bazar"],
          orderExpected: { created: false },
        },
      },
      {
        step: 3,
        description: "Customer corrects phone number and detailed shop address",
        customerAction: {
          senderPhone: "8801744000004",
          text: "Sorry, my phone is 01711223344. Address: Shop 14, Noor Super Market, Savar Bazar Bus Stand.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: [
            "Order Confirmation",
            "2,500",
            "250",
            "100",
            "2,350",
            "01711223344",
          ],
          orderExpected: {
            created: true,
            deliveryZone: "sub_dhaka",
            deliveryFee: 100,
            total: 2350,
            status: "processing",
          },
        },
      },
    ],
  },
  {
    id: "TC-T4-05",
    name: "Scenario 5: Delivery Delay Complaint Escalation & Human Agent Live Takeover",
    tier: 4,
    feature: "CROSS",
    description:
      "Customer complains about delay, AI triggers handoff, human agent claims and replies, agent resumes AI.",
    steps: [
      {
        step: 1,
        description: "Customer submits angry delivery delay complaint",
        customerAction: {
          senderPhone: "8801745000005",
          text: "apnader service eto baje keno? 5 din age order korsi ajk o delivery pai nai! Fake page naki? phone diley kew dhore na. tk ferot den!",
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
        step: 2,
        description: "Customer sends follow-up while AI is suppressed",
        customerAction: {
          senderPhone: "8801745000005",
          text: "Kew ki kotha bolbe naki shudhu message ashbe? taratari bolen!",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 3,
        description: "Human agent claims contact and sends manual explanation",
        agentAction: {
          type: "manual_send",
          agentId: "agent-sabbir",
          phone: "8801745000005",
          text: "Assalamu Alaikum Sir, ami Sabbir, Customer Support Lead. Ferry bondho thakay parcel delay hoyechilo. Ajke 2 tar moddhe delivery hobe.",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 4,
        description: "Customer acknowledges human agent",
        customerAction: {
          senderPhone: "8801745000005",
          text: "Accha thik ache, dupure call dile hobe. Thanks Sabbir bhai.",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 5,
        description: "Agent clicks Resume AI in UI header",
        agentAction: {
          type: "resume",
          agentId: "agent-sabbir",
          phone: "8801745000005",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
    ],
  },
  {
    id: "TC-T4-06",
    name: "Scenario 6: Ambiguous Address & Invalid Phone Recovery with Bengali/Banglish Code Switching",
    tier: 4,
    feature: "CROSS",
    description:
      "Customer provides 7-digit phone and ambiguous station road. AI prompts for district and phone, then books outside Dhaka order.",
    steps: [
      {
        step: 1,
        description: "Customer requests hoodie order",
        customerAction: {
          senderPhone: "8801746000006",
          text: "bhai hoodie ta nibo, order koren",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Winter Hoodie", "1200", "size"],
          languageDetected: "banglish",
        },
      },
      {
        step: 2,
        description: "Customer sends 7-digit phone and ambiguous station road",
        customerAction: {
          senderPhone: "8801746000006",
          text: "size L, nam Fahim, phone 0171234, thikana: station road",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["৭টি ডিজিট", "স্টেশন রোডটি কোন জেলা এবং থানার অধীনে"],
          languageDetected: "bangla",
        },
      },
      {
        step: 3,
        description:
          "Customer provides full 11-digit phone and Bogura district",
        customerAction: {
          senderPhone: "8801746000006",
          text: "sorry typing mistake. phone 01712345678. district Bogura, Station road, House 5.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["অর্ডার", "1200", "120", "1320", "বগুড়া"],
          orderExpected: {
            created: true,
            deliveryZone: "outside_dhaka",
            deliveryFee: 120,
            total: 1320,
            status: "on-hold",
          },
        },
      },
    ],
  },
];

describe("Tier 4 - Real-World Multi-Turn Customer Workloads", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of tier4RealWorldTestCases) {
    test(`${tc.id}: ${tc.name}`, async () => {
      for (const step of tc.steps) {
        if (step.agentAction) {
          const targetPhone = step.agentAction.phone || "8801740000000";
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
          const countBefore = harness.getOutboundReplies(
            step.customerAction.senderPhone,
          ).length;
          await harness.sendCustomerWhatsAppMessage(step.customerAction);
          const replies = harness.getOutboundReplies(
            step.customerAction.senderPhone,
          );

          if (step.expectations.agentShouldReply) {
            expect(replies.length).toBeGreaterThan(countBefore);
            const lastReply = replies[replies.length - 1];
            if (step.expectations.replyMustContain) {
              for (const token of step.expectations.replyMustContain) {
                expect(lastReply.text.toLowerCase()).toContain(
                  token.toLowerCase(),
                );
              }
            }
          } else {
            expect(replies.length).toBe(countBefore);
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
