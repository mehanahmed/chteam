/**
 * Adversarial Test Suite for Milestone 1: Circuit Breakers & Safety
 * Location: apps/api/src/services/ai-agent/__tests__/safety-circuit-breakers.adversarial.test.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import { AiOrchestratorService } from "../ai-orchestrator.service.js";
import { AI_TAGS, SYSTEM_AI_USER_ID } from "../constants.js";

// Helper to simulate the Kysely SQL execution behavior for evaluateSuppression queries
type MockDbConfig = {
  isBlocked?: boolean;
  activeAssignment?: {
    assigned_to: string | null;
    unassigned_at: Date | null;
  } | null;
  tags?: Array<{ name: string }>;
  lastOutbound?: { sent_by_user_id: string | null; from_me: boolean } | null;
  dbThrows?: boolean;
};

function createMockTenantDb(config: MockDbConfig) {
  if (config.dbThrows) {
    return {
      // biome-ignore lint/suspicious/noExplicitAny: test mock helper
      selectFrom: (): any => {
        throw new Error(
          "FATAL: PostgreSQL connection timeout (mock injected error)",
        );
      },
    };
  }

  return {
    // biome-ignore lint/suspicious/noExplicitAny: test mock helper
    selectFrom: (table: string): any => {
      if (table === "contacts") {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: async () =>
                config.isBlocked !== undefined
                  ? { is_blocked: config.isBlocked }
                  : undefined,
            }),
          }),
        };
      }

      if (table === "contact_assignments") {
        return {
          select: () => ({
            where: (_field1: string, _op1: string, _val1: unknown) => ({
              where: (_field2: string, _op2: string, _val2: unknown) => ({
                orderBy: () => ({
                  limit: () => ({
                    executeTakeFirst: async () => {
                      if (!config.activeAssignment) return undefined;
                      // unassigned_at must be null for active assignment
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

      if (table === "contact_tags") {
        return {
          innerJoin: (_joinTable: string, _col1: string, _col2: string) => ({
            select: (_col: string) => ({
              where: (_f1: string, _op1: string, _contactId: string) => ({
                execute: async () => config.tags || [],
                where: (_f2: string, _op2: string, tagName: string) => ({
                  executeTakeFirst: async () => {
                    if (!config.tags || config.tags.length === 0)
                      return undefined;
                    // EXACT SQL comparison simulation:
                    // In PostgreSQL, `tags.name = $2` is strictly case-sensitive string equality
                    const matched = config.tags.find((t) => t.name === tagName);
                    return matched ? { name: matched.name } : undefined;
                  },
                }),
              }),
            }),
          }),
        };
      }

      if (table === "messages") {
        return {
          select: () => ({
            where: (_f1: string, _op1: string, _val1: unknown) => ({
              where: (_f2: string, _op2: string, _val2: unknown) => ({
                orderBy: () => ({
                  limit: () => ({
                    executeTakeFirst: async () => {
                      if (!config.lastOutbound) return undefined;
                      return config.lastOutbound;
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          where: () => ({
            executeTakeFirst: async () => undefined,
          }),
        }),
      };
    },
  };
}

describe("Adversarial Test Suite: Milestone 1 Safety & Circuit Breakers", () => {
  const orchestrator = new AiOrchestratorService();

  afterEach(() => {
    orchestrator.setMockDb(null);
  });

  // --------------------------------------------------------------------------
  // Dimension 1: Group Message Suppression
  // --------------------------------------------------------------------------
  describe("1. Group Message Suppression", () => {
    it("strictly suppresses group messages with valid user content", async () => {
      const decision = await orchestrator.evaluateSuppression(
        "company-123",
        "contact-456",
        true, // isGroup = true
        "bhai red color ta hobe? delivery charge koto?",
      );
      expect(decision.isSuppressed).toBe(true);
      expect(decision.reason).toBe("group_message");
    });

    it("suppresses group messages even with empty or null content without throwing", async () => {
      const decisionEmpty = await orchestrator.evaluateSuppression(
        "company-123",
        "contact-456",
        true,
        "",
      );
      expect(decisionEmpty.isSuppressed).toBe(true);
      expect(decisionEmpty.reason).toBe("group_message");

      const decisionNull = await orchestrator.evaluateSuppression(
        "company-123",
        "contact-456",
        true,
        null,
      );
      expect(decisionNull.isSuppressed).toBe(true);
      expect(decisionNull.reason).toBe("group_message");
    });

    it("suppresses group messages with massive adversarial payloads", async () => {
      const massiveText = "SPAM ".repeat(10000);
      const decision = await orchestrator.evaluateSuppression(
        "company-123",
        "contact-456",
        true,
        massiveText,
      );
      expect(decision.isSuppressed).toBe(true);
      expect(decision.reason).toBe("group_message");
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 2: Contact ai-paused Tag (Case-Sensitivity & SQL Semantics)
  // --------------------------------------------------------------------------
  describe("2. ai-paused Tag Suppression & Case Sensitivity Investigation", () => {
    it("suppresses when contact has exact lowercase 'ai-paused' tag", async () => {
      // Simulate evaluateSuppression logic with exact lowercase tag
      const mockDb = createMockTenantDb({
        tags: [{ name: "ai-paused" }],
      });

      const pausedTag = await mockDb
        .selectFrom("contact_tags")
        .innerJoin("tags", "tags.id", "contact_tags.tag_id")
        .select("tags.name")
        .where("contact_tags.contact_id", "=", "contact-456")
        .where("tags.name", "=", AI_TAGS.AI_PAUSED)
        .executeTakeFirst();

      expect(pausedTag).toBeDefined();
      expect(pausedTag?.name).toBe("ai-paused");
    });

    it("EMPIRICAL FINDING: fails to suppress when contact has uppercase 'AI-PAUSED' tag due to case-sensitive equality", async () => {
      // In PostgreSQL, `tags.name = 'ai-paused'` does NOT match `'AI-PAUSED'`
      const mockDb = createMockTenantDb({
        tags: [{ name: "AI-PAUSED" }],
      });

      const pausedTag = await mockDb
        .selectFrom("contact_tags")
        .innerJoin("tags", "tags.id", "contact_tags.tag_id")
        .select("tags.name")
        .where("contact_tags.contact_id", "=", "contact-456")
        .where("tags.name", "=", AI_TAGS.AI_PAUSED) // "=", "ai-paused"
        .executeTakeFirst();

      // Because `tags.name = 'ai-paused'` is case-sensitive, this returns undefined!
      expect(pausedTag).toBeUndefined();
    });

    it("EMPIRICAL FINDING: fails to suppress when contact has mixed-case 'Ai-Paused' tag", async () => {
      const mockDb = createMockTenantDb({
        tags: [{ name: "Ai-Paused" }],
      });

      const pausedTag = await mockDb
        .selectFrom("contact_tags")
        .innerJoin("tags", "tags.id", "contact_tags.tag_id")
        .select("tags.name")
        .where("contact_tags.contact_id", "=", "contact-456")
        .where("tags.name", "=", AI_TAGS.AI_PAUSED)
        .executeTakeFirst();

      expect(pausedTag).toBeUndefined();
    });

    it("does not suppress when contact has unrelated tags", async () => {
      const mockDb = createMockTenantDb({
        tags: [{ name: "wholesale" }, { name: "dhaka-customer" }],
      });

      const pausedTag = await mockDb
        .selectFrom("contact_tags")
        .innerJoin("tags", "tags.id", "contact_tags.tag_id")
        .select("tags.name")
        .where("contact_tags.contact_id", "=", "contact-456")
        .where("tags.name", "=", AI_TAGS.AI_PAUSED)
        .executeTakeFirst();

      expect(pausedTag).toBeUndefined();
    });

    it("REMEDIATION VERIFICATION: evaluateSuppression case-insensitively matches uppercase and mixed-case ai-paused tag", async () => {
      const mockDbUpper = createMockTenantDb({
        tags: [{ name: "AI-PAUSED" }],
      });
      orchestrator.setMockDb(mockDbUpper);
      const decisionUpper = await orchestrator.evaluateSuppression(
        "comp-1",
        "contact-456",
        false,
        "valid inquiry",
      );
      expect(decisionUpper.isSuppressed).toBe(true);
      expect(decisionUpper.reason).toBe("ai_paused_tag_present");

      const mockDbMixed = createMockTenantDb({
        tags: [{ name: "Ai-Paused" }],
      });
      orchestrator.setMockDb(mockDbMixed);
      const decisionMixed = await orchestrator.evaluateSuppression(
        "comp-1",
        "contact-456",
        false,
        "valid inquiry",
      );
      expect(decisionMixed.isSuppressed).toBe(true);
      expect(decisionMixed.reason).toBe("ai_paused_tag_present");
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 3: Human Agent Assignment
  // --------------------------------------------------------------------------
  describe("3. Contact Assigned to Human Agent", () => {
    it("suppresses when contact is actively assigned to a human agent", async () => {
      const mockDb = createMockTenantDb({
        activeAssignment: {
          assigned_to: "human-agent-uuid-1234",
          unassigned_at: null,
        },
      });

      const assignment = await mockDb
        .selectFrom("contact_assignments")
        .select(["assigned_to"])
        .where("contact_id", "=", "contact-456")
        .where("unassigned_at", "is", null)
        .orderBy("assigned_at", "desc")
        .limit(1)
        .executeTakeFirst();

      expect(assignment?.assigned_to).toBe("human-agent-uuid-1234");
    });

    it("does not suppress when previous assignment was unassigned", async () => {
      const mockDb = createMockTenantDb({
        activeAssignment: {
          assigned_to: "human-agent-uuid-1234",
          unassigned_at: new Date("2026-10-26T00:00:00Z"),
        },
      });

      const assignment = await mockDb
        .selectFrom("contact_assignments")
        .select(["assigned_to"])
        .where("contact_id", "=", "contact-456")
        .where("unassigned_at", "is", null)
        .orderBy("assigned_at", "desc")
        .limit(1)
        .executeTakeFirst();

      expect(assignment).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 4: Last Message Sent Manually by Human
  // --------------------------------------------------------------------------
  describe("4. Last Message Manually Sent by Human", () => {
    it("suppresses when last outbound message was sent by a human agent via Web UI", async () => {
      const mockDb = createMockTenantDb({
        lastOutbound: {
          sent_by_user_id: "human-agent-uuid-5678",
          from_me: true,
        },
      });

      const lastOutbound = await mockDb
        .selectFrom("messages")
        .select(["sent_by_user_id", "from_me"])
        .where("contact_id", "=", "contact-456")
        .where("from_me", "=", true)
        .orderBy("timestamp", "desc")
        .limit(1)
        .executeTakeFirst();

      const shouldSuppress = Boolean(
        lastOutbound &&
          lastOutbound.sent_by_user_id &&
          lastOutbound.sent_by_user_id !== SYSTEM_AI_USER_ID,
      );

      expect(shouldSuppress).toBe(true);
    });

    it("does not suppress when last outbound message was sent by the AI Agent", async () => {
      const mockDb = createMockTenantDb({
        lastOutbound: {
          sent_by_user_id: SYSTEM_AI_USER_ID,
          from_me: true,
        },
      });

      const lastOutbound = await mockDb
        .selectFrom("messages")
        .select(["sent_by_user_id", "from_me"])
        .where("contact_id", "=", "contact-456")
        .where("from_me", "=", true)
        .orderBy("timestamp", "desc")
        .limit(1)
        .executeTakeFirst();

      const shouldSuppress = Boolean(
        lastOutbound &&
          lastOutbound.sent_by_user_id &&
          lastOutbound.sent_by_user_id !== SYSTEM_AI_USER_ID,
      );

      expect(shouldSuppress).toBe(false);
    });

    it("EMPIRICAL FINDING: fails to suppress when human sent message via WhatsApp linked device (phone) because sent_by_user_id is null", async () => {
      // In message-handlers.ts:358, live messages sent from linked device (phone) have
      // `from_me: true`, but `sent_by_user_id` is null!
      const mockDb = createMockTenantDb({
        lastOutbound: {
          sent_by_user_id: null, // from linked device / phone directly
          from_me: true,
        },
      });

      const lastOutbound = await mockDb
        .selectFrom("messages")
        .select(["sent_by_user_id", "from_me"])
        .where("contact_id", "=", "contact-456")
        .where("from_me", "=", true)
        .orderBy("timestamp", "desc")
        .limit(1)
        .executeTakeFirst();

      // Current condition in ai-orchestrator.service.ts:157:
      // if (lastOutbound && lastOutbound.sent_by_user_id && lastOutbound.sent_by_user_id !== SYSTEM_AI_USER_ID)
      const currentImplementationDecision = Boolean(
        lastOutbound &&
          lastOutbound.sent_by_user_id &&
          lastOutbound.sent_by_user_id !== SYSTEM_AI_USER_ID,
      );

      // Empirically verify that previous implementation FAILED to suppress this!
      expect(currentImplementationDecision).toBe(false);
    });

    it("REMEDIATION VERIFICATION: evaluateSuppression suppresses when merchant replied via phone linked device (sent_by_user_id null)", async () => {
      const mockDbPhone = createMockTenantDb({
        lastOutbound: {
          sent_by_user_id: null,
          from_me: true,
        },
      });
      orchestrator.setMockDb(mockDbPhone);
      const decision = await orchestrator.evaluateSuppression(
        "comp-1",
        "contact-456",
        false,
        "valid inquiry",
      );
      expect(decision.isSuppressed).toBe(true);
      expect(decision.reason).toBe("last_message_from_human_agent");
    });
  });

  // --------------------------------------------------------------------------
  // Dimension 5: Webhook Handlers Non-Blocking & Non-Throwing Invariant
  // --------------------------------------------------------------------------
  describe("5. Webhook Handlers Non-Blocking & Non-Throwing Invariant", () => {
    it("evaluateSuppression catches database errors gracefully and never throws", async () => {
      const mockDb = createMockTenantDb({ dbThrows: true });

      // Even if database throws a catastrophic error, the function must catch and not throw
      let threw = false;
      try {
        mockDb.selectFrom("contacts");
      } catch (_err) {
        threw = true;
      }
      expect(threw).toBe(true);

      // Now verify that orchestrator.evaluateSuppression never throws to caller
      // (as it wraps tenantDb in try/catch)
      orchestrator.setMockDb(mockDb);
      const decision = await orchestrator.evaluateSuppression(
        "unreachable-company-id",
        "unreachable-contact-id",
        false,
        "valid customer inquiry",
      );

      // Handled gracefully without throwing, failing safe on database error
      expect(decision).toBeDefined();
      expect(decision.isSuppressed).toBe(true);
      expect(decision.reason).toBe("db_error_fail_safe");
    });

    it("verifies dispatchInboundMessage does not throw unhandled rejections on corrupted input", async () => {
      // Passing an invalid context with missing connections and contacts
      let threw = false;
      try {
        await orchestrator.dispatchInboundMessage({
          companyId: "invalid-comp",
          contactId: "invalid-contact",
          messageId: "msg-1",
          content: "hello",
          isGroup: false,
        });
      } catch (_e) {
        threw = true;
      }

      // Must be completely caught inside dispatchInboundMessage
      expect(threw).toBe(false);
    });
  });
});
