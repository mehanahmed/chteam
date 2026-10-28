import { beforeEach, describe, expect, test } from "bun:test";
import {
  BKASH_RECEIPT_CROPPED,
  COMPETITOR_SCREENSHOT_AARONG,
  CORRUPTED_ZERO_BYTE,
  LOW_RES_BLURRY_IMAGE,
  MULTI_PRODUCT_COLLAGE,
  NON_PRODUCT_IMAGE_MEME,
} from "../harness/fixtures/sample-receipts.js";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const r2BoundaryTestCases: E2ETestCase[] = [
  {
    id: "TC-T2-R2-01",
    name: "Low-Resolution / Completely Blurry Image",
    tier: 2,
    feature: "R2",
    description:
      "System receives unreadable pixelated image (<0.40 confidence) and politely asks for a clearer photo.",
    steps: [
      {
        step: 1,
        description: "Customer sends blurry photo",
        customerAction: {
          senderPhone: "8801722000001",
          media: LOW_RES_BLURRY_IMAGE,
          text: "eta ache?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["ছবিটি পরিষ্কারভাবে বোঝা যাচ্ছে না", "স্পষ্ট ছবি"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R2-02",
    name: "Irrelevant Non-Product Image (Selfie, Meme, Landscape)",
    tier: 2,
    feature: "R2",
    description:
      "System classifies non-commercial image without attempting catalog search and replies courteously.",
    steps: [
      {
        step: 1,
        description: "Customer sends cat meme",
        customerAction: {
          senderPhone: "8801722000002",
          media: NON_PRODUCT_IMAGE_MEME,
          text: "bhai eta koto?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["আমাদের শপের কোনো প্রোডাক্ট নয়", "ক্যাটালগ"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R2-03",
    name: "Multi-Product Catalog Grid Screenshot (4 Products in 1 Image)",
    tier: 2,
    feature: "R2",
    description:
      "System detects collage of 4 Kurtis and prompts customer for specific color/variant selection.",
    steps: [
      {
        step: 1,
        description: "Customer sends collage screenshot",
        customerAction: {
          senderPhone: "8801722000003",
          media: MULTI_PRODUCT_COLLAGE,
          text: "ei design ta lagbe",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["৪টি কালার", "কোন কালারটি"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R2-04",
    name: "Competitor Ad Screenshot with Foreign Watermark & Unavailable Item",
    tier: 2,
    feature: "R2",
    description:
      "Customer sends screenshot of competitor product (Aarong). AI clarifies not in stock and suggests similar items.",
    steps: [
      {
        step: 1,
        description: "Customer sends Aarong screenshot",
        customerAction: {
          senderPhone: "8801722000004",
          media: COMPETITOR_SCREENSHOT_AARONG,
          text: "same to same eta hobe?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: [
            "হুবহু এই ব্র্যান্ডের মডেলটি আমাদের নেই",
            "Emerald Green Georgette Party Gown",
          ],
          languageDetected: "banglish",
        },
      },
    ],
  },
  {
    id: "TC-T2-R2-05",
    name: "Corrupted Media Buffer / Zero-Byte Payload / Unsupported MIME Type",
    tier: 2,
    feature: "R2",
    description:
      "System receives corrupted media / unsupported MIME type and prompts for regular JPG or PNG.",
    steps: [
      {
        step: 1,
        description: "Customer sends corrupted executable file",
        customerAction: {
          senderPhone: "8801722000005",
          media: CORRUPTED_ZERO_BYTE,
          text: "image pathalam",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["ফরম্যাটটি সাপোর্টেড নয়", "JPG বা PNG"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "TC-T2-R2-06",
    name: "Obscured / Partial bKash Payment Receipt",
    tier: 2,
    feature: "R2",
    description:
      "Customer sends cropped bKash receipt where TrxID is incomplete. System prompts for full 8-10 digit TrxID.",
    steps: [
      {
        step: 1,
        description: "Customer sends cropped bKash screenshot",
        customerAction: {
          senderPhone: "8801722000006",
          media: BKASH_RECEIPT_CROPPED,
          text: "advance pathiyechi",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: [
            "TrxID",
            "সম্পূর্ণ দেখা যাচ্ছে না",
            "ডিজিটের সম্পূর্ণ TrxID",
          ],
          languageDetected: "bangla",
        },
      },
    ],
  },
];

describe("Tier 2 - Feature R2: Boundary & Corner Cases", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of r2BoundaryTestCases) {
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
        }
      }
    });
  }
});
