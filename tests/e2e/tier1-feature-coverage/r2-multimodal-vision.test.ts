import { beforeEach, describe, expect, test } from "bun:test";
import {
  BKASH_RECEIPT_VALID_120,
  LOW_RES_BLURRY_IMAGE,
  NON_PRODUCT_IMAGE_MEME,
  PRODUCT_SCREENSHOT_KURTI,
  PRODUCT_SCREENSHOT_PANJABI,
} from "../harness/fixtures/sample-receipts.js";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const r2VisionTestCases: E2ETestCase[] = [
  {
    id: "T1-R2-01",
    name: "Merchant Post Screenshot with Text Overlay & Price",
    tier: 1,
    feature: "R2",
    description:
      "Customer sends screenshot of Facebook post showing Panjabi with price ৳1800. OCR extracts text and matches catalog.",
    steps: [
      {
        step: 1,
        description: "Customer sends Facebook screenshot",
        customerAction: {
          senderPhone: "8801712000001",
          media: PRODUCT_SCREENSHOT_PANJABI,
          text: "eta hobe?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["1800", "PANJ-BLK-01", "40", "42", "44"],
          languageDetected: "banglish",
        },
      },
    ],
  },
  {
    id: "T1-R2-02",
    name: "Garment Photo without Text (Visual Catalog Match)",
    tier: 1,
    feature: "R2",
    description:
      "Customer sends raw garment photo of maroon floral kurti without text. Visual features match catalog product.",
    steps: [
      {
        step: 1,
        description: "Customer sends photo of floral kurti",
        customerAction: {
          senderPhone: "8801712000002",
          media: PRODUCT_SCREENSHOT_KURTI,
          text: "ei dress tar price koto?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Floral Georgette Kurti", "1450", "size"],
          languageDetected: "banglish",
        },
      },
    ],
  },
  {
    id: "T1-R2-03",
    name: "bKash Mobile Transfer Receipt OCR Extraction",
    tier: 1,
    feature: "R2",
    description:
      "Customer uploads screenshot of bKash transfer confirmation for ৳120 advance. OCR extracts TrxID and amount.",
    steps: [
      {
        step: 1,
        description: "Customer uploads bKash screenshot",
        customerAction: {
          senderPhone: "8801712000003",
          media: BKASH_RECEIPT_VALID_120,
          text: "advance payment korechi",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["9K87LM54", "120"],
          languageDetected: "bangla",
        },
      },
    ],
  },
  {
    id: "T1-R2-04",
    name: "Non-Catalog Product Image Rejection",
    tier: 1,
    feature: "R2",
    description:
      "Customer sends non-catalog / meme image. System recognizes non-product and politely clarifies catalog scope.",
    steps: [
      {
        step: 1,
        description: "Customer sends non-catalog image",
        customerAction: {
          senderPhone: "8801712000004",
          media: NON_PRODUCT_IMAGE_MEME,
          text: "eta pawa jabe?",
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
    id: "T1-R2-05",
    name: "Low-Resolution / Blurry Image Disambiguation",
    tier: 1,
    feature: "R2",
    description:
      "Customer sends pixelated/blurry image (<0.50 confidence). System politely prompts for clearer photo.",
    steps: [
      {
        step: 1,
        description: "Customer sends blurry photo",
        customerAction: {
          senderPhone: "8801712000005",
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
];

describe("Tier 1 - Feature R2: Multimodal Vision & Image Recognition", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of r2VisionTestCases) {
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
