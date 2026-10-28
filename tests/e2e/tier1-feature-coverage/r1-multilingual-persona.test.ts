import { beforeEach, describe, expect, test } from "bun:test";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const r1MultilingualTestCases: E2ETestCase[] = [
  {
    id: "T1-R1-01",
    name: "Banglish In-Stock Product & Price Inquiry",
    tier: 1,
    feature: "R1",
    description:
      "Customer asks about Black Polo shirt price and size L availability in Banglish. Agent mirrors in polite Banglish.",
    steps: [
      {
        step: 1,
        description: "Customer sends product price & size inquiry in Banglish",
        customerAction: {
          senderPhone: "8801711000001",
          text: "bhai black polo shirt er price koto? size L hobe?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["850", "polo shirt", "L", "available"],
          languageDetected: "banglish",
          tagsExpected: {
            mustNotInclude: ["ai-paused", "complaint", "needs-human"],
          },
        },
      },
    ],
  },
  {
    id: "T1-R1-02",
    name: "Bengali Script Store Greeting & Business Hours",
    tier: 1,
    feature: "R1",
    description:
      "Customer asks store location and opening hours in Bengali script. Agent mirrors in polite Bengali script.",
    steps: [
      {
        step: 1,
        description:
          "Customer asks showroom hours & location in Bengali script",
        customerAction: {
          senderPhone: "8801711000002",
          text: "আসসালামু আলাইকুম, আপনাদের দোকান কি এখন খোলা আছে? শোরুম কোথায়?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["ওয়ালাইকুম আসসালাম", "বনানী", "১০:০০"],
          languageDetected: "bangla",
          tagsExpected: {
            mustNotInclude: ["ai-paused", "complaint"],
          },
        },
      },
    ],
  },
  {
    id: "T1-R1-03",
    name: "English Delivery Fee & SLA Inquiry",
    tier: 1,
    feature: "R1",
    description:
      "Customer asks for Inside Dhaka delivery fee and delivery SLA in English.",
    steps: [
      {
        step: 1,
        description: "Customer inquires about delivery fee in Dhanmondi",
        customerAction: {
          senderPhone: "8801711000003",
          text: "Hello! How much is the delivery charge for Dhanmondi, Dhaka? How long will it take?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["60", "24 to 48 hours", "Dhanmondi"],
          languageDetected: "english",
        },
      },
    ],
  },
  {
    id: "T1-R1-04",
    name: "Code-Mixed Banglish/English Return Policy & Fabric FAQ",
    tier: 1,
    feature: "R1",
    description:
      "Customer asks about fabric type and return policy in code-mixed Banglish/English.",
    steps: [
      {
        step: 1,
        description: "Customer asks about fabric and return policy",
        customerAction: {
          senderPhone: "8801711000004",
          text: "Eta ki 100% cotton fabric? Ar delivery pawar por return kora jabe?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["100% combed cotton", "7", "return policy"],
          languageDetected: "banglish",
        },
      },
    ],
  },
  {
    id: "T1-R1-05",
    name: "Dynamic Language Mirroring Transition",
    tier: 1,
    feature: "R1",
    description:
      "Customer switches from Banglish greeting to Bengali script COD inquiry across turns.",
    steps: [
      {
        step: 1,
        description: "Customer greets in Banglish",
        customerAction: {
          senderPhone: "8801711000005",
          text: "hi bhaiya",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Hello bhaiya"],
          languageDetected: "banglish",
        },
      },
      {
        step: 2,
        description: "Customer asks for Cash on Delivery in Bengali script",
        customerAction: {
          senderPhone: "8801711000005",
          text: "আপনাদের ক্যাশ অন ডেলিভারি আছে?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["ক্যাশ অন ডেলিভারি", "সুবিধা রয়েছে"],
          languageDetected: "bangla",
        },
      },
    ],
  },
];

describe("Tier 1 - Feature R1: Multilingual Conversational Engine & Persona", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of r1MultilingualTestCases) {
    test(`${tc.id}: ${tc.name}`, async () => {
      for (const step of tc.steps) {
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
          } else {
            expect(reply).toBeNull();
          }

          if (step.expectations.tagsExpected?.mustNotInclude) {
            const tags = harness.getContactTags(
              step.customerAction.senderPhone,
            );
            for (const tag of step.expectations.tagsExpected.mustNotInclude) {
              expect(tags).not.toContain(tag);
            }
          }
        }
      }
    });
  }
});
