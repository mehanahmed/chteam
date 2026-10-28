/**
 * Unit Test Suite for AI Orchestrator Circuit Breakers & Inbound Suppression
 * Location: apps/api/src/services/ai-agent/__tests__/ai-orchestrator.test.ts
 */

import { describe, expect, it } from "bun:test";
import { AiOrchestratorService } from "../ai-orchestrator.service.js";

describe("AI Orchestrator Circuit Breakers", () => {
  const orchestrator = new AiOrchestratorService();

  it("suppresses reply for group messages", async () => {
    const decision = await orchestrator.evaluateSuppression(
      "company-123",
      "contact-456",
      true, // isGroup = true
      "Hello, can anyone help?",
    );

    expect(decision.isSuppressed).toBe(true);
    expect(decision.reason).toBe("group_message");
  });

  it("suppresses reply for empty content", async () => {
    const decision = await orchestrator.evaluateSuppression(
      "company-123",
      "contact-456",
      false,
      "",
    );

    expect(decision.isSuppressed).toBe(true);
    expect(decision.reason).toBe("empty_content");
  });

  it("suppresses reply for whitespace-only content", async () => {
    const decision = await orchestrator.evaluateSuppression(
      "company-123",
      "contact-456",
      false,
      "    \n  \t  ",
    );

    expect(decision.isSuppressed).toBe(true);
    expect(decision.reason).toBe("empty_content");
  });

  it("fails safe when database query encounters an error", async () => {
    const decision = await orchestrator.evaluateSuppression(
      "company-123",
      "contact-456",
      false,
      "bhai delivery charge koto?",
    );

    // Without DB connection, suppression catcher gracefully handles error and fails safe
    expect(decision.isSuppressed).toBe(true);
    expect(decision.shouldSuppress).toBe(true);
    expect(decision.reason).toBe("db_error_fail_safe");
  });

  it("allows proceeding when message is 1-on-1, valid content, and clean database state", async () => {
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

    const decision = await orchestrator.evaluateSuppression(
      "company-123",
      "contact-456",
      false,
      "bhai delivery charge koto?",
    );

    expect(decision.isSuppressed).toBe(false);
    expect(decision.shouldSuppress).toBe(false);
  });

  it("suppresses reply when AI is disabled for a specific connection", async () => {
    const { merchantKnowledgeService } = await import(
      "../merchant-knowledge.service.js"
    );
    merchantKnowledgeService.setConnectionSettings("company-123", "conn-disabled-1", {
      enabled: false,
    });

    const decision = await orchestrator.evaluateSuppression(
      "company-123",
      "contact-456",
      false,
      "bhai delivery charge koto?",
      false,
      "conn-disabled-1",
    );

    expect(decision.isSuppressed).toBe(true);
    expect(decision.reason).toBe("ai_disabled_for_connection");
  });
});
