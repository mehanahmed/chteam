/**
 * Unit Test Suite for OmniTeam Trilingual Gemini AI Engine
 * Location: apps/api/src/services/ai-agent/__tests__/gemini-engine.test.ts
 *
 * Covers:
 * - Trilingual Language Mirroring (Banglish, Bengali script, English, Code-switching)
 * - Persona & Bangladeshi cultural retail etiquette adherence ("bhaiya/apu", "apni", greetings)
 * - Automatic dual-model failover (gemini-2.0-flash -> gemini-1.5-flash) under rate limits & outages
 * - Structured entity extraction & 11-digit BD mobile validation
 * - Complaint detection and human handoff triggers
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GeminiOfflineSimulationHarness } from "../testing/gemini-mock-harness.js";

// Shared simulation harness
const harness = new GeminiOfflineSimulationHarness();

// Mock module for @google/genai
mock.module("@google/genai", () => {
  return {
    GoogleGenAI: class MockGoogleGenAI {
      apiKey: string;
      models = {
        generateContent: mock(
          async (params: {
            model: string;
            contents: unknown;
            config?: unknown;
          }) => {
            return harness.handleGenerateContent(params);
          },
        ),
      };
      chats = {
        create: mock((params: { model: string; config?: unknown }) => ({
          sendMessage: mock(async (msg: { message?: unknown } | unknown) => {
            const contents =
              typeof msg === "object" && msg !== null && "message" in msg
                ? (msg as { message: unknown }).message
                : msg;
            return harness.handleGenerateContent({
              model: params.model,
              contents,
              config: params.config,
            });
          }),
        })),
      };
      constructor(opts: { apiKey?: string }) {
        this.apiKey = opts.apiKey || "mock-api-key";
      }
    },
    Type: {
      OBJECT: "OBJECT",
      STRING: "STRING",
      NUMBER: "NUMBER",
      INTEGER: "INTEGER",
      BOOLEAN: "BOOLEAN",
      ARRAY: "ARRAY",
    },
  };
});

// Import Gemini Client (target under test)
import { GeminiClient, GeminiServiceError } from "../gemini/gemini.client.js";
import {
  buildSystemPrompt,
  detectCustomerLanguage,
  TRILINGUAL_RETAIL_PERSONA,
} from "../gemini/prompts.js";

describe("OmniTeam Trilingual Gemini Engine (Milestone 1)", () => {
  let client: GeminiClient;

  beforeEach(() => {
    harness.reset();
    client = new GeminiClient({
      apiKey: "test-api-key-123",
      primaryModel: "gemini-2.0-flash",
      fallbackModel: "gemini-1.5-flash",
    });
  });

  afterEach(() => {
    harness.reset();
  });

  // =========================================================================
  // 1. Model Routing & Automatic Dual-Model Failover
  // =========================================================================
  describe("Model Routing & Automatic Failover", () => {
    test("routes requests to primary model (gemini-2.0-flash) under normal conditions", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "bhai red color ta hobe?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.modelUsed).toBe("gemini-2.0-flash");
      expect(response.isFallback).toBe(false);
      expect(response.text).toContain(
        "Ji bhaiya, red color ta available ache!",
      );
      expect(harness.callHistory.length).toBe(1);
      expect(harness.callHistory[0].model).toBe("gemini-2.0-flash");
    });

    test("automatically fails over to gemini-1.5-flash when primary model encounters HTTP 429 RateLimit", async () => {
      // Simulate rate limit on gemini-2.0-flash
      harness.simulateModelFailure(
        "gemini-2.0-flash",
        429,
        "Quota exceeded for quota metric 'GenerateContent'",
      );

      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "delivery charge koto?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.modelUsed).toBe("gemini-1.5-flash");
      expect(response.isFallback).toBe(true);
      expect(response.text).toContain("delivery charge inside Dhaka 80 Tk");
      // Expect 2 calls: first failed on primary, second succeeded on fallback
      expect(harness.callHistory.length).toBe(2);
      expect(harness.callHistory[0].model).toBe("gemini-2.0-flash");
      expect(harness.callHistory[1].model).toBe("gemini-1.5-flash");
    });

    test("automatically fails over to gemini-1.5-flash when primary model encounters HTTP 503 Server Error", async () => {
      harness.simulateModelFailure(
        "gemini-2.0-flash",
        503,
        "The model is overloaded. Please try again later.",
      );

      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "bhai red color ta hobe?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.modelUsed).toBe("gemini-1.5-flash");
      expect(response.isFallback).toBe(true);
      expect(response.text).toBeTruthy();
    });

    test("throws structured GeminiServiceError when both primary and fallback models fail", async () => {
      harness.simulateModelFailure(
        "gemini-2.0-flash",
        429,
        "Rate limit exceeded",
      );
      harness.simulateModelFailure(
        "gemini-1.5-flash",
        429,
        "Fallback rate limit exceeded",
      );

      let error: GeminiServiceError | null = null;
      try {
        await client.generateChatResponse({
          messages: [{ role: "user", content: "hello" }],
        });
      } catch (err) {
        error = err as GeminiServiceError;
      }

      expect(error).toBeInstanceOf(GeminiServiceError);
      expect(error?.message).toContain(
        "Gemini service unavailable after attempting fallback",
      );
      expect(error?.modelAttempted).toBe("gemini-1.5-flash");
    });

    test("propagates temperature and system instructions faithfully to the API call", async () => {
      await client.generateChatResponse({
        messages: [{ role: "user", content: "bhai red color ta hobe?" }],
        systemInstruction: "Custom System Instruction",
        temperature: 0.1,
      });

      expect(harness.callHistory.length).toBe(1);
      const call = harness.callHistory[0];
      const callConfig = call.config as {
        systemInstruction?: string;
        temperature?: number;
      };
      expect(callConfig.systemInstruction).toBe("Custom System Instruction");
      expect(callConfig.temperature).toBe(0.1);
    });
  });

  // =========================================================================
  // 2. Banglish Conversational Intelligence & Language Mirroring
  // =========================================================================
  describe("Banglish Dialog (Language Mirroring Protocol)", () => {
    test("handles product availability query ('bhai red color ta hobe?') in natural Banglish", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "bhai red color ta hobe?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/Ji bhaiya/i);
      expect(response.text).toMatch(/available ache/i);
      // Negative check: must NOT reply in formal Sanskritized Bengali script or English
      expect(response.text).not.toContain("In our inventory");
      expect(response.text).not.toContain("আমাদের সংগ্রহশালায়");
    });

    test("handles delivery charge inquiry ('delivery charge koto?') with accurate Bangladeshi rate breakdown", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "delivery charge koto?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/80 Tk|60 Tk/); // Inside Dhaka
      expect(response.text).toMatch(/120 Tk|100 Tk/); // Suburbs
      expect(response.text).toMatch(/150 Tk|120 Tk/); // Outside Dhaka
      expect(response.text).toMatch(/Cash on delivery/i);
    });

    test("handles district delivery timeframe query ('chittagong a pathano jabe? koto din lagbe?')", async () => {
      const response = await client.generateChatResponse({
        messages: [
          {
            role: "user",
            content: "chittagong a pathano jabe? koto din lagbe?",
          },
        ],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/Chittagong/i);
      expect(response.text).toMatch(/3.*5.*karjodibosh|3.*5.*din/i);
    });

    test("handles fabric quality and authenticity queries with cultural reassurance", async () => {
      const response = await client.generateChatResponse({
        messages: [
          {
            role: "user",
            content: "vai eta ki original cotton? wash korle color uthbe?",
          },
        ],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/100%.*cotton/i);
      expect(response.text).toMatch(/Ji bhaiya|bhaiya/i);
    });

    test("handles purchase confirmation intent ('bhai order confirm koren, ami nibo')", async () => {
      const response = await client.generateChatResponse({
        messages: [
          { role: "user", content: "bhai order confirm koren, ami nibo" },
        ],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      // Verifies conversational slot prompting for customer info
      expect(response.text).toMatch(/Nam/i);
      expect(response.text).toMatch(/Phone|Mobile/i);
      expect(response.text).toMatch(/Address/i);
    });
  });

  // =========================================================================
  // 3. Bengali Script Intelligence (বাংলা লিপি)
  // =========================================================================
  describe("Bengali Script Dialog (বাংলা ভাষা ও লিপি)", () => {
    test("responds to Outside Dhaka delivery query strictly in Bengali script", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "ঢাকার বাইরে ডেলিভারি চার্জ কত?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      // Assert Bengali script characters are present
      expect(/[\u0980-\u09FF]/.test(response.text)).toBe(true);
      expect(response.text).toContain("ঢাকার বাইরে");
      expect(response.text).toContain("১৫০");
      // Negative check: must NOT output Latin Banglish or English
      expect(response.text).not.toContain("Delivery charge");
      expect(response.text).not.toContain("Bhaiya");
    });

    test("handles variant availability in Bengali script", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "লাল কালারটা কি এভেইলেবল আছে?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(/[\u0980-\u09FF]/.test(response.text)).toBe(true);
      expect(response.text).toMatch(/জি|ভাইয়া|এভেইলেবল/);
    });

    test("confirms Cash on Delivery terms in clean Bengali script", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "ক্যাশ অন ডেলিভারি দেওয়া যাবে কি?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/ক্যাশ অন ডেলিভারি/);
    });

    test("guides order booking details in polite Bengali script", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "আমি অর্ডার করতে চাই" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/নাম/);
      expect(response.text).toMatch(/নাম্বার|মোবাইল/);
      expect(response.text).toMatch(/ঠিকানা/);
    });
  });

  // =========================================================================
  // 4. English Conversational Intelligence
  // =========================================================================
  describe("English Dialog", () => {
    test("responds to size inquiries ('Do you have this in size XL?') in fluent English", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "Do you have this in size XL?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/size XL/i);
      expect(response.text).toMatch(/in stock/i);
      // Negative check: no Bengali script or Banglish
      expect(/[\u0980-\u09FF]/.test(response.text)).toBe(false);
      expect(response.text).not.toMatch(/Ji bhaiya/i);
    });

    test("explains shipping rates and delivery times in professional English", async () => {
      const response = await client.generateChatResponse({
        messages: [
          {
            role: "user",
            content: "What are your shipping rates and delivery times?",
          },
        ],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/Dhaka/i);
      expect(response.text).toMatch(/business days/i);
      expect(response.text).toMatch(/Cash on Delivery/i);
    });

    test("explains return and exchange policies clearly in English", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "What is your return policy?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/exchange policy/i);
    });
  });

  // =========================================================================
  // 5. Code-Switching & Code-Mixing Queries
  // =========================================================================
  describe("Code-Switching & Code-Mixing (Bilingual Queries)", () => {
    test("mirrors natural code-mixing for 'Bhai eta ki cotton fabric? Price koto?'", async () => {
      const response = await client.generateChatResponse({
        messages: [
          {
            role: "user",
            content: "Bhai eta ki cotton fabric? Price koto?",
          },
        ],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/cotton fabric/i);
      expect(response.text).toMatch(/Price/i);
      expect(response.text).toMatch(/Ji bhaiya/i);
    });

    test("retains retail terminology alongside Banglish phrasing", async () => {
      const response = await client.generateChatResponse({
        messages: [
          {
            role: "user",
            content: "Red color size L ache? Cash on delivery te nibo.",
          },
        ],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/size L/i);
      expect(response.text).toMatch(/Cash on delivery/i);
    });
  });

  // =========================================================================
  // 6. Persona Adherence & Cultural Retail Etiquette
  // =========================================================================
  describe("Persona & Cultural Etiquette Adherence", () => {
    test("enforces respectful honorifics ('bhaiya/apu' or 'apni') and rejects 'tui' or 'tumi'", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "vai price koto?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/bhaiya|apu|apni/i);
      expect(response.text).not.toMatch(/\btui\b|\btumi\b/i);
    });

    test("uses culturally warm affirmative markers ('Ji bhaiya', 'Oboshshoi', 'Ekdom')", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "bhai delivery charge koto?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/bhaiya|Oboshshoi|Ekdom/i);
    });

    test("never quotes a deceptive lump-sum; separates product price from delivery fee", async () => {
      const response = await client.generateChatResponse({
        messages: [{ role: "user", content: "delivery charge koto?" }],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      // Price breakdown must be distinguishable
      expect(response.text).toMatch(/inside Dhaka/i);
      expect(response.text).toMatch(/outside Dhaka/i);
    });
  });

  // =========================================================================
  // 7. Complaint & Human Escalation Triggers
  // =========================================================================
  describe("Complaint Detection & Human Handoff Triggers", () => {
    test("detects abusive or frustrated customer message and initiates polite apology and handoff", async () => {
      const response = await client.generateChatResponse({
        messages: [
          {
            role: "user",
            content:
              "Faltu service apnader! 1 soptaho dhore delivery painai! Taka ferot den!",
          },
        ],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/dukhito|apologize|human support|agent/i);
    });

    test("detects explicit customer request for a human agent ('Amar human agent lagbe')", async () => {
      const response = await client.generateChatResponse({
        messages: [
          {
            role: "user",
            content: "Amar human agent lagbe, manush er sathe kotha bolbo",
          },
        ],
        systemInstruction: TRILINGUAL_RETAIL_PERSONA,
      });

      expect(response.text).toMatch(/representative|human agent|connect/i);
    });
  });

  // =========================================================================
  // 8. Script & Language Detector Tests
  // =========================================================================
  describe("Language & Script Detector Heuristic", () => {
    test("detects pure Banglish queries", () => {
      expect(detectCustomerLanguage("bhai delivery charge koto?")).toBe(
        "banglish",
      );
      expect(detectCustomerLanguage("vai red color ta hobe?")).toBe("banglish");
      expect(detectCustomerLanguage("order confirm koren bhaiya")).toBe(
        "banglish",
      );
      expect(detectCustomerLanguage("chittagong a delivery pabo?")).toBe(
        "banglish",
      );
    });

    test("detects Bengali script queries", () => {
      expect(detectCustomerLanguage("ঢাকার বাইরে ডেলিভারি কত দিন লাগবে?")).toBe(
        "bangla",
      );
      expect(detectCustomerLanguage("পণ্যটির দাম কত?")).toBe("bangla");
    });

    test("detects English queries", () => {
      expect(detectCustomerLanguage("What is the price of this jacket?")).toBe(
        "english",
      );
      expect(detectCustomerLanguage("Do you ship internationally?")).toBe(
        "english",
      );
    });

    test("detects code-mixed queries", () => {
      expect(detectCustomerLanguage("দাম কত bhaiya? ডেলিভারি charge কত?")).toBe(
        "mixed",
      );
    });

    test("builds prompt with custom merchant context", () => {
      const prompt = buildSystemPrompt({
        storeName: "Dhaka Artisans",
        personaName: "Nusrat",
        personaTone: "friendly",
        businessHoursText: "10:00 AM - 8:00 PM BST",
        isWithinBusinessHours: true,
        insideDhakaFee: 70,
        subDhakaFee: 110,
        outsideDhakaFee: 140,
        outsideDhakaAdvanceRequired: true,
        outsideDhakaAdvanceAmount: 140,
        paymentMethods: ["Cash on Delivery", "bKash"],
      });

      expect(prompt).toContain("Dhaka Artisans");
      expect(prompt).toContain("Nusrat");
      expect(prompt).toContain("৳70");
      expect(prompt).toContain("৳140");
      expect(prompt).toContain("LANGUAGE MIRRORING PROTOCOL");
    });
  });
});
