/**
 * Unit Test Suite for AI Orchestrator Circuit Breakers & Inbound Suppression
 * Location: apps/api/src/services/ai-agent/__tests__/ai-orchestrator.test.ts
 */

import { describe, expect, it } from "bun:test";
import { AiOrchestratorService } from "../ai-orchestrator.service.js";
import { HandoffService } from "../conversation/handoff.service.js";

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
    merchantKnowledgeService.setConnectionSettings(
      "company-123",
      "conn-disabled-1",
      {
        enabled: false,
      },
    );

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

describe("AI Orchestrator Delivery & Runtime Session Resolution", () => {
  function createDeliveryMockDb(options: {
    sessionId?: string | null;
    connectionJid?: string;
    contactConnectionId?: string;
    contactJid?: string;
    isBlocked?: boolean;
  }) {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const insertedMessages: any[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const enqueuedCommands: any[] = [];

    const mockDb = {
      _insertedMessages: insertedMessages,
      _enqueuedCommands: enqueuedCommands,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      selectFrom: (table: string): any => ({
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        select: (_cols?: any) => ({
          // biome-ignore lint/suspicious/noExplicitAny: test mock
          where: (_f1: string, _op1: string, val1: any) => ({
            // biome-ignore lint/suspicious/noExplicitAny: test mock
            where: (_f2: string, _op2: string, _val2: any) => ({
              orderBy: () => ({
                limit: () => ({
                  executeTakeFirst: async () => undefined,
                  execute: async () => [],
                }),
                executeTakeFirst: async () => {
                  if (table === "whatsapp_connection_sessions") {
                    return options.sessionId
                      ? { id: options.sessionId }
                      : undefined;
                  }
                  return undefined;
                },
                execute: async () => [],
              }),
              executeTakeFirst: async () => undefined,
              execute: async () => [],
            }),
            orderBy: () => ({
              limit: () => ({
                executeTakeFirst: async () => undefined,
                execute: async () => [],
              }),
              executeTakeFirst: async () => {
                if (table === "whatsapp_connection_sessions") {
                  return options.sessionId
                    ? { id: options.sessionId }
                    : undefined;
                }
                return undefined;
              },
              execute: async () => [],
            }),
            executeTakeFirst: async () => {
              if (table === "contacts") {
                return {
                  id: val1,
                  is_blocked: options.isBlocked ?? false,
                  whatsapp_connection_id: options.contactConnectionId ?? null,
                  jid: options.contactJid ?? "8801711223344@s.whatsapp.net",
                };
              }
              if (table === "whatsapp_connections") {
                return {
                  jid: options.connectionJid ?? "8801700000000@s.whatsapp.net",
                };
              }
              if (table === "whatsapp_connection_sessions") {
                return options.sessionId
                  ? { id: options.sessionId }
                  : undefined;
              }
              return undefined;
            },
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
      transaction: () => ({
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        execute: async (callback: (trx: any) => Promise<void>) => {
          const trx = {
            getExecutor: () => ({
              compileQuery: () => ({ sql: "SELECT 1", parameters: [] }),
              transformQuery: (node: unknown) => node,
              executeQuery: async () => ({ rows: [] }),
            }),
            insertInto: (table: string) => ({
              // biome-ignore lint/suspicious/noExplicitAny: test mock
              values: (val: any) => ({
                execute: async () => {
                  if (table === "messages") {
                    insertedMessages.push(val);
                  }
                  if (table === "nats_outbox") {
                    enqueuedCommands.push(val);
                  }
                  return { insertId: "mock-id" };
                },
              }),
            }),
          };
          await callback(trx);
        },
      }),
    };

    return mockDb;
  }

  it("resolves activeSessionId and uses it in NATS command subject and payload", async () => {
    const orchestrator = new AiOrchestratorService();
    const mockDb = createDeliveryMockDb({
      sessionId: "session-runtime-xyz",
      connectionJid: "8801700000000@s.whatsapp.net",
    });
    orchestrator.setMockDb(mockDb);
    orchestrator.setGeminiClient({
      generateChatResponse: async () => ({
        text: "Assalamu Alaikum! How can I help you?",
        finishReason: "STOP",
      }),
      // biome-ignore lint/suspicious/noExplicitAny: mock gemini client
    } as any);

    await orchestrator.dispatchInboundMessage({
      companyId: "comp-del-1",
      connectionId: "conn-persistent-1",
      contactId: "contact-del-1",
      contactJid: "8801711223344@s.whatsapp.net",
      messageId: "msg-in-1",
      content: "Hello AI",
      isGroup: false,
    });

    expect(mockDb._insertedMessages.length).toBe(1);
    expect(mockDb._insertedMessages[0].content).toBe(
      "Assalamu Alaikum! How can I help you?",
    );
    expect(mockDb._insertedMessages[0].whatsapp_connection_id).toBe(
      "conn-persistent-1",
    );

    expect(mockDb._enqueuedCommands.length).toBe(1);
    const enqueued = mockDb._enqueuedCommands[0];
    // Subject MUST be WHATSAPP.commands.{companyId}.{activeSessionId}, NOT connectionId
    expect(enqueued.subject).toBe(
      "WHATSAPP.commands.comp-del-1.session-runtime-xyz",
    );
    expect(enqueued.payload.connection_id).toBe("session-runtime-xyz");
  });

  it("resolves targetConnectionId from contact.whatsapp_connection_id when context connectionId is absent", async () => {
    const orchestrator = new AiOrchestratorService();
    const mockDb = createDeliveryMockDb({
      sessionId: "session-contact-fallback",
      contactConnectionId: "conn-from-contact-db",
    });
    orchestrator.setMockDb(mockDb);
    orchestrator.setGeminiClient({
      generateChatResponse: async () => ({
        text: "Resolved from contact record!",
        finishReason: "STOP",
      }),
      // biome-ignore lint/suspicious/noExplicitAny: mock gemini client
    } as any);

    await orchestrator.dispatchInboundMessage({
      companyId: "comp-del-2",
      contactId: "contact-del-2",
      contactJid: "8801711223344@s.whatsapp.net",
      messageId: "msg-in-2",
      content: "Price koto?",
      isGroup: false,
    });

    expect(mockDb._insertedMessages.length).toBe(1);
    expect(mockDb._insertedMessages[0].whatsapp_connection_id).toBe(
      "conn-from-contact-db",
    );

    expect(mockDb._enqueuedCommands.length).toBe(1);
    expect(mockDb._enqueuedCommands[0].subject).toBe(
      "WHATSAPP.commands.comp-del-2.session-contact-fallback",
    );
    expect(mockDb._enqueuedCommands[0].payload.connection_id).toBe(
      "session-contact-fallback",
    );
  });

  it("resolves destinationJid from contact.jid when context contactJid and senderJid are absent", async () => {
    const orchestrator = new AiOrchestratorService();
    const mockDb = createDeliveryMockDb({
      sessionId: "session-jid-fallback",
      connectionJid: "8801700000000@s.whatsapp.net",
      contactConnectionId: "conn-123",
      contactJid: "8801899999999@s.whatsapp.net",
    });
    orchestrator.setMockDb(mockDb);
    orchestrator.setGeminiClient({
      generateChatResponse: async () => ({
        text: "Delivered to resolved contact JID",
        finishReason: "STOP",
      }),
      // biome-ignore lint/suspicious/noExplicitAny: mock gemini client
    } as any);

    await orchestrator.dispatchInboundMessage({
      companyId: "comp-del-jid",
      connectionId: "conn-123",
      contactId: "contact-del-jid",
      // contactJid and senderJid intentionally omitted
      messageId: "msg-in-jid",
      content: "Hello JID fallback",
      isGroup: false,
    });

    expect(mockDb._insertedMessages.length).toBe(1);
    expect(mockDb._enqueuedCommands.length).toBe(1);
    expect(mockDb._enqueuedCommands[0].payload.to).toBe(
      "8801899999999@s.whatsapp.net",
    );
  });

  it("gracefully aborts delivery when active session is not found without inserting pending message", async () => {
    const orchestrator = new AiOrchestratorService();
    const mockDb = createDeliveryMockDb({
      sessionId: null, // No active session
    });
    orchestrator.setMockDb(mockDb);
    orchestrator.setGeminiClient({
      generateChatResponse: async () => ({
        text: "Should not be delivered",
        finishReason: "STOP",
      }),
      // biome-ignore lint/suspicious/noExplicitAny: mock gemini client
    } as any);

    await orchestrator.dispatchInboundMessage({
      companyId: "comp-del-3",
      connectionId: "conn-disconnected-1",
      contactId: "contact-del-3",
      contactJid: "8801711223344@s.whatsapp.net",
      messageId: "msg-in-3",
      content: "Hello disconnected",
      isGroup: false,
    });

    // Delivery aborted gracefully: no orphaned pending message row and no command enqueued
    expect(mockDb._insertedMessages.length).toBe(0);
    expect(mockDb._enqueuedCommands.length).toBe(0);
  });

  it("resolves activeSessionId in handoff escalation customer handover message", async () => {
    const handoffService = new HandoffService();
    const mockDb = createDeliveryMockDb({
      sessionId: "session-handoff-live",
      connectionJid: "8801700000000@s.whatsapp.net",
    });

    // Also support tags table queries for handoff durable tags
    const origSelectFrom = mockDb.selectFrom;
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    mockDb.selectFrom = (table: string): any => {
      if (table === "tags") {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: async () => ({
                id: "tag-1",
                name: "ai-paused",
              }),
            }),
          }),
        };
      }
      if (table === "contact_tags") {
        return {
          select: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: async () => undefined,
              }),
            }),
          }),
          innerJoin: () => ({
            select: () => ({
              where: () => ({
                execute: async () => [],
              }),
            }),
          }),
        };
      }
      return origSelectFrom(table);
    };

    const outcome = await handoffService.executeEscalation({
      companyId: "comp-del-4",
      contactId: "contact-del-4",
      reason: "complaint",
      sentiment: "angry",
      language: "bangla",
      connectionId: "conn-handoff-1",
      contactJid: "8801711223344@s.whatsapp.net",
      providedDb: mockDb,
    });

    expect(outcome.escalated).toBe(true);
    expect(outcome.handoverSent).toBe(true);

    expect(mockDb._insertedMessages.length).toBe(1);
    expect(mockDb._enqueuedCommands.length).toBe(1);
    expect(mockDb._enqueuedCommands[0].subject).toBe(
      "WHATSAPP.commands.comp-del-4.session-handoff-live",
    );
    expect(mockDb._enqueuedCommands[0].payload.connection_id).toBe(
      "session-handoff-live",
    );
  });

  it("setTypingPresence broadcasts typing:start and typing:stop without throwing", async () => {
    const orchestrator = new AiOrchestratorService();
    const mockDb = {
      selectFrom: (table: string) => ({
        select: () => ({
          where: () => ({
            executeTakeFirst: async () => ({
              id: "session-typing-123",
              status: "connected",
            }),
          }),
        }),
      }),
    };

    // Should not throw even with mock environment
    await expect(
      orchestrator.setTypingPresence(
        "company-typing-1",
        "contact-typing-1",
        "conn-typing-1",
        "8801999999999@s.whatsapp.net",
        true,
        mockDb,
      ),
    ).resolves.toBeUndefined();

    await expect(
      orchestrator.setTypingPresence(
        "company-typing-1",
        "contact-typing-1",
        "conn-typing-1",
        "8801999999999@s.whatsapp.net",
        false,
        mockDb,
      ),
    ).resolves.toBeUndefined();
  });
});
