/**
 * Unit Test Suite for Milestone 5:
 * Complaint Detection, Human Handoff, Durable Tagging & UI Controls
 * Location: apps/api/src/services/ai-agent/__tests__/handoff.test.ts
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { AiOrchestratorService } from "../ai-orchestrator.service.js";
import { AI_TAGS, SYSTEM_AI_USER_ID } from "../constants.js";
import {
  getCustomerHandoverMessage,
  HandoffService,
  handoffService,
} from "../conversation/handoff.service.js";

// Helper to simulate the Kysely SQL execution behavior for handoff tests
type MockDbConfig = {
  isBlocked?: boolean;
  activeAssignment?: {
    assigned_to: string | null;
    unassigned_at: Date | null;
  } | null;
  tags?: Array<{ id?: string; name: string; color?: string | null }>;
  contactTags?: Array<{ contact_id: string; tag_id: string }>;
  lastOutbound?: { sent_by_user_id: string | null; from_me: boolean } | null;
  dbThrows?: boolean;
  messages?: any[];
  contacts?: Array<{ id: string }>;
};

function createMockHandoffDb(config: MockDbConfig) {
  if (config.dbThrows) {
    return {
      selectFrom: (): any => {
        throw new Error("FATAL: Mock database connection error");
      },
    };
  }

  const tagsList: Array<{ id: string; name: string; color: string | null }> = (
    config.tags || []
  ).map((t, idx) => ({
    id: t.id || `tag-${idx + 1}`,
    name: t.name,
    color: t.color || null,
  }));

  const contactTagsList: Array<{ contact_id: string; tag_id: string }> =
    config.contactTags ||
    tagsList.map((t) => ({ contact_id: "contact-123", tag_id: t.id }));

  const messagesList: any[] = config.messages || [];

  return {
    _tags: tagsList,
    _contactTags: contactTagsList,
    _messages: messagesList,
    selectFrom: (table: string): any => {
      if (table === "contacts") {
        return {
          select: () => ({
            where: (_f: string, _op: string, val: string) => ({
              executeTakeFirst: async () => {
                if (config.contacts) {
                  return config.contacts.find((c) => c.id === val);
                }
                return { id: val, is_blocked: config.isBlocked || false };
              },
            }),
          }),
        };
      }

      if (table === "tags") {
        return {
          select: () => ({
            where: (_f: string, _op: string, tagName: string) => ({
              executeTakeFirst: async () => {
                return tagsList.find(
                  (t) => t.name.toLowerCase() === tagName.toLowerCase(),
                );
              },
            }),
          }),
        };
      }

      if (table === "contact_tags") {
        return {
          select: () => ({
            where: (_f1: string, _op1: string, contactId: string) => ({
              where: (_f2: string, _op2: string, tagId: string) => ({
                executeTakeFirst: async () => {
                  return contactTagsList.find(
                    (ct) => ct.contact_id === contactId && ct.tag_id === tagId,
                  );
                },
              }),
            }),
          }),
          innerJoin: (_t: string, _col1: string, _col2: string) => ({
            select: () => ({
              where: (_f: string, _op: string, contactId: string) => ({
                execute: async () => {
                  const linkedTagIds = contactTagsList
                    .filter((ct) => ct.contact_id === contactId)
                    .map((ct) => ct.tag_id);
                  return tagsList.filter((t) => linkedTagIds.includes(t.id));
                },
              }),
            }),
          }),
        };
      }

      if (table === "contact_assignments") {
        return {
          select: () => ({
            where: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    executeTakeFirst: async () => {
                      if (!config.activeAssignment) return undefined;
                      if (config.activeAssignment.unassigned_at !== null)
                        return undefined;
                      return {
                        assigned_to: config.activeAssignment.assigned_to,
                      };
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "messages") {
        return {
          select: () => ({
            where: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    executeTakeFirst: async () => {
                      return config.lastOutbound;
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "whatsapp_connections") {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: async () => ({
                jid: "8801711000000@s.whatsapp.net",
              }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          executeTakeFirst: async () => undefined,
          execute: async () => [],
        }),
      };
    },
    insertInto: (table: string): any => {
      return {
        values: (val: any) => ({
          execute: async () => {
            if (table === "tags") {
              tagsList.push({
                id: val.id || `tag-${tagsList.length + 1}`,
                name: val.name,
                color: val.color || null,
              });
            } else if (table === "contact_tags") {
              contactTagsList.push({
                contact_id: val.contact_id,
                tag_id: val.tag_id,
              });
            } else if (table === "messages") {
              messagesList.push(val);
            }
            return { insertId: "mock-id" };
          },
        }),
      };
    },
    deleteFrom: (table: string): any => {
      return {
        where: (_f1: string, _op1: string, contactId: string) => ({
          where: (_f2: string, _op2: string, tagId: string) => ({
            execute: async () => {
              if (table === "contact_tags") {
                const idx = contactTagsList.findIndex(
                  (ct) => ct.contact_id === contactId && ct.tag_id === tagId,
                );
                if (idx !== -1) {
                  contactTagsList.splice(idx, 1);
                }
              }
              return { numDeletedRows: 1n };
            },
          }),
        }),
      };
    },
    transaction: () => ({
      execute: async (fn: any) => {
        return fn({
          insertInto: (table: string) => ({
            values: (val: any) => ({
              execute: async () => {
                if (table === "messages") messagesList.push(val);
                return { insertId: "mock-id" };
              },
            }),
          }),
        });
      },
    }),
  };
}

describe("Handoff Service - Complaint & Abuse Detection", () => {
  const service = new HandoffService();

  describe("Bangla complaint detection", () => {
    it("detects bad quality and refund demand in Bengali script", () => {
      const result = service.evaluateHandoff(
        "আপনার প্রোডাক্ট খুবই খারাপ এবং নষ্ট, টাকা ফেরত চাই",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
      expect(result.sentiment).toBe("angry");
      expect(result.customerHandoverText).toBeDefined();
    });

    it("detects damaged product complaint in Bengali", () => {
      const result = service.evaluateHandoff(
        "পার্সেলটা ভাঙা অবস্থায় পেয়েছি, প্রোডাক্ট ড্যামেজ",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
      expect(result.sentiment).toBe("negative");
    });

    it("detects scam/fraud accusations with extreme anger in Bengali", () => {
      const result = service.evaluateHandoff(
        "আপনারা বাটপার এবং প্রতারক, পুলিশ কেস করব কালকে",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
      expect(result.sentiment).toBe("angry");
    });

    it("detects delivery delay and not delivered complaint in Bengali", () => {
      const result = service.evaluateHandoff(
        "৭ দিন পার হয়ে গেল কিন্তু ডেলিভারি পাইনি",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
    });

    it("detects wrong product delivered complaint in Bengali", () => {
      const result = service.evaluateHandoff("আমাকে সম্পূর্ণ ভুল প্রোডাক্ট পাঠিয়েছেন");
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
    });
  });

  describe("Banglish complaint detection", () => {
    it("detects bad service and delivery failure in Banglish", () => {
      const result = service.evaluateHandoff(
        "bhai apnader service khub kharap, deliver hoy nai ekhono",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
      expect(result.sentiment).toBe("angry");
    });

    it("detects wrong product and refund request in Banglish", () => {
      const result = service.evaluateHandoff(
        "vul product disen, tk ferot den please",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
      expect(result.sentiment).toBe("angry");
    });

    it("detects damaged/vanga product in Banglish", () => {
      const result = service.evaluateHandoff(
        "product ta pura vanga ashche, faltu packaging",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
      expect(result.sentiment).toBe("angry");
    });

    it("detects fraud / scammer accusations in Banglish", () => {
      const result = service.evaluateHandoff(
        "apnara ekta fraud company, churi kortesen manusher taka",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
      expect(result.sentiment).toBe("angry");
    });

    it("detects return request with baje experience in Banglish", () => {
      const result = service.evaluateHandoff(
        "ekdom baje item, ami return korte chai",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
    });
  });

  describe("English complaint detection", () => {
    it("detects scam and refund demands in English", () => {
      const result = service.evaluateHandoff(
        "This is a complete scam, you are scammers, refund my money!",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
      expect(result.sentiment).toBe("angry");
    });

    it("detects wrong product and damaged goods in English", () => {
      const result = service.evaluateHandoff(
        "I received the wrong product and it was already broken and damaged.",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
      expect(result.sentiment).toBe("angry");
    });

    it("detects missing delivery in English", () => {
      const result = service.evaluateHandoff(
        "My order was not delivered, please return my payment",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("complaint");
    });
  });

  describe("Non-complaint normal purchase queries (negative control)", () => {
    it("does not trigger handoff for product availability check", () => {
      const result = service.evaluateHandoff(
        "bhai red color ta hobe? price koto?",
      );
      expect(result.shouldHandoff).toBe(false);
      expect(result.sentiment).toBe("neutral");
    });

    it("does not trigger handoff for delivery charge inquiry", () => {
      const result = service.evaluateHandoff(
        "delivery charge koto outside dhaka te?",
      );
      expect(result.shouldHandoff).toBe(false);
    });

    it("does not trigger handoff for standard order confirmation", () => {
      const result = service.evaluateHandoff(
        "Assalamu Alaikum, order confirm koren",
      );
      expect(result.shouldHandoff).toBe(false);
    });

    it("does not trigger handoff for English product query", () => {
      const result = service.evaluateHandoff(
        "Do you have size XL in black in stock?",
      );
      expect(result.shouldHandoff).toBe(false);
    });
  });
});

describe("Handoff Service - Explicit Human Request Detection", () => {
  const service = new HandoffService();

  describe("Banglish human requests", () => {
    it("detects 'manush' request", () => {
      const result = service.evaluateHandoff(
        "ami ekjon manusher sathe kotha bolbo",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("human_requested");
      expect(result.sentiment).toBe("neutral");
    });

    it("detects 'live agent' request", () => {
      const result = service.evaluateHandoff(
        "please connect me to a live agent",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("human_requested");
    });

    it("detects 'admin' request", () => {
      const result = service.evaluateHandoff("admin er sathe kotha bolte chai");
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("human_requested");
    });

    it("detects 'call me' request", () => {
      const result = service.evaluateHandoff("bhai amake call me, phone den");
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("human_requested");
    });
  });

  describe("Bangla human requests", () => {
    it("detects representative request in Bengali", () => {
      const result = service.evaluateHandoff(
        "আমি একজন প্রতিনিধির সাথে কথা বলতে চাই",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("human_requested");
    });

    it("detects phone call request in Bengali", () => {
      const result = service.evaluateHandoff("দয়া করে আমাকে ফোন দিন");
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("human_requested");
    });
  });

  describe("English human requests", () => {
    it("detects human representative request in English", () => {
      const result = service.evaluateHandoff(
        "I want to speak with a human representative please",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("human_requested");
    });

    it("detects customer care agent in English", () => {
      const result = service.evaluateHandoff(
        "Can I talk to agent from customer care?",
      );
      expect(result.shouldHandoff).toBe(true);
      expect(result.reason).toBe("human_requested");
    });
  });
});

describe("Handoff Service - Domain Confusion Detection", () => {
  const service = new HandoffService();

  it("triggers handoff when consecutiveLowConfidence is 2 or more", () => {
    const result = service.evaluateHandoff(
      "ami wholesale e 500 piece nibo rate koto",
      {
        consecutiveLowConfidence: 2,
      },
    );
    expect(result.shouldHandoff).toBe(true);
    expect(result.reason).toBe("confusion");
  });

  it("triggers handoff when confidence score is below 0.60 with prior low confidence turn", () => {
    const result = service.evaluateHandoff(
      "can you customize embroidery on chest?",
      {
        confidenceScore: 0.45,
        consecutiveLowConfidence: 1,
      },
    );
    expect(result.shouldHandoff).toBe(true);
    expect(result.reason).toBe("confusion");
  });

  it("does not trigger confusion handoff on single normal turn", () => {
    const result = service.evaluateHandoff("apnader shop koi?", {
      consecutiveLowConfidence: 0,
      confidenceScore: 0.95,
    });
    expect(result.shouldHandoff).toBe(false);
  });
});

describe("Handoff Service - Contextual Handover Messages", () => {
  it("provides empathetic apology for complaints in Bangla", () => {
    const msg = getCustomerHandoverMessage("complaint", "bangla");
    expect(msg).toContain("আন্তরিকভাবে দুঃখিত");
    expect(msg).toContain("কাস্টমার সাপোর্ট");
  });

  it("provides reassuring message for complaints in Banglish", () => {
    const msg = getCustomerHandoverMessage("complaint", "banglish");
    expect(msg).toContain("ontorikbhabe dukhito");
    expect(msg).toContain("customer support");
  });

  it("provides polite message for human requests in English", () => {
    const msg = getCustomerHandoverMessage("human_requested", "english");
    expect(msg).toContain("representative");
    expect(msg).toContain("reply");
  });

  it("provides polite notification for out of scope / confusion", () => {
    const msg = getCustomerHandoverMessage("confusion", "bangla");
    expect(msg).toContain("আমাদের টিম মেম্বারকে জানানো হয়েছে");
  });
});

describe("Handoff Service - Circuit Breakers (shouldSuppressAiReply)", () => {
  const service = new HandoffService();

  it("suppresses reply if contact has 'ai-paused' tag", async () => {
    const mockDb = createMockHandoffDb({
      tags: [{ id: "tag-1", name: "ai-paused" }],
      contactTags: [{ contact_id: "c-100", tag_id: "tag-1" }],
    });

    const status = await service.shouldSuppressAiReply(mockDb, "c-100");
    expect(status.isSuppressed).toBe(true);
    expect(status.reason).toContain("ai-paused");
  });

  it("suppresses reply case-insensitively if contact has 'AI-PAUSED' tag", async () => {
    const mockDb = createMockHandoffDb({
      tags: [{ id: "tag-1", name: "AI-PAUSED" }],
      contactTags: [{ contact_id: "c-100", tag_id: "tag-1" }],
    });

    const status = await service.shouldSuppressAiReply(mockDb, "c-100");
    expect(status.isSuppressed).toBe(true);
    expect(status.reason).toContain("ai-paused");
  });

  it("suppresses reply if contact is actively assigned to a human agent", async () => {
    const mockDb = createMockHandoffDb({
      activeAssignment: {
        assigned_to: "agent-user-uuid",
        unassigned_at: null,
      },
    });

    const status = await service.shouldSuppressAiReply(mockDb, "c-100");
    expect(status.isSuppressed).toBe(true);
    expect(status.reason).toContain("Assigned to human agent");
  });

  it("suppresses reply if last outbound message was manually sent by a human agent", async () => {
    const mockDb = createMockHandoffDb({
      lastOutbound: {
        from_me: true,
        sent_by_user_id: "real-agent-uuid-123",
      },
    });

    const status = await service.shouldSuppressAiReply(mockDb, "c-100");
    expect(status.isSuppressed).toBe(true);
    expect(status.reason).toContain("manually sent by human agent");
  });

  it("allows reply if last outbound was sent by autonomous AI system user", async () => {
    const mockDb = createMockHandoffDb({
      lastOutbound: {
        from_me: true,
        sent_by_user_id: SYSTEM_AI_USER_ID,
      },
    });

    const status = await service.shouldSuppressAiReply(mockDb, "c-100");
    expect(status.isSuppressed).toBe(false);
  });

  it("fails safe when database query encounters an error", async () => {
    const mockDb = createMockHandoffDb({ dbThrows: true });

    const status = await service.shouldSuppressAiReply(mockDb, "c-100");
    expect(status.isSuppressed).toBe(true);
    expect(status.reason).toBe("db_error_fail_safe");
  });
});

describe("Handoff Service - Escalation Action & Tag Application", () => {
  it("applies ai-paused, needs-human, and complaint tags for complaint escalation", async () => {
    const service = new HandoffService();
    const mockDb = createMockHandoffDb({});
    service.setMockDb(mockDb);

    const outcome = await service.executeEscalation({
      companyId: "company-1",
      contactId: "contact-123",
      reason: "complaint",
      sentiment: "angry",
      language: "bangla",
      providedDb: mockDb,
    });

    expect(outcome.escalated).toBe(true);
    expect(outcome.appliedTags).toContain(AI_TAGS.AI_PAUSED);
    expect(outcome.appliedTags).toContain(AI_TAGS.NEEDS_HUMAN);
    expect(outcome.appliedTags).toContain(AI_TAGS.COMPLAINT);

    // Verify durable tag entries in mock DB
    const tagNames = (mockDb._tags || []).map((t: any) => t.name.toLowerCase());
    expect(tagNames).toContain("ai-paused");
    expect(tagNames).toContain("needs-human");
    expect(tagNames).toContain("complaint");
  });

  it("applies only ai-paused and needs-human for explicit human agent requests", async () => {
    const service = new HandoffService();
    const mockDb = createMockHandoffDb({});
    service.setMockDb(mockDb);

    const outcome = await service.executeEscalation({
      companyId: "company-1",
      contactId: "contact-123",
      reason: "human_requested",
      language: "english",
      providedDb: mockDb,
    });

    expect(outcome.escalated).toBe(true);
    expect(outcome.appliedTags).toContain(AI_TAGS.AI_PAUSED);
    expect(outcome.appliedTags).toContain(AI_TAGS.NEEDS_HUMAN);
    expect(outcome.appliedTags).not.toContain(AI_TAGS.COMPLAINT);
  });
});

describe("Handoff Service - Pause, Resume and Status Workflow", () => {
  it("pauses AI, adds ai-paused tag, and returns status isPaused: true", async () => {
    const service = new HandoffService();
    const mockDb = createMockHandoffDb({});
    service.setMockDb(mockDb);

    const pauseResult = await service.pauseAi(
      "company-1",
      "contact-123",
      "manual_click",
      "user-1",
      mockDb,
    );
    expect(pauseResult.success).toBe(true);
    expect(pauseResult.isPaused).toBe(true);

    const status = await service.getAiStatus(
      "company-1",
      "contact-123",
      mockDb,
    );
    expect(status.isPaused).toBe(true);
    expect(status.tags).toContain("ai-paused");
  });

  it("resumes AI, removes ai-paused and needs-human tags, and updates isPaused: false", async () => {
    const service = new HandoffService();
    const mockDb = createMockHandoffDb({
      tags: [
        { id: "t1", name: "ai-paused" },
        { id: "t2", name: "needs-human" },
      ],
      contactTags: [
        { contact_id: "contact-123", tag_id: "t1" },
        { contact_id: "contact-123", tag_id: "t2" },
      ],
    });
    service.setMockDb(mockDb);

    const resumeResult = await service.resumeAi(
      "company-1",
      "contact-123",
      "user-1",
      mockDb,
    );
    expect(resumeResult.success).toBe(true);
    expect(resumeResult.isPaused).toBe(false);

    const status = await service.getAiStatus(
      "company-1",
      "contact-123",
      mockDb,
    );
    expect(status.isPaused).toBe(false);
    expect(status.needsHuman).toBe(false);
  });
});

describe("AI Orchestrator - End-to-End Interception with Handoff Service", () => {
  it("intercepts inbound complaint, halts AI generation, and applies escalation tags", async () => {
    const orchestrator = new AiOrchestratorService();
    const mockDb = createMockHandoffDb({});
    orchestrator.setMockDb(mockDb);

    let geminiInvoked = false;
    orchestrator.setGeminiClient({
      generateChatResponse: async () => {
        geminiInvoked = true;
        return { text: "Should not be called", finishReason: "STOP" };
      },
    } as any);

    await orchestrator.dispatchInboundMessage({
      companyId: "company-1",
      contactId: "contact-123",
      messageId: "msg-1",
      isGroup: false,
      content: "apnader product khub baje ar damaged, tk ferot den",
    });

    // Gemini must NOT be invoked because handoff halted execution
    expect(geminiInvoked).toBe(false);

    // Tags must have been applied to database
    const tagNames = (mockDb._tags || []).map((t: any) => t.name.toLowerCase());
    expect(tagNames).toContain("ai-paused");
    expect(tagNames).toContain("needs-human");
    expect(tagNames).toContain("complaint");
  });

  it("intercepts explicit human request and halts AI generation", async () => {
    const orchestrator = new AiOrchestratorService();
    const mockDb = createMockHandoffDb({});
    orchestrator.setMockDb(mockDb);

    let geminiInvoked = false;
    orchestrator.setGeminiClient({
      generateChatResponse: async () => {
        geminiInvoked = true;
        return { text: "Should not be called", finishReason: "STOP" };
      },
    } as any);

    await orchestrator.dispatchInboundMessage({
      companyId: "company-1",
      contactId: "contact-123",
      messageId: "msg-2",
      isGroup: false,
      content: "ami ekjon manusher sathe kotha bolbo please",
    });

    expect(geminiInvoked).toBe(false);

    const tagNames = (mockDb._tags || []).map((t: any) => t.name.toLowerCase());
    expect(tagNames).toContain("ai-paused");
    expect(tagNames).toContain("needs-human");
  });
});

describe("AI Agent API Routes - Endpoint Behavior", () => {
  const createTestRouter = (mockDb: any) => {
    const r = new Hono();
    r.post("/api/ai-agent/contacts/:id/pause", async (c) => {
      const contactId = c.req.param("id");
      const contact = await mockDb
        .selectFrom("contacts")
        .select()
        .where("id", "=", contactId)
        .executeTakeFirst();
      if (!contact) {
        return c.json({ error: "Contact not found" }, 404);
      }
      let reason = "manual_pause";
      try {
        const body = await c.req.json();
        if (body?.reason) reason = String(body.reason);
      } catch {}
      const res = await handoffService.pauseAi(
        "comp-1",
        contactId,
        reason,
        "usr-1",
        mockDb,
      );
      return c.json(
        {
          data: {
            success: true,
            isPaused: res.isPaused,
            tags: res.tags,
            reason,
          },
        },
        200,
      );
    });

    r.post("/api/ai-agent/contacts/:id/resume", async (c) => {
      const contactId = c.req.param("id");
      const contact = await mockDb
        .selectFrom("contacts")
        .select()
        .where("id", "=", contactId)
        .executeTakeFirst();
      if (!contact) {
        return c.json({ error: "Contact not found" }, 404);
      }
      const res = await handoffService.resumeAi(
        "comp-1",
        contactId,
        "usr-1",
        mockDb,
      );
      return c.json(
        { data: { success: true, isPaused: res.isPaused, tags: res.tags } },
        200,
      );
    });

    r.get("/api/ai-agent/contacts/:id/status", async (c) => {
      const contactId = c.req.param("id");
      const contact = await mockDb
        .selectFrom("contacts")
        .select()
        .where("id", "=", contactId)
        .executeTakeFirst();
      if (!contact) {
        return c.json({ error: "Contact not found" }, 404);
      }
      const status = await handoffService.getAiStatus(
        "comp-1",
        contactId,
        mockDb,
      );
      return c.json({ data: status }, 200);
    });

    return r;
  };

  it("POST /api/ai-agent/contacts/:id/pause pauses AI and returns 200", async () => {
    const mockDb = createMockHandoffDb({
      contacts: [{ id: "c-active" }],
    });
    const testApp = createTestRouter(mockDb);

    const res = await testApp.request("/api/ai-agent/contacts/c-active/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "manual_agent_takeover" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.success).toBe(true);
    expect(body.data.isPaused).toBe(true);
    expect(body.data.tags).toContain("ai-paused");
  });

  it("POST /api/ai-agent/contacts/:id/resume resumes AI and returns 200", async () => {
    const mockDb = createMockHandoffDb({
      contacts: [{ id: "c-paused" }],
      tags: [{ id: "t1", name: "ai-paused" }],
      contactTags: [{ contact_id: "c-paused", tag_id: "t1" }],
    });
    const testApp = createTestRouter(mockDb);

    const res = await testApp.request(
      "/api/ai-agent/contacts/c-paused/resume",
      {
        method: "POST",
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.success).toBe(true);
    expect(body.data.isPaused).toBe(false);
  });

  it("GET /api/ai-agent/contacts/:id/status returns 404 for unknown contact", async () => {
    const mockDb = createMockHandoffDb({ contacts: [] });
    const testApp = createTestRouter(mockDb);

    const res = await testApp.request(
      "/api/ai-agent/contacts/non-existent/status",
    );
    expect(res.status).toBe(404);
  });
});
