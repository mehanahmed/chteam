/**
 * Unit Test Suite for Merchant Knowledge Service
 * Location: apps/api/src/services/ai-agent/__tests__/merchant-knowledge.test.ts
 */

import { describe, expect, it } from "bun:test";
import { merchantKnowledgeService } from "../merchant-knowledge.service.js";

describe("Merchant Knowledge Service", () => {
  it("provides default settings for Bangladeshi social commerce", async () => {
    const settings =
      await merchantKnowledgeService.getMerchantSettings("comp-1");

    expect(settings.enabled).toBe(true);
    expect(settings.personaName).toBe("Maya");
    expect(settings.insideDhakaFee).toBe(80);
    expect(settings.outsideDhakaFee).toBe(150);
    expect(settings.outsideDhakaAdvanceRequired).toBe(true);
    expect(settings.outsideDhakaAdvanceAmount).toBe(120);
    expect(settings.paymentMethods).toContain("Cash on Delivery (COD)");
    expect(settings.paymentMethods).toContain("bKash Merchant");
  });

  it("returns standard e-commerce retail FAQs", async () => {
    const faqs = await merchantKnowledgeService.getStoreFaqs("comp-1");

    expect(faqs.length).toBeGreaterThanOrEqual(4);
    const questions = faqs.map((f) => f.question);
    expect(questions.some((q) => q.includes("Delivery charge"))).toBe(true);
    expect(questions.some((q) => q.includes("Cash on delivery"))).toBe(true);
    expect(questions.some((q) => q.includes("exchange"))).toBe(true);
  });

  it("checks business hours status with default timezone Asia/Dhaka", async () => {
    const hours =
      await merchantKnowledgeService.getBusinessHoursStatus("comp-1");

    expect(hours.timezone).toBe("Asia/Dhaka");
    expect(typeof hours.isWithin).toBe("boolean");
    expect(hours.description).toContain("Saturday to Thursday");
  });

  it("builds complete prompt context for prompt generator", async () => {
    const context = await merchantKnowledgeService.buildPromptContext("comp-1");

    expect(context.personaName).toBe("Maya");
    expect(context.insideDhakaFee).toBe(80);
    expect(context.outsideDhakaFee).toBe(150);
    expect(context.faqs?.length).toBeGreaterThanOrEqual(4);
  });

  it("stores and builds per-connection custom prompt instructions", async () => {
    merchantKnowledgeService.setConnectionSettings("comp-1", "conn-999", {
      personaName: "Tanzila",
      personaTone: "formal",
      storeName: "Elite Collection",
      customInstructions: "Always offer free gift wrap for orders over 2000 Tk",
      insideDhakaFee: 60,
      outsideDhakaFee: 130,
    });

    const connContext = await merchantKnowledgeService.buildPromptContext(
      "comp-1",
      "conn-999",
    );

    expect(connContext.personaName).toBe("Tanzila");
    expect(connContext.personaTone).toBe("formal");
    expect(connContext.storeName).toBe("Elite Collection");
    expect(connContext.customInstructions).toContain("free gift wrap");
    expect(connContext.insideDhakaFee).toBe(60);
    expect(connContext.outsideDhakaFee).toBe(130);
  });
});
