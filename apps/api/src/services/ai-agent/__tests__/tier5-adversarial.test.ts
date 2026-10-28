/**
 * Milestone 6: Tier 5 Adversarial Coverage Hardening Test Suite
 * Location: apps/api/src/services/ai-agent/__tests__/tier5-adversarial.test.ts
 *
 * White-box adversarial testing across all AI agent components:
 * 1. AI Orchestrator Concurrency, Debouncing & In-Flight Circuit Breakers
 * 2. Gemini GenAI Client Dual-Model Failover, Timeouts & Error Recovery
 * 3. Multimodal Vision Pipeline Malformed Buffers, OCR Failbacks & Corrupt Images
 * 4. Delivery Rules & Mathematical Pricing Calculator Boundaries & Zone Invariants
 * 5. 11-digit BD Phone Normalization & Conversational Slot-Filler Stress Testing
 * 6. Order Flow State Machine Adversarial Transitions, Cancellations & Advances
 * 7. Handoff Service Profanity/Threat Detection, Confusion & Circuit Breaker Failsafes
 * 8. WooCommerce & Shopify Adapters Network Failures, Backorders & Inventory Caches
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AiOrchestratorService } from "../ai-orchestrator.service.js";
import { HandoffService } from "../conversation/handoff.service.js";
import { OrderFlowManager } from "../conversation/order-flow.js";
import {
  convertBengaliDigitsToEnglish,
  extractSlotsFromText,
  getMissingSlotsPrompt,
  normalizeBdPhoneNumber,
  validateOrderSlots,
} from "../conversation/slot-filler.js";
import {
  calculateOrderPricing,
  detectDeliveryZone,
} from "../ecommerce/delivery-rules.js";
import type {
  ECommercePlatformAdapter,
  StockCheckItem,
  UnifiedProduct,
} from "../ecommerce/ecommerce.interface.js";
import { InventoryService } from "../ecommerce/inventory.service.js";
import { ShopifyClient, ShopifyError } from "../ecommerce/shopify.client.js";
import {
  WooCommerceClient,
  WooCommerceError,
} from "../ecommerce/woocommerce.client.js";
import { GeminiClient, GeminiServiceError } from "../gemini/gemini.client.js";
import {
  detectMimeTypeFromMagicBytes,
  extractReceiptViaRegex,
  ImageIngestionError,
  ingestImageToInlineData,
  parseVisionModelResponse,
  searchCatalogByVisualFeatures,
  VisionService,
  validateImageBuffer,
} from "../gemini/vision.service.js";
import { GeminiOfflineSimulationHarness } from "../testing/gemini-mock-harness.js";

// ============================================================================
// Shared Test Simulation Harness & Setup
// ============================================================================

const harness = new GeminiOfflineSimulationHarness();

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
          sendMessage: mock(async (msg: unknown) => {
            return harness.handleGenerateContent({
              model: params.model,
              contents: msg,
              config: params.config,
            });
          }),
        })),
      };
      constructor(opts: { apiKey?: string }) {
        this.apiKey = opts.apiKey || "mock-gemini-key";
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

// Helper to construct a configurable Mock Database simulating Kysely
function createMockTenantDb(config: {
  isBlocked?: boolean;
  activeAssignment?: {
    assigned_to: string | null;
    unassigned_at: Date | null;
  } | null;
  tags?: Array<{ id?: string; name: string; color?: string }>;
  messages?: Array<{
    id?: string;
    from_me: boolean;
    content: string | null;
    sent_by_user_id: string | null;
    timestamp?: Date;
    created_at?: Date;
  }>;
  catalogProducts?: Array<{
    product_id: string;
    catalog_id?: string;
    name: string;
    description: string | null;
    price: number | null;
    currency?: string;
    sku: string | null;
    category: string | null;
    availability: string;
  }>;
  dbThrows?: boolean;
}) {
  if (config.dbThrows) {
    return {
      selectFrom: () => {
        throw new Error(
          "FATAL: Injected Database Connection Pool Exhaustion Error",
        );
      },
      transaction: () => ({
        execute: async () => {
          throw new Error("FATAL: Injected Database Transaction Error");
        },
      }),
    };
  }

  const tagsList = config.tags ? [...config.tags] : [];

  return {
    selectFrom: (table: string) => {
      if (table === "contacts") {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: async () =>
                config.isBlocked !== undefined
                  ? { is_blocked: config.isBlocked }
                  : { is_blocked: false },
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

      if (table === "contact_tags") {
        return {
          innerJoin: () => ({
            select: () => ({
              where: () => ({
                execute: async () => tagsList,
                where: (_f: string, _op: string, tagName: string) => ({
                  executeTakeFirst: async () => {
                    const match = tagsList.find(
                      (t) => t.name.toLowerCase() === tagName.toLowerCase(),
                    );
                    return match ? { name: match.name } : undefined;
                  },
                }),
              }),
            }),
          }),
          select: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: async () => undefined,
              }),
            }),
          }),
        };
      }

      if (table === "tags") {
        return {
          select: () => ({
            where: (_f: string, _op: string, name: string) => ({
              executeTakeFirst: async () => {
                const match = tagsList.find(
                  (t) => t.name.toLowerCase() === name.toLowerCase(),
                );
                return match
                  ? { id: match.id || "tag-uuid-1", name: match.name }
                  : undefined;
              },
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
                    execute: async () => config.messages || [],
                    executeTakeFirst: async () => {
                      const msgs = config.messages || [];
                      return msgs.length > 0
                        ? msgs[msgs.length - 1]
                        : undefined;
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "catalog_products") {
        return {
          selectAll: () => ({
            execute: async () => config.catalogProducts || [],
          }),
        };
      }

      if (table === "whatsapp_connections") {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: async () => ({
                jid: "store_connection@s.whatsapp.net",
              }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          where: () => ({
            executeTakeFirst: async () => undefined,
            execute: async () => [],
          }),
        }),
      };
    },
    insertInto: (_table: string) => ({
      values: (val: any) => ({
        execute: async () => {
          if (val.name) {
            tagsList.push({ id: val.id || "new-tag-id", name: val.name });
          }
          return { insertId: "123" };
        },
      }),
    }),
    deleteFrom: (_table: string) => ({
      where: () => ({
        where: () => ({
          execute: async () => {},
        }),
      }),
    }),
    transaction: () => ({
      execute: async (fn: (trx: any) => Promise<any>) => {
        return fn({
          insertInto: () => ({
            values: () => ({ execute: async () => {} }),
          }),
        });
      },
    }),
  };
}

// ============================================================================
// TEST SUITE: Milestone 6 - Tier 5 Adversarial Coverage Hardening
// ============================================================================

describe("Milestone 6: Tier 5 Adversarial Coverage Hardening", () => {
  beforeEach(() => {
    harness.reset();
  });

  // --------------------------------------------------------------------------
  // 1. AI Orchestrator Concurrency, Debouncing & In-Flight Circuit Breakers
  // --------------------------------------------------------------------------
  describe("1. Orchestrator Concurrency & In-Flight Circuit Breakers", () => {
    it("handles concurrent message storm from the same contact gracefully via debounce lock", async () => {
      const orchestrator = new AiOrchestratorService();
      const mockDb = createMockTenantDb({});
      orchestrator.setMockDb(mockDb);

      harness.onPattern(/concurrency_test/i, "Mock response for concurrency");

      // Fire 5 identical inbound messages simultaneously for the same contact
      const triggerPromises = Array.from({ length: 5 }).map((_, idx) =>
        orchestrator.dispatchInboundMessage({
          companyId: "company-concurrency",
          contactId: "contact-same-user",
          messageId: `msg-${idx}`,
          content: `concurrency_test message #${idx}`,
          isGroup: false,
        }),
      );

      await Promise.all(triggerPromises);

      // Verify lock cleaned up cleanly and didn't crash
      const suppressionAfter = await orchestrator.evaluateSuppression(
        "company-concurrency",
        "contact-same-user",
        false,
        "new message",
      );
      expect(suppressionAfter.isSuppressed).toBe(false);
    });

    it("releases contact lock even when processing throws an unexpected error", async () => {
      const orchestrator = new AiOrchestratorService();
      // Inject db that throws
      const failingDb = createMockTenantDb({ dbThrows: true });
      orchestrator.setMockDb(failingDb);

      // Should handle exception without throwing unhandled rejection
      await orchestrator.dispatchInboundMessage({
        companyId: "company-fail",
        contactId: "contact-crash-test",
        messageId: "msg-crash-1",
        content: "trigger error",
        isGroup: false,
      });

      // Subsequent call can proceed and is not permanently deadlocked
      const safeDb = createMockTenantDb({ isBlocked: false });
      orchestrator.setMockDb(safeDb);
      const suppression = await orchestrator.evaluateSuppression(
        "company-fail",
        "contact-crash-test",
        false,
        "subsequent message",
      );
      expect(suppression.isSuppressed).toBe(false);
    });

    it("aborts in-flight reply when contact is assigned to human while Gemini is generating reply", async () => {
      const orchestrator = new AiOrchestratorService();

      // State switches to human assigned mid-flight
      let assignmentState: {
        assigned_to: string | null;
        unassigned_at: Date | null;
      } | null = null;
      const dynamicDb = {
        selectFrom: (table: string) => {
          if (table === "contacts") {
            return {
              select: () => ({
                where: () => ({
                  executeTakeFirst: async () => ({ is_blocked: false }),
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
                        executeTakeFirst: async () => assignmentState,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "contact_tags") {
            return {
              innerJoin: () => ({
                select: () => ({
                  where: () => ({ execute: async () => [] }),
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
                        executeTakeFirst: async () => undefined,
                        execute: async () => [],
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
                    jid: "conn@s.whatsapp.net",
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              where: () => ({ executeTakeFirst: async () => undefined }),
            }),
          };
        },
        transaction: () => ({
          execute: async () => {
            throw new Error(
              "UNEXPECTED: Outbound message should have been aborted before transaction!",
            );
          },
        }),
      };

      orchestrator.setMockDb(dynamicDb);
      orchestrator.setGeminiClient(
        new GeminiClient({ apiKey: "mock-gemini-key" }),
      );

      // Configure harness to simulate human assignment while Gemini is answering
      harness.onPattern(
        /interception_test/i,
        "Autonomous reply that should be blocked",
      );

      // Before Gemini returns, human agent claims the ticket
      const origHandle = harness.handleGenerateContent.bind(harness);
      harness.handleGenerateContent = async (params) => {
        assignmentState = { assigned_to: "agent-alice", unassigned_at: null };
        return origHandle(params);
      };

      // Inbound message dispatch
      await orchestrator.dispatchInboundMessage({
        companyId: "company-in-flight",
        contactId: "contact-assigned-midway",
        messageId: "msg-flight-1",
        content: "interception_test query",
        isGroup: false,
        connectionId: "conn-123",
        contactJid: "customer@s.whatsapp.net",
      });

      // Verify that after assignment, suppression rejects further autonomous replies
      const postCheck = await orchestrator.evaluateSuppression(
        "company-in-flight",
        "contact-assigned-midway",
        false,
        "hello",
      );
      expect(postCheck.isSuppressed).toBe(true);
      expect(postCheck.reason).toBe("contact_assigned_to_human");
    });

    it("aborts in-flight reply when human agent manually sends message while Gemini is generating reply", async () => {
      const orchestrator = new AiOrchestratorService();

      let lastOutboundMessage: {
        sent_by_user_id: string | null;
        from_me: boolean;
      } | null = null;
      const dynamicDb = {
        selectFrom: (table: string) => {
          if (table === "contacts") {
            return {
              select: () => ({
                where: () => ({
                  executeTakeFirst: async () => ({ is_blocked: false }),
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
                        executeTakeFirst: async () => undefined,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "contact_tags") {
            return {
              innerJoin: () => ({
                select: () => ({
                  where: () => ({ execute: async () => [] }),
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
                        executeTakeFirst: async () => lastOutboundMessage,
                        execute: async () => [],
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
                    jid: "conn@s.whatsapp.net",
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              where: () => ({ executeTakeFirst: async () => undefined }),
            }),
          };
        },
        transaction: () => ({
          execute: async () => {
            throw new Error(
              "UNEXPECTED: Outbound send should have been aborted on manual agent message!",
            );
          },
        }),
      };

      orchestrator.setMockDb(dynamicDb);
      orchestrator.setGeminiClient(
        new GeminiClient({ apiKey: "mock-gemini-key" }),
      );

      harness.onPattern(
        /in_flight_manual_test/i,
        "Autonomous reply to be blocked",
      );

      const origHandle = harness.handleGenerateContent.bind(harness);
      harness.handleGenerateContent = async (params) => {
        // Human agent types and sends from mobile or web UI
        lastOutboundMessage = {
          sent_by_user_id: "human-agent-99",
          from_me: true,
        };
        return origHandle(params);
      };

      await orchestrator.dispatchInboundMessage({
        companyId: "company-in-flight",
        contactId: "contact-manual-interrupted",
        messageId: "msg-manual-1",
        content: "in_flight_manual_test query",
        isGroup: false,
        connectionId: "conn-123",
        contactJid: "customer@s.whatsapp.net",
      });

      const postCheck = await orchestrator.evaluateSuppression(
        "company-in-flight",
        "contact-manual-interrupted",
        false,
        "test",
      );
      expect(postCheck.isSuppressed).toBe(true);
      expect(postCheck.reason).toBe("last_message_from_human_agent");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Gemini GenAI Client Failover, Timeouts & Error Recovery
  // --------------------------------------------------------------------------
  describe("2. Gemini Client Failover, Timeouts & Error Recovery", () => {
    it("fails over from gemini-2.0-flash to gemini-1.5-flash when primary model times out", async () => {
      const client = new GeminiClient({
        apiKey: "test-api-key",
        primaryModel: "gemini-2.0-flash",
        fallbackModel: "gemini-1.5-flash",
        timeoutMs: 50, // Short timeout for test
      });

      // Cause primary model to hang longer than timeoutMs
      const origHandle = harness.handleGenerateContent.bind(harness);
      harness.handleGenerateContent = async (params) => {
        if (params.model === "gemini-2.0-flash") {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return origHandle(params);
      };

      const result = await client.generateChatResponse({
        messages: [{ role: "user", content: "price koto bhaiya?" }],
      });

      expect(result.modelUsed).toBe("gemini-1.5-flash");
      expect(result.isFallback).toBe(true);
    });

    it("throws GeminiServiceError when both primary and fallback models fail", async () => {
      const client = new GeminiClient({
        apiKey: "test-api-key",
        primaryModel: "gemini-2.0-flash",
        fallbackModel: "gemini-1.5-flash",
      });

      harness.simulateModelFailure("gemini-2.0-flash", 429, "Quota exhausted");
      harness.simulateModelFailure(
        "gemini-1.5-flash",
        503,
        "All backends unavailable",
      );

      let caughtError: GeminiServiceError | null = null;
      try {
        await client.generateChatResponse({
          messages: [{ role: "user", content: "kemon achen?" }],
        });
      } catch (err) {
        caughtError = err as GeminiServiceError;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.name).toBe("GeminiServiceError");
      expect(caughtError?.modelAttempted).toBe("gemini-1.5-flash");
      expect(caughtError?.statusCode).toBe(503);
    });

    it("strictly adheres to forcedModel without fallback attempt", async () => {
      const client = new GeminiClient({
        apiKey: "test-api-key",
        primaryModel: "gemini-2.0-flash",
        fallbackModel: "gemini-1.5-flash",
      });

      harness.simulateModelFailure(
        "custom-model-x",
        500,
        "Internal Server Error",
      );

      let caughtError: GeminiServiceError | null = null;
      try {
        await client.generateChatResponse({
          messages: [{ role: "user", content: "hello" }],
          forcedModel: "custom-model-x",
        });
      } catch (err) {
        caughtError = err as GeminiServiceError;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.modelAttempted).toBe("custom-model-x");
      // Fallback model should not have been invoked
      expect(
        harness.callHistory.some((c) => c.model === "gemini-1.5-flash"),
      ).toBe(false);
    });

    it("handles response with undefined text and function calls gracefully", async () => {
      const client = new GeminiClient({
        apiKey: "test-api-key",
      });

      harness.onToolCall(/check_stock_now/i, "check_stock_and_variants", {
        productId: "101",
      });

      const res = await client.generateChatResponse({
        messages: [{ role: "user", content: "check_stock_now" }],
      });

      expect(res.functionCalls).toBeDefined();
      expect(res.functionCalls?.length).toBe(1);
      expect(res.functionCalls?.[0].name).toBe("check_stock_and_variants");
      expect(res.functionCalls?.[0].args.productId).toBe("101");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Multimodal Vision Pipeline Malformed Buffers & Resilient Fallbacks
  // --------------------------------------------------------------------------
  describe("3. Multimodal Vision Pipeline & Corrupt Image Hardening", () => {
    it("detects magic bytes accurately across JPEG, PNG, WEBP and GIF", () => {
      // JPEG: FF D8 FF
      const jpegBuf = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
      ]);
      expect(detectMimeTypeFromMagicBytes(jpegBuf)).toBe("image/jpeg");

      // PNG: 89 50 4E 47 0D 0A 1A 0A
      const pngBuf = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
      ]);
      expect(detectMimeTypeFromMagicBytes(pngBuf)).toBe("image/png");

      // WEBP: 'RIFF' .... 'WEBP'
      const webpBuf = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      expect(detectMimeTypeFromMagicBytes(webpBuf)).toBe("image/webp");

      // GIF: 'GIF89a'
      const gifBuf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(detectMimeTypeFromMagicBytes(gifBuf)).toBe("image/gif");

      // Random non-image bytes
      const randomBuf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
      expect(detectMimeTypeFromMagicBytes(randomBuf)).toBeNull();
    });

    it("rejects corrupted, zero-byte and oversized image buffers", () => {
      // Empty buffer
      const emptyCheck = validateImageBuffer(Buffer.alloc(0));
      expect(emptyCheck.isValid).toBe(false);
      expect(emptyCheck.errorReason).toContain("empty");

      // Truncated header (< 12 bytes)
      const tinyCheck = validateImageBuffer(Buffer.from([0xff, 0xd8, 0xff]));
      expect(tinyCheck.isValid).toBe(false);
      expect(tinyCheck.errorReason).toContain("too small");

      // Oversized buffer (> 25MB)
      const giantBuf = Buffer.alloc(26 * 1024 * 1024);
      const giantCheck = validateImageBuffer(giantBuf);
      expect(giantCheck.isValid).toBe(false);
      expect(giantCheck.errorReason).toContain("exceeds 25MB");

      // Executable / PDF file pretending to be image
      const pdfHeader = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>", "utf-8");
      const pdfCheck = validateImageBuffer(pdfHeader);
      expect(pdfCheck.isValid).toBe(false);
    });

    it("ingestImageToInlineData throws ImageIngestionError for malformed base64 or unsupported schemes", async () => {
      // Empty string
      await expect(ingestImageToInlineData("")).rejects.toThrow(
        ImageIngestionError,
      );

      // Malformed Data URI
      await expect(
        ingestImageToInlineData("data:unsupported;scheme,notbase64"),
      ).rejects.toThrow(ImageIngestionError);

      // Corrupted inline data object
      await expect(
        ingestImageToInlineData({ mimeType: "image/jpeg", data: "" }),
      ).rejects.toThrow(ImageIngestionError);
    });

    it("returns empathetic customer reply when corrupted image is sent to processIncomingImage", async () => {
      const vService = new VisionService();

      // Corrupted image buffer
      const corruptedBuf = Buffer.from(
        "Corrupted non-image noise header data here",
      );

      const resultBangla = await vService.processIncomingImage({
        companyId: "company-vis",
        imageSource: corruptedBuf,
        customerQuery: "দাম কত?",
        language: "bangla",
      });

      expect(resultBangla.success).toBe(false);
      expect(resultBangla.isCorrupted).toBe(true);
      expect(resultBangla.replyText).toContain("দুঃখিত ভাইয়া");

      const resultEnglish = await vService.processIncomingImage({
        companyId: "company-vis",
        imageSource: corruptedBuf,
        customerQuery: "How much?",
        language: "english",
      });
      expect(resultEnglish.replyText).toContain("Sorry, we could not open");
    });

    it("extractReceiptViaRegex handles complex bKash and Nagad payment receipts reliably", () => {
      const bKashSms = `You have received payment Tk 1,850.00 from 01712345678. Ref: Order. Fee Tk 0.00. Balance Tk 5,420.00. TrxID 9X7B1A2C3D at 26/10/2026 14:30`;
      const extractedBkash = extractReceiptViaRegex(bKashSms);
      expect(extractedBkash).not.toBeNull();
      expect(extractedBkash?.provider).toBe("bkash");
      expect(extractedBkash?.transactionId).toBe("9X7B1A2C3D");
      expect(extractedBkash?.amount).toBe(1850);
      expect(extractedBkash?.senderNumber).toBe("01712345678");

      const nagadSms = `Payment Received. Amount: Tk 120.00. Sender: 01898765432. TxnID: NAGAD8877. Date: 26-10-2026`;
      const extractedNagad = extractReceiptViaRegex(nagadSms);
      expect(extractedNagad).not.toBeNull();
      expect(extractedNagad?.provider).toBe("nagad");
      expect(extractedNagad?.transactionId).toBe("NAGAD8877");
      expect(extractedNagad?.amount).toBe(120);

      // Irrelevant message without receipt tokens
      expect(extractReceiptViaRegex("Bhai delivery charge koto?")).toBeNull();
    });

    it("parseVisionModelResponse falls back cleanly when model returns non-JSON or code-fenced string", () => {
      // Code fenced JSON
      const codeFenced =
        '```json\n{"isPaymentReceipt": false, "productFeatures": {"ocrText": "VDJ-09 2500 Tk", "detectedCodes": ["VDJ-09"], "detectedPrices": [2500]}}\n```';
      const parsedFence = parseVisionModelResponse(codeFenced);
      expect(parsedFence.productFeatures?.detectedCodes).toContain("VDJ-09");
      expect(parsedFence.productFeatures?.detectedPrices).toContain(2500);

      // Raw unparseable text containing receipt tokens with formatted amount
      const unparseableText =
        "I see a payment receipt with TrxID: 88A99B and amount 1,500 Tk from bKash.";
      const parsedFallback = parseVisionModelResponse(unparseableText);
      expect(parsedFallback.isPaymentReceipt).toBe(true);
      expect(parsedFallback.receiptDetails?.transactionId).toBe("88A99B");
      expect(parsedFallback.receiptDetails?.amount).toBe(1500);
    });

    it("extractReceiptViaRegex correctly parses uncomma-formatted amounts without truncation (remediated)", () => {
      // After remediation, (?:,[0-9]{3})+ requires at least one comma group before matching,
      // allowing unformatted amounts like "amount 1500" to fall through to [0-9]+ cleanly without truncating to 150.
      const unformattedReceipt =
        "Payment received. amount 1500 Tk. TrxID: 9X8Y7Z";
      const result = extractReceiptViaRegex(unformattedReceipt);
      expect(result).not.toBeNull();
      expect(result?.amount).toBe(1500);

      // Verify higher unformatted multi-digit amounts
      const largeReceipt = "Payment of 25000 tk received. TrxID: ABCD1234EF";
      const largeResult = extractReceiptViaRegex(largeReceipt);
      expect(largeResult?.amount).toBe(25000);
    });

    it("searchCatalogByVisualFeatures handles database exception gracefully", async () => {
      const failingDb = {
        selectFrom: () => {
          throw new Error("Catalog query failed");
        },
      };

      const result = await searchCatalogByVisualFeatures(
        "comp-1",
        {
          ocrText: "Test Product",
          detectedCodes: ["CODE-1"],
          detectedPrices: [1000],
          category: null,
          primaryColor: null,
          secondaryColors: [],
          style: null,
          pattern: null,
          description: "Test description",
        },
        { tenantDb: failingDb },
      );

      expect(result.matches).toEqual([]);
      expect(result.bestMatch).toBeNull();
      expect(result.isCatalogMatch).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Delivery Rules & Pricing Calculator Boundary Hardening
  // --------------------------------------------------------------------------
  describe("4. Delivery Rules & Mathematical Pricing Calculator Boundaries", () => {
    it("detectDeliveryZone classifies sub-dhaka suburbs with strict precedence over inside dhaka", () => {
      // Savar, Dhaka -> Suburbs precedence
      expect(detectDeliveryZone("House 5, Savar, Dhaka")).toBe("sub_dhaka");
      expect(detectDeliveryZone("সাভার বাসস্ট্যান্ড, ঢাকা")).toBe("sub_dhaka");

      // Gazipur / Tongi
      expect(detectDeliveryZone("Joydebpur, Gazipur")).toBe("sub_dhaka");
      expect(detectDeliveryZone("টঙ্গী স্টেশন রোড, গাজীপুর")).toBe("sub_dhaka");

      // Narayanganj / Keraniganj
      expect(detectDeliveryZone("Chashara, Narayanganj")).toBe("sub_dhaka");
      expect(detectDeliveryZone("কেরানীগঞ্জ, ঢাকা")).toBe("sub_dhaka");
      expect(detectDeliveryZone("Ashulia, Savar, Dhaka")).toBe("sub_dhaka");
      expect(detectDeliveryZone("Dhamrai")).toBe("sub_dhaka");
    });

    it("detectDeliveryZone classifies remote districts across Bangladesh in English and Bengali", () => {
      expect(detectDeliveryZone("Chittagong, GEC Circle")).toBe(
        "outside_dhaka",
      );
      expect(detectDeliveryZone("সিলেট জিন্দাবাজার")).toBe("outside_dhaka");
      expect(detectDeliveryZone("কুড়িগ্রাম সদর")).toBe("outside_dhaka");
      expect(detectDeliveryZone("চাঁপাইনবাবগঞ্জ শিবগঞ্জ")).toBe("outside_dhaka");
      expect(detectDeliveryZone("Cox's Bazar Sea Beach Road")).toBe(
        "outside_dhaka",
      );
      expect(detectDeliveryZone("Dhakar baire pathaben")).toBe("outside_dhaka");
      expect(detectDeliveryZone("ঢাকার বাইরে ডেলিভারি হবে?")).toBe("outside_dhaka");
    });

    it("detectDeliveryZone classifies Inside Dhaka metro neighborhoods accurately", () => {
      expect(detectDeliveryZone("Road 27, Dhanmondi, Dhaka")).toBe(
        "inside_dhaka",
      );
      expect(
        detectDeliveryZone("House 14, Chittagong Road, Jatrabari, Dhaka"),
      ).toBe("inside_dhaka");
      expect(detectDeliveryZone("মিরপুর ১০ গোলচত্বর")).toBe("inside_dhaka");
      expect(detectDeliveryZone("Gulshan 2, Dhaka 1212")).toBe("inside_dhaka");
      expect(detectDeliveryZone("Aftabnagar Block C")).toBe("inside_dhaka");
      expect(detectDeliveryZone("Banasree Road 4")).toBe("inside_dhaka");
      expect(detectDeliveryZone("Agargaon Taltola")).toBe("inside_dhaka");
    });

    it("detectDeliveryZone resolves Chittagong Road within Dhaka / Jatrabari as inside_dhaka", () => {
      expect(
        detectDeliveryZone("House 14, Chittagong Road, Jatrabari, Dhaka"),
      ).toBe("inside_dhaka");
      expect(detectDeliveryZone("Chittagong Road, Jatrabari")).toBe(
        "inside_dhaka",
      );
      expect(detectDeliveryZone("চট্টগ্রাম রোড, যাত্রাবাড়ী, ঢাকা")).toBe("inside_dhaka");
      // Outside Dhaka district addresses still map to outside_dhaka
      expect(detectDeliveryZone("Chittagong, GEC Circle")).toBe(
        "outside_dhaka",
      );
      expect(detectDeliveryZone("Chittagong Road, Comilla")).toBe(
        "outside_dhaka",
      );
    });

    it("detectDeliveryZone marks unrecognized or empty locations as ambiguous", () => {
      expect(detectDeliveryZone("")).toBe("ambiguous");
      expect(detectDeliveryZone("   ")).toBe("ambiguous");
      expect(detectDeliveryZone("123456")).toBe("ambiguous");
      expect(detectDeliveryZone("Unknown Location Landmark")).toBe("ambiguous");
    });

    it("calculateOrderPricing clamps coupons to prevent negative grand totals", () => {
      // Fixed coupon > subtotal (Subtotal 500, Coupon 800)
      const resFixed = calculateOrderPricing({
        items: [{ unitPrice: 500, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        coupon: { type: "fixed", value: 800 },
        rates: { insideDhaka: 80 },
      });
      expect(resFixed.subtotal).toBe(500);
      expect(resFixed.discountAmount).toBe(500); // Clamped to subtotal
      expect(resFixed.grandTotal).toBe(80); // Subtotal (0) + Delivery (80)

      // Percentage coupon > 100% (Clamped to 100%)
      const resPct = calculateOrderPricing({
        items: [{ unitPrice: 1000, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        coupon: { type: "percentage", value: 150 },
        rates: { insideDhaka: 80 },
      });
      expect(resPct.discountAmount).toBe(1000);
      expect(resPct.grandTotal).toBe(80);
    });

    it("evaluates free delivery exact thresholds accurately", () => {
      const threshold = 1500;

      // 1 cent under threshold
      const underRes = calculateOrderPricing({
        items: [{ unitPrice: 1499.99, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        freeShippingThreshold: threshold,
        rates: { insideDhaka: 80 },
      });
      expect(underRes.isFreeDelivery).toBe(false);
      expect(underRes.deliveryFee).toBe(80);

      // Exactly at threshold
      const exactRes = calculateOrderPricing({
        items: [{ unitPrice: 1500.0, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        freeShippingThreshold: threshold,
        rates: { insideDhaka: 80 },
      });
      expect(exactRes.isFreeDelivery).toBe(true);
      expect(exactRes.deliveryFee).toBe(0);

      // Above threshold
      const aboveRes = calculateOrderPricing({
        items: [{ unitPrice: 2000, quantity: 1 }],
        deliveryZone: "outside_dhaka",
        freeShippingThreshold: threshold,
        rates: { outsideDhaka: 150 },
      });
      expect(aboveRes.isFreeDelivery).toBe(true);
      expect(aboveRes.deliveryFee).toBe(0);
    });

    it("Outside Dhaka advance payment guard only triggers on Cash on Delivery orders", () => {
      // Outside Dhaka + COD -> advance required
      const codRes = calculateOrderPricing({
        items: [{ unitPrice: 1200, quantity: 1 }],
        deliveryZone: "outside_dhaka",
        paymentMethod: "cod",
        requireOutsideDhakaAdvance: true,
        outsideDhakaAdvanceAmount: 120,
        rates: { outsideDhaka: 150 },
      });
      expect(codRes.advanceRequired).toBe(true);
      expect(codRes.advanceAmount).toBe(120);
      expect(codRes.codDueAmount).toBe(1350 - 120); // 1230

      // Outside Dhaka + bKash (prepaid) -> advance NOT required
      const bkashRes = calculateOrderPricing({
        items: [{ unitPrice: 1200, quantity: 1 }],
        deliveryZone: "outside_dhaka",
        paymentMethod: "bkash",
        requireOutsideDhakaAdvance: true,
        outsideDhakaAdvanceAmount: 120,
        rates: { outsideDhaka: 150 },
      });
      expect(bkashRes.advanceRequired).toBe(false);
      expect(bkashRes.advanceAmount).toBe(0);
      expect(bkashRes.codDueAmount).toBe(1350);

      // Inside Dhaka + COD -> advance NOT required
      const insideCodRes = calculateOrderPricing({
        items: [{ unitPrice: 1200, quantity: 1 }],
        deliveryZone: "inside_dhaka",
        paymentMethod: "cod",
        requireOutsideDhakaAdvance: true,
      });
      expect(insideCodRes.advanceRequired).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Phone Normalization & Conversational Slot-Filler Stress Testing
  // --------------------------------------------------------------------------
  describe("5. Phone Number Normalization & Conversational Slot-Filler", () => {
    it("converts Bengali numerals to English accurately", () => {
      expect(convertBengaliDigitsToEnglish("০১৭০০-১২৩৪৫৬")).toBe(
        "01700-123456",
      );
      expect(convertBengaliDigitsToEnglish("১২৩৪৫৬৭৮৯০")).toBe("1234567890");
      expect(convertBengaliDigitsToEnglish("No digits")).toBe("No digits");
    });

    it("normalizes diverse Bangladeshi mobile number formats", () => {
      // With +88 prefix
      expect(normalizeBdPhoneNumber("+8801712345678").normalizedPhone).toBe(
        "01712345678",
      );

      // With 88 prefix
      expect(normalizeBdPhoneNumber("8801812345678").normalizedPhone).toBe(
        "01812345678",
      );

      // With 00880 prefix
      expect(normalizeBdPhoneNumber("008801912345678").normalizedPhone).toBe(
        "01912345678",
      );

      // 10 digits without leading 0
      expect(normalizeBdPhoneNumber("1312345678").normalizedPhone).toBe(
        "01312345678",
      );

      // Dashes, spaces and dots
      expect(normalizeBdPhoneNumber("016-1234-5678").normalizedPhone).toBe(
        "01612345678",
      );
      expect(normalizeBdPhoneNumber("015.1234.5678").normalizedPhone).toBe(
        "01512345678",
      );
      expect(normalizeBdPhoneNumber("(014) 12345678").normalizedPhone).toBe(
        "01412345678",
      );

      // Bengali digits with country code
      expect(normalizeBdPhoneNumber("+৮৮০১৭১২-৩৪৫৬৭৮").normalizedPhone).toBe(
        "01712345678",
      );
    });

    it("rejects invalid Bangladeshi mobile numbers", () => {
      // Invalid operator prefixes
      expect(normalizeBdPhoneNumber("01012345678").isValid).toBe(false);
      expect(normalizeBdPhoneNumber("01112345678").isValid).toBe(false);
      expect(normalizeBdPhoneNumber("01212345678").isValid).toBe(false);

      // Wrong length (too short or too long)
      expect(normalizeBdPhoneNumber("017123456").isValid).toBe(false);
      expect(normalizeBdPhoneNumber("0171234567899").isValid).toBe(false);

      // Embedded letters or garbage
      expect(normalizeBdPhoneNumber("01712abcd56").isValid).toBe(false);
      expect(normalizeBdPhoneNumber("").isValid).toBe(false);
      expect(normalizeBdPhoneNumber(null).isValid).toBe(false);
    });

    it("extracts structured customer details from multiline formatted text", () => {
      const msg = `
        Name: Md. Tanvir Ahmed
        Phone: 01711-223344
        Address: House 12, Road 5, Mirpur-10, Dhaka
        Payment: Cash on delivery
      `;

      const slots = extractSlotsFromText(msg);
      expect(slots.customerName).toBe("Md. Tanvir Ahmed");
      expect(slots.phoneNumber).toBe("01711223344");
      expect(slots.deliveryAddress).toContain("Mirpur-10");
      expect(slots.deliveryZone).toBe("inside_dhaka");
      expect(slots.paymentMethod).toBe("cod");
    });

    it("generates turn-by-turn prompts for missing slots across languages", () => {
      const validationMissingPhone = validateOrderSlots({
        customerName: "Rahim",
        deliveryAddress: "Dhanmondi, Dhaka",
        deliveryZone: "inside_dhaka",
        items: [{ productId: "1", quantity: 1, price: 1000 }],
        paymentMethod: "cod",
      });

      const promptPhoneBanglish = getMissingSlotsPrompt(
        validationMissingPhone,
        "banglish",
      );
      expect(promptPhoneBanglish).toContain("11-digit mobile number");

      const promptPhoneBangla = getMissingSlotsPrompt(
        validationMissingPhone,
        "bangla",
      );
      expect(promptPhoneBangla).toContain("১১ ডিজিটের সচল মোবাইল নাম্বারটি দিন");

      const promptPhoneEnglish = getMissingSlotsPrompt(
        validationMissingPhone,
        "english",
      );
      expect(promptPhoneEnglish).toContain("11-digit mobile number");
    });
  });

  // --------------------------------------------------------------------------
  // 6. Order Flow State Machine Transitions, Advance Guards & Cancellation
  // --------------------------------------------------------------------------
  describe("6. Order Flow State Machine & Transitions", () => {
    it("cancels active order flow when customer states cancellation intent", async () => {
      const manager = new OrderFlowManager();
      const mockAdapter: ECommercePlatformAdapter = {
        platform: "woocommerce",
        syncProducts: async () => [],
        checkStock: async () => ({ available: true, items: [], totalPrice: 0 }),
        createOrder: async () => ({
          success: true,
          orderId: "123",
          orderTotal: 0,
          status: "created",
        }),
      };

      const session = manager.getOrCreateSession("comp-1", "user-cancel-1");
      manager.addItem(session, {
        productId: "101",
        quantity: 1,
        price: 1500,
      });

      const res = await manager.processMessage({
        companyId: "comp-1",
        contactId: "user-cancel-1",
        message: "order lagbe na, cancel koren",
        adapter: mockAdapter,
        language: "banglish",
      });

      expect(res.state).toBe("CANCELLED");
      expect(res.replyText).toContain("cancel kora hoyeche");
      expect(manager.hasActiveSession("user-cancel-1")).toBe(false);
    });

    it("enforces Outside Dhaka Advance Payment confirmation before presenting order summary", async () => {
      const manager = new OrderFlowManager();
      const mockAdapter: ECommercePlatformAdapter = {
        platform: "woocommerce",
        syncProducts: async () => [],
        checkStock: async () => ({ available: true, items: [], totalPrice: 0 }),
        createOrder: async () => ({
          success: true,
          orderId: "WC-999",
          orderTotal: 1650,
          status: "processing",
        }),
      };

      // Step 1: Customer provides all details outside Dhaka
      const step1 = await manager.processMessage({
        companyId: "comp-1",
        contactId: "user-outside-advance",
        message:
          "Name: Asif, Phone: 01812345678, Address: GEC Circle, Chittagong",
        initialItems: [
          {
            productId: "201",
            productName: "Silk Kurti",
            quantity: 1,
            price: 1500,
          },
        ],
        adapter: mockAdapter,
        language: "banglish",
      });

      // Must be held at AWAITING_ADVANCE_CONFIRMATION
      expect(step1.state).toBe("AWAITING_ADVANCE_CONFIRMATION");
      expect(step1.replyText).toContain("advance bKash ba Nagad");

      // Step 2: Customer agrees to advance
      const step2 = await manager.processMessage({
        companyId: "comp-1",
        contactId: "user-outside-advance",
        message: "Ji advance dibo, thik ache",
        adapter: mockAdapter,
        language: "banglish",
      });

      // Transitions to AWAITING_ORDER_CONFIRMATION with Order Summary
      expect(step2.state).toBe("AWAITING_ORDER_CONFIRMATION");
      expect(step2.replyText).toContain("Order Summary");
      expect(step2.replyText).toContain("Advance Courier Charge");
      expect(step2.replyText).toContain("৳120");

      // Step 3: Customer confirms order
      const step3 = await manager.processMessage({
        companyId: "comp-1",
        contactId: "user-outside-advance",
        message: "Confirm koren",
        adapter: mockAdapter,
        language: "banglish",
      });

      expect(step3.state).toBe("ORDER_PLACED");
      expect(step3.isOrderPlaced).toBe(true);
      expect(step3.orderResult?.orderId).toBe("WC-999");
      expect(step3.replyText).toContain("#WC-999");
    });

    it("handles adapter order booking error gracefully without breaking conversation state", async () => {
      const manager = new OrderFlowManager();
      const failingAdapter: ECommercePlatformAdapter = {
        platform: "woocommerce",
        syncProducts: async () => [],
        checkStock: async () => ({ available: true, items: [], totalPrice: 0 }),
        createOrder: async () => ({
          success: false,
          orderId: "",
          orderTotal: 0,
          status: "failed",
          error: "An item in your cart is currently out of stock",
        }),
      };

      // Put session into AWAITING_ORDER_CONFIRMATION
      const session = manager.getOrCreateSession("comp-1", "user-order-fail");
      session.state = "AWAITING_ORDER_CONFIRMATION";
      session.slots = {
        customerName: "Test User",
        phoneNumber: "01711223344",
        deliveryAddress: "Uttara, Dhaka",
        deliveryZone: "inside_dhaka",
        items: [{ productId: "101", quantity: 1, price: 500 }],
        paymentMethod: "cod",
      };

      const res = await manager.processMessage({
        companyId: "comp-1",
        contactId: "user-order-fail",
        message: "Confirm",
        adapter: failingAdapter,
        language: "bangla",
      });

      expect(res.state).toBe("AWAITING_ORDER_CONFIRMATION");
      expect(res.isOrderPlaced).toBe(false);
      expect(res.replyText).toContain("সমস্যা দেখা দিয়েছে");
    });
  });

  // --------------------------------------------------------------------------
  // 7. Handoff Service Profanity, Complaint Detection & Circuit Breaker Failsafes
  // --------------------------------------------------------------------------
  describe("7. Handoff Service & Circuit Breaker Failsafes", () => {
    it("flags high anger sentiment on severe threats or multiple complaint keywords", () => {
      const handoff = new HandoffService();

      // Police threat
      const policeEval = handoff.evaluateHandoff(
        "Ami police e case korbo fraud company",
      );
      expect(policeEval.shouldHandoff).toBe(true);
      expect(policeEval.reason).toBe("complaint");
      expect(policeEval.sentiment).toBe("angry");

      // Bengali threat
      const bngEval = handoff.evaluateHandoff("বাটপার কোম্পানি, মামলা করব!");
      expect(bngEval.shouldHandoff).toBe(true);
      expect(bngEval.sentiment).toBe("angry");

      // Mild complaint (single keyword)
      const mildEval = handoff.evaluateHandoff("Product ta ektu vanga chilo");
      expect(mildEval.shouldHandoff).toBe(true);
      expect(mildEval.sentiment).toBe("negative");
    });

    it("triggers confusion handoff after consecutive low confidence evaluations", () => {
      const handoff = new HandoffService();

      const confEval = handoff.evaluateHandoff("asdfghjkl", {
        consecutiveLowConfidence: 2,
      });

      expect(confEval.shouldHandoff).toBe(true);
      expect(confEval.reason).toBe("confusion");
      expect(confEval.customerHandoverText).toBeDefined();
    });

    it("shouldSuppressAiReply fails safe when database throws unexpected exception", async () => {
      const handoff = new HandoffService();
      const brokenDb = {
        selectFrom: () => {
          throw new Error("DB Pool Terminated");
        },
      };

      const status = await handoff.shouldSuppressAiReply(
        brokenDb,
        "contact-123",
      );
      expect(status.isSuppressed).toBe(true);
      expect(status.reason).toBe("db_error_fail_safe");
    });

    it("executes pauseAi and resumeAi lifecycle cleanly updating contact tags", async () => {
      const handoff = new HandoffService();
      const mockDb = createMockTenantDb({ tags: [] });

      // 1. Pause AI
      const pauseRes = await handoff.pauseAi(
        "comp-1",
        "cont-pause-test",
        "manual_pause",
        undefined,
        mockDb,
      );
      expect(pauseRes.isPaused).toBe(true);

      // 2. Check AI status
      const statusRes = await handoff.getAiStatus(
        "comp-1",
        "cont-pause-test",
        mockDb,
      );
      expect(statusRes.isPaused).toBe(true);
      expect(statusRes.lastReason).toBe("ai_paused");

      // 3. Resume AI
      const resumeRes = await handoff.resumeAi(
        "comp-1",
        "cont-pause-test",
        undefined,
        mockDb,
      );
      expect(resumeRes.isPaused).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 8. E-Commerce Sync Adapters (WooCommerce & Shopify) & Inventory Cache
  // --------------------------------------------------------------------------
  describe("8. E-Commerce Platform Adapters & Inventory Caching", () => {
    it("WooCommerceClient handles HTTP 401/403 and server timeouts cleanly", async () => {
      const mockFetch401: any = async () => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers({ "content-type": "application/json" }),
        text: async () =>
          JSON.stringify({
            code: "woocommerce_rest_cannot_view",
            message: "Consumer key is invalid.",
          }),
      });

      const wcClient = new WooCommerceClient({
        baseUrl: "https://shop.example.com",
        consumerKey: "ck_bad",
        consumerSecret: "cs_bad",
        customFetch: mockFetch401,
      });

      let wcError: WooCommerceError | null = null;
      try {
        await wcClient.getProduct("101");
      } catch (err) {
        wcError = err as WooCommerceError;
      }

      expect(wcError).not.toBeNull();
      expect(wcError?.status).toBe(401);
      expect(wcError?.code).toBe("woocommerce_rest_cannot_view");
    });

    it("ShopifyClient handles GraphQL rate limit HTTP 429 correctly", async () => {
      const mockFetch429: any = async () => ({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      const shopifyClient = new ShopifyClient({
        shopDomain: "mytestshop.myshopify.com",
        accessToken: "shpat_test_token",
        customFetch: mockFetch429,
      });

      let shopifyErr: ShopifyError | null = null;
      try {
        await shopifyClient.syncProducts();
      } catch (err) {
        shopifyErr = err as ShopifyError;
      }

      expect(shopifyErr).not.toBeNull();
      expect(shopifyErr?.status).toBe(429);
      expect(shopifyErr?.code).toBe("shopify_throttled");
    });

    it("InventoryService permits backorders when backorders_allowed is true even with 0 stock", () => {
      const invService = new InventoryService();

      // Case A: 0 stock, backorders disabled -> rejected
      const resNoBackorder = invService.evaluateStock({
        stock_status: "instock",
        manage_stock: true,
        stock_quantity: 0,
        backorders_allowed: false,
      });
      expect(resNoBackorder.available).toBe(false);

      // Case B: 0 stock, backorders permitted -> approved
      const resWithBackorder = invService.evaluateStock({
        stock_status: "instock",
        manage_stock: true,
        stock_quantity: 0,
        backorders_allowed: true,
      });
      expect(resWithBackorder.available).toBe(true);

      // Case C: negative stock (-3 units), backorders permitted -> approved
      const resNegativeBackorder = invService.evaluateStock({
        stock_status: "instock",
        manage_stock: true,
        stock_quantity: -3,
        backorders_allowed: true,
      });
      expect(resNegativeBackorder.available).toBe(true);
    });

    it("InventoryService caches live stock results and respects bypassCache flag", async () => {
      const invService = new InventoryService();
      invService.clearCache();

      let adapterCallCount = 0;
      const countingAdapter: ECommercePlatformAdapter = {
        platform: "woocommerce",
        syncProducts: async () => [],
        checkStock: async (items: StockCheckItem[]) => {
          adapterCallCount++;
          return {
            available: true,
            items: items.map((i) => ({
              productId: i.productId,
              variationId: i.variationId,
              available: true,
              availableQuantity: 10,
              unitPrice: 1200,
            })),
            totalPrice: 1200,
          };
        },
        createOrder: async () => ({
          success: true,
          orderId: "1",
          orderTotal: 1200,
          status: "created",
        }),
      };

      const testCart = [{ productId: "prod-cache-test", quantity: 1 }];

      // Call 1: uncached -> calls adapter
      const res1 = await invService.validateCartStock(
        countingAdapter,
        testCart,
      );
      expect(res1.available).toBe(true);
      expect(adapterCallCount).toBe(1);

      // Call 2: cached -> does NOT call adapter again
      const res2 = await invService.validateCartStock(
        countingAdapter,
        testCart,
      );
      expect(res2.available).toBe(true);
      expect(adapterCallCount).toBe(1);

      // Call 3: with bypassCache: true -> forces adapter re-fetch
      const res3 = await invService.validateCartStock(
        countingAdapter,
        testCart,
        {
          bypassCache: true,
        },
      );
      expect(res3.available).toBe(true);
      expect(adapterCallCount).toBe(2);
    });

    it("finds in-stock alternative variants by color and size matching", () => {
      const invService = new InventoryService();

      const sampleProduct: UnifiedProduct = {
        id: "prod-panjabi",
        name: "Designer Panjabi",
        sku: "PAN-100",
        price: 2000,
        regularPrice: 2000,
        description: "Fine Panjabi",
        images: [],
        inStock: true,
        stockQuantity: 10,
        attributes: [
          { name: "Size", options: ["M", "L", "XL"] },
          { name: "Color", options: ["White", "Black"] },
        ],
        variations: [
          {
            id: "v-m-white",
            sku: "PAN-M-W",
            price: 2000,
            inStock: false, // SOLD OUT
            stockQuantity: 0,
            attributes: { Size: "M", Color: "White" },
          },
          {
            id: "v-l-white",
            sku: "PAN-L-W",
            price: 2000,
            inStock: true, // IN STOCK
            stockQuantity: 4,
            attributes: { Size: "L", Color: "White" },
          },
          {
            id: "v-m-black",
            sku: "PAN-M-B",
            price: 2000,
            inStock: true, // IN STOCK
            stockQuantity: 3,
            attributes: { Size: "M", Color: "Black" },
          },
        ],
      };

      // Customer wanted Size M in White which is sold out
      const alternatives = invService.findInStockAlternatives(
        sampleProduct,
        "v-m-white",
      );
      expect(alternatives.length).toBeGreaterThanOrEqual(2);

      // Should offer same color in different size (Size L in White) as highest priority
      expect(alternatives[0].matchType).toBe("same_color_different_size");
      expect(alternatives[0].variation.id).toBe("v-l-white");
    });
  });
});
