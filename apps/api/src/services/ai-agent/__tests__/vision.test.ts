/**
 * Comprehensive Unit Test Suite for Multimodal Vision & Product Recognition Pipeline (Milestone 2)
 * Location: apps/api/src/services/ai-agent/__tests__/vision.test.ts
 *
 * Test Scenarios:
 * 1. Product screenshot matching with price/code overlay (e.g. VDJ-09, 2800 Tk)
 * 2. Photo of garment matching catalog item (visual attributes: category, color, pattern)
 * 3. bKash/Nagad receipt OCR and transaction extraction (TrxID, amount, provider)
 * 4. Non-catalog image fallback (polite clarification, out-of-catalog handling)
 * 5. Low-resolution/corrupted image handling (empty buffers, bad headers, malformed base64)
 * 6. AiOrchestratorService integration with image attachments & circuit breaker checks
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AiOrchestratorService } from "../ai-orchestrator.service.js";
import { GeminiClient } from "../gemini/gemini.client.js";
import {
  buildDeterministicGroundedReply,
  detectMimeTypeFromMagicBytes,
  extractReceiptViaRegex,
  extractVariationOptions,
  formatGroundedTurnPrompt,
  ingestImageToInlineData,
  parseVisionModelResponse,
  searchCatalogByVisualFeatures,
  VisionService,
  visionService,
} from "../gemini/vision.service.js";
import { GeminiOfflineSimulationHarness } from "../testing/gemini-mock-harness.js";

// Shared Gemini offline simulation harness
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

      constructor(options: { apiKey: string }) {
        this.apiKey = options.apiKey;
      }
    },
  };
});

// Realistic mock product catalog
const mockCatalogProducts = [
  {
    id: "p1",
    product_id: "prod-101",
    catalog_id: "cat-1",
    name: "Vintage Denim Jacket",
    description:
      "Premium washed blue denim jacket with sherpa fleece collar. Sizes: M, L, XL. Regular fit.",
    price: 2800,
    currency: "BDT",
    image_urls: ["https://example.com/denim-jacket.jpg"],
    sku: "VDJ-09",
    category: "Outerwear / Denim Jacket",
    availability: "in stock",
    visibility: "visible",
  },
  {
    id: "p2",
    product_id: "prod-102",
    catalog_id: "cat-1",
    name: "Maroon Embroidered Kurti",
    description:
      "Traditional maroon georgette kurti with gold zari floral embroidery. Available sizes: S, M, L, XL. Color: Maroon.",
    price: 1850,
    currency: "BDT",
    image_urls: ["https://example.com/maroon-kurti.jpg"],
    sku: "KRT-202",
    category: "Women / Kurti",
    availability: "in stock",
    visibility: "visible",
  },
  {
    id: "p3",
    product_id: "prod-103",
    catalog_id: "cat-1",
    name: "Royal Navy Blue Silk Panjabi",
    description:
      "Exclusive royal navy silk panjabi for Eid and weddings. Sizes: 40, 42, 44.",
    price: 3200,
    currency: "BDT",
    image_urls: ["https://example.com/silk-panjabi.jpg"],
    sku: "PNJ-303",
    category: "Men / Panjabi",
    availability: "in stock",
    visibility: "visible",
  },
  {
    id: "p4",
    product_id: "prod-104",
    catalog_id: "cat-1",
    name: "Classic Black Leather Boots",
    description: "Genuine black leather high ankle boots. Sizes: 41, 42, 43.",
    price: 4500,
    currency: "BDT",
    image_urls: ["https://example.com/black-boots.jpg"],
    sku: "BOT-404",
    category: "Footwear / Boots",
    availability: "out of stock", // Tested for out of stock notification
    visibility: "visible",
  },
];

function createMockTenantDb(catalogItems = mockCatalogProducts) {
  return {
    selectFrom: (table: string) => {
      if (table === "catalog_products") {
        return {
          selectAll: () => ({
            execute: async () => catalogItems,
          }),
        };
      }
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
      };
    },
  };
}

// Valid binary image fixtures
const VALID_JPEG_BUFFER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00,
]);
const VALID_PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);
const VALID_WEBP_BUFFER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20,
]);

describe("Milestone 2: Multimodal Vision & Product Recognition Pipeline", () => {
  let geminiClient: GeminiClient;

  beforeEach(() => {
    harness.reset();
    geminiClient = new GeminiClient({ apiKey: "test-vision-api-key" });
  });

  afterEach(() => {
    harness.reset();
  });

  // ==========================================================================
  // 1. Image Ingestion & Validation
  // ==========================================================================
  describe("1. Image Ingestion, Header Magic Bytes & Corruption Checks", () => {
    test("detects correct MIME type from JPEG, PNG, and WebP magic bytes", () => {
      expect(detectMimeTypeFromMagicBytes(VALID_JPEG_BUFFER)).toBe(
        "image/jpeg",
      );
      expect(detectMimeTypeFromMagicBytes(VALID_PNG_BUFFER)).toBe("image/png");
      expect(detectMimeTypeFromMagicBytes(VALID_WEBP_BUFFER)).toBe(
        "image/webp",
      );
    });

    test("validates valid buffers and returns normalized inline data", async () => {
      const result = await ingestImageToInlineData(VALID_JPEG_BUFFER);
      expect(result.mimeType).toBe("image/jpeg");
      expect(result.data).toBe(VALID_JPEG_BUFFER.toString("base64"));
    });

    test("accepts base64 data URI format", async () => {
      const dataUri = `data:image/png;base64,${VALID_PNG_BUFFER.toString("base64")}`;
      const result = await ingestImageToInlineData(dataUri);
      expect(result.mimeType).toBe("image/png");
      expect(result.data).toBe(VALID_PNG_BUFFER.toString("base64"));
    });

    test("throws ImageIngestionError on empty 0-byte buffer", async () => {
      const emptyBuffer = Buffer.alloc(0);
      expect(ingestImageToInlineData(emptyBuffer)).rejects.toThrow(
        /buffer is empty/i,
      );
    });

    test("throws ImageIngestionError on truncated header < 12 bytes", async () => {
      const truncated = Buffer.from([0xff, 0xd8, 0xff]);
      expect(ingestImageToInlineData(truncated)).rejects.toThrow(/too small/i);
    });

    test("throws ImageIngestionError on corrupted non-image content", async () => {
      const corrupted = Buffer.from(
        "this is plain ASCII text and definitely not an image file header",
      );
      expect(ingestImageToInlineData(corrupted)).rejects.toThrow(
        /Unrecognized image format or corrupted/i,
      );
    });

    test("throws ImageIngestionError on malformed base64 string", async () => {
      expect(
        ingestImageToInlineData(
          "data:image/jpeg;base64,NOT_VALID_BASE64_BYTES!!!",
        ),
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 2. Product Screenshot Matching (Price/Code Overlay)
  // ==========================================================================
  describe("2. Product Screenshot Matching with Price/Code Overlay", () => {
    test("accurately extracts OCR text, SKU code, and overlay price from screenshot", async () => {
      const rawVisionResponse = JSON.stringify({
        isPaymentReceipt: false,
        receiptDetails: null,
        productFeatures: {
          ocrText:
            "OmniTeam Winter Drop: Vintage Denim Jacket BDT 2,800 Code: VDJ-09 Sherpa Warmth",
          detectedCodes: ["VDJ-09"],
          detectedPrices: [2800],
          category: "Outerwear / Denim Jacket",
          primaryColor: "Blue",
          secondaryColors: ["White"],
          style: "Casual",
          pattern: "Solid",
          description: "Washed blue denim jacket with fleece sherpa collar.",
        },
        confidence: 0.98,
      });

      harness.onPattern(/ei jacket|Extract product OCR/i, rawVisionResponse);

      const extraction = await visionService.extractVisionFeatures(
        { mimeType: "image/jpeg", data: VALID_JPEG_BUFFER.toString("base64") },
        geminiClient,
        "bhai ei jacket ta ache? price koto?",
      );

      expect(extraction.isPaymentReceipt).toBe(false);
      expect(extraction.productFeatures).not.toBeNull();
      expect(extraction.productFeatures?.detectedCodes).toContain("VDJ-09");
      expect(extraction.productFeatures?.detectedPrices).toContain(2800);
      expect(extraction.productFeatures?.category).toBe(
        "Outerwear / Denim Jacket",
      );
    });

    test("matches product VDJ-09 in catalog_products and returns active variants", async () => {
      const features = {
        ocrText: "Vintage Denim Jacket Code: VDJ-09 Price: 2,800 BDT",
        detectedCodes: ["VDJ-09"],
        detectedPrices: [2800],
        category: "Outerwear / Denim Jacket",
        primaryColor: "Blue",
        secondaryColors: ["White"],
        style: "Casual",
        pattern: "Solid",
        description: "Denim jacket with fleece collar",
      };

      const searchResult = await searchCatalogByVisualFeatures(
        "company-123",
        features,
        { tenantDb: createMockTenantDb() },
      );

      expect(searchResult.isCatalogMatch).toBe(true);
      expect(searchResult.bestMatch).not.toBeNull();
      expect(searchResult.bestMatch?.productId).toBe("prod-101");
      expect(searchResult.bestMatch?.sku).toBe("VDJ-09");
      expect(searchResult.bestMatch?.price).toBe(2800);
      expect(searchResult.bestMatch?.inStock).toBe(true);
      expect(
        searchResult.bestMatch?.variationOptions?.find((v) => v.name === "Size")
          ?.options,
      ).toEqual(["M", "L", "XL"]);
    });

    test("produces grounded language-mirrored response with price and active size variants", async () => {
      const features = {
        ocrText: "Code: VDJ-09 2,800 Tk",
        detectedCodes: ["VDJ-09"],
        detectedPrices: [2800],
        category: "Outerwear / Denim Jacket",
        primaryColor: "Blue",
        secondaryColors: [],
        style: "Casual",
        pattern: null,
        description: "Denim jacket",
      };

      const searchResult = await searchCatalogByVisualFeatures(
        "company-123",
        features,
        { tenantDb: createMockTenantDb() },
      );

      const groundedPrompt = formatGroundedTurnPrompt({
        extraction: {
          isPaymentReceipt: false,
          receiptDetails: null,
          productFeatures: features,
          confidence: 0.95,
        },
        bestMatch: searchResult.bestMatch,
        candidateProducts: searchResult.matches,
        customerQuery: "bhai ei jacket ta hobe?",
        language: "banglish",
      });

      expect(groundedPrompt).toContain("Vintage Denim Jacket");
      expect(groundedPrompt).toContain("VDJ-09");
      expect(groundedPrompt).toContain("2800 BDT");
      expect(groundedPrompt).toContain("IN STOCK");

      // Deterministic reply check
      const reply = buildDeterministicGroundedReply({
        extraction: {
          isPaymentReceipt: false,
          receiptDetails: null,
          productFeatures: features,
          confidence: 0.95,
        },
        bestMatch: searchResult.bestMatch,
        candidateProducts: searchResult.matches,
        language: "banglish",
      });

      expect(reply).toContain("Vintage Denim Jacket");
      expect(reply).toContain("VDJ-09");
      expect(reply).toContain("2800 Tk");
      expect(reply).toContain("M, L, XL size available ache");
      expect(reply).toContain("Apnar kon size ta lagbe?");
    });
  });

  // ==========================================================================
  // 3. Photo of Garment Matching Catalog Item
  // ==========================================================================
  describe("3. Photo of Garment Matching Catalog Item (Visual Attributes Only)", () => {
    test("matches garment based on category, color, and visual description without overlay code", async () => {
      // Photo of maroon kurti taken with customer phone camera (no text overlay)
      const visualFeatures = {
        ocrText: "", // zero OCR text
        detectedCodes: [],
        detectedPrices: [],
        category: "Women / Kurti",
        primaryColor: "Maroon",
        secondaryColors: ["Gold"],
        style: "Traditional",
        pattern: "Floral Embroidered",
        description:
          "Traditional maroon georgette kurti with gold embroidery work.",
      };

      const searchResult = await searchCatalogByVisualFeatures(
        "company-123",
        visualFeatures,
        { tenantDb: createMockTenantDb() },
      );

      expect(searchResult.isCatalogMatch).toBe(true);
      expect(searchResult.bestMatch?.productId).toBe("prod-102");
      expect(searchResult.bestMatch?.name).toBe("Maroon Embroidered Kurti");
      expect(searchResult.bestMatch?.price).toBe(1850);
      expect(searchResult.bestMatch?.matchReason).toContain("Category match");
      expect(searchResult.bestMatch?.matchReason).toContain("Color match");
    });

    test("correctly parses variation options from product text", () => {
      const desc =
        "Exclusive maroon kurti. Available sizes: S, M, L, XL. Colors: Maroon, Navy Blue.";
      const variations = extractVariationOptions(desc, "Maroon Kurti");

      const sizeVar = variations.find((v) => v.name === "Size");
      const colorVar = variations.find((v) => v.name === "Color");

      expect(sizeVar?.options).toEqual(["S", "M", "L", "XL"]);
      expect(colorVar?.options).toContain("Maroon");
      expect(colorVar?.options).toContain("Navy Blue");
    });
  });

  // ==========================================================================
  // 4. bKash / Nagad Receipt OCR & Transaction Extraction
  // ==========================================================================
  describe("4. Payment Receipt OCR & Extraction (bKash, Nagad, Rocket)", () => {
    test("extracts bKash transaction ID, amount, and sender from SMS screenshot", () => {
      const smsText =
        "You have received Tk 1,500.00 from 01712345678. Fee Tk 0.00. Balance Tk 4,200.50. TrxID BL10ABC123 at 26/10/2026 14:30.";
      const receipt = extractReceiptViaRegex(smsText);

      expect(receipt).not.toBeNull();
      expect(receipt?.provider).toBe("bkash");
      expect(receipt?.transactionId).toBe("BL10ABC123");
      expect(receipt?.amount).toBe(1500);
      expect(receipt?.senderNumber).toBe("01712345678");
    });

    test("extracts Nagad payment receipt transaction ID and amount", () => {
      const nagadText =
        "Nagad: Payment of Tk 2,000 received. TxnID: 78XY99Z. Customer: 01899887766.";
      const receipt = extractReceiptViaRegex(nagadText);

      expect(receipt).not.toBeNull();
      expect(receipt?.provider).toBe("nagad");
      expect(receipt?.transactionId).toBe("78XY99Z");
      expect(receipt?.amount).toBe(2000);
    });

    test("parses structured JSON model output for payment receipt", () => {
      const modelJson = JSON.stringify({
        isPaymentReceipt: true,
        receiptDetails: {
          provider: "bkash",
          transactionId: "BL10ABC123",
          amount: 1500,
          senderNumber: "01712345678",
          receiverNumber: "01811223344",
          timestamp: "2026-10-26T12:00:00Z",
        },
        productFeatures: null,
        confidence: 0.99,
      });

      const parsed = parseVisionModelResponse(modelJson);
      expect(parsed.isPaymentReceipt).toBe(true);
      expect(parsed.receiptDetails?.provider).toBe("bkash");
      expect(parsed.receiptDetails?.transactionId).toBe("BL10ABC123");
      expect(parsed.receiptDetails?.amount).toBe(1500);
    });

    test("generates polite payment receipt confirmation message in Banglish", () => {
      const reply = buildDeterministicGroundedReply({
        extraction: {
          isPaymentReceipt: true,
          receiptDetails: {
            provider: "bkash",
            transactionId: "BL10ABC123",
            amount: 1500,
          },
          productFeatures: null,
          confidence: 0.95,
        },
        bestMatch: null,
        candidateProducts: [],
        language: "banglish",
      });

      expect(reply).toContain("Dhonnobad bhaiya!");
      expect(reply).toContain("BKASH payment receipt peyechi");
      expect(reply).toContain("1500 Tk");
      expect(reply).toContain("TrxID: BL10ABC123");
      expect(reply).toContain(
        "payment ta verify kore apnar order confirm kore dichhi",
      );
    });

    test("generates payment receipt confirmation in Bengali script", () => {
      const reply = buildDeterministicGroundedReply({
        extraction: {
          isPaymentReceipt: true,
          receiptDetails: {
            provider: "nagad",
            transactionId: "NG992211",
            amount: 120,
          },
          productFeatures: null,
          confidence: 0.95,
        },
        bestMatch: null,
        candidateProducts: [],
        language: "bangla",
      });

      expect(reply).toContain("ধন্যবাদ ভাইয়া!");
      expect(reply).toContain("NAGAD পেমেন্ট রিসিট পেয়েছি");
      expect(reply).toContain("120 টাকা");
      expect(reply).toContain("TrxID: NG992211");
    });
  });

  // ==========================================================================
  // 5. Non-Catalog Image Fallback & Out-of-Stock Handling
  // ==========================================================================
  describe("5. Non-Catalog Image Fallback & Out-of-Stock Handling", () => {
    test("gracefully falls back to polite clarification when image is not in catalog", async () => {
      // Image of an unrelated object (e.g. coffee mug or sports car)
      const unrelatedFeatures = {
        ocrText: "Ceramic Coffee Mug 350ml",
        detectedCodes: ["MUG-01"],
        detectedPrices: [350],
        category: "Kitchenware / Mugs",
        primaryColor: "White",
        secondaryColors: [],
        style: "Modern",
        pattern: null,
        description: "White ceramic mug with coffee logo.",
      };

      const searchResult = await searchCatalogByVisualFeatures(
        "company-123",
        unrelatedFeatures,
        { tenantDb: createMockTenantDb() },
      );

      expect(searchResult.isCatalogMatch).toBe(false);
      expect(searchResult.bestMatch).toBeNull();

      const reply = buildDeterministicGroundedReply({
        extraction: {
          isPaymentReceipt: false,
          receiptDetails: null,
          productFeatures: unrelatedFeatures,
          confidence: 0.9,
        },
        bestMatch: null,
        candidateProducts: searchResult.matches,
        language: "banglish",
      });

      expect(reply).toContain("Dukkhito bhaiya");
      expect(reply).toContain("ei product ti amader catalog e pawa jayni");
      expect(reply).toContain("amader running collection theke dekhte chan?");
    });

    test("handles matched product that is OUT OF STOCK politely", async () => {
      const outOfStockFeatures = {
        ocrText: "Classic Black Leather Boots Code: BOT-404 Price: 4,500 BDT",
        detectedCodes: ["BOT-404"],
        detectedPrices: [4500],
        category: "Footwear / Boots",
        primaryColor: "Black",
        secondaryColors: [],
        style: "Classic",
        pattern: "Solid",
        description: "Black leather boots",
      };

      const searchResult = await searchCatalogByVisualFeatures(
        "company-123",
        outOfStockFeatures,
        { tenantDb: createMockTenantDb() },
      );

      expect(searchResult.isCatalogMatch).toBe(true);
      expect(searchResult.bestMatch?.productId).toBe("prod-104");
      expect(searchResult.bestMatch?.inStock).toBe(false); // Out of stock

      const reply = buildDeterministicGroundedReply({
        extraction: {
          isPaymentReceipt: false,
          receiptDetails: null,
          productFeatures: outOfStockFeatures,
          confidence: 0.95,
        },
        bestMatch: searchResult.bestMatch,
        candidateProducts: searchResult.matches,
        language: "banglish",
      });

      expect(reply).toContain("Dukkhito bhaiya");
      expect(reply).toContain("Classic Black Leather Boots");
      expect(reply).toContain("BOT-404");
      expect(reply).toContain("stock out hoye geche");
      expect(reply).toContain("onno kono similar design dekhte chan?");
    });
  });

  // ==========================================================================
  // 6. Low-Resolution & Corrupted Image Handling
  // ==========================================================================
  describe("6. Low-Resolution & Corrupted Image Handling", () => {
    test("handles corrupted image buffer gracefully without crashing", async () => {
      const corruptedBuffer = Buffer.from("CORRUPTED_NON_IMAGE_DATA_12345");

      const result = await visionService.processIncomingImage({
        companyId: "comp-123",
        imageSource: corruptedBuffer,
        customerQuery: "bhai ei dress ta ache?",
        language: "banglish",
      });

      expect(result.success).toBe(false);
      expect(result.isCorrupted).toBe(true);
      expect(result.replyText).toContain(
        "Dukkhito bhaiya, chobi ti thikbhabe open kora jachhe na",
      );
      expect(result.replyText).toContain("chobi ti abar send korben ki?");
    });

    test("returns polite Bengali error message when customer language is Bangla", async () => {
      const emptyBuffer = Buffer.alloc(0);

      const result = await visionService.processIncomingImage({
        companyId: "comp-123",
        imageSource: emptyBuffer,
        customerQuery: "এই ছবিটির প্রাইস কত?",
        language: "bangla",
      });

      expect(result.success).toBe(false);
      expect(result.replyText).toContain(
        "দুঃখিত ভাইয়া, ছবিটি সঠিকভাবে ওপেন করা যাচ্ছে না",
      );
      expect(result.replyText).toContain("অনুগ্রহ করে ছবিটি পুনরায় সেন্ড করবেন কি?");
    });
  });

  // ==========================================================================
  // 7. AiOrchestratorService End-to-End Multimodal Integration
  // ==========================================================================
  describe("7. AiOrchestratorService Multimodal Vision Integration", () => {
    const orchestrator = new AiOrchestratorService();

    test("does NOT suppress image message even if content text is empty", async () => {
      // Content is empty, but media is present (e.g. user sent image without caption)
      const decision = await orchestrator.evaluateSuppression(
        "company-123",
        "contact-456",
        false, // not group
        "", // empty text caption
        true, // hasMedia = true
      );

      // Should not be suppressed by 'empty_content' because hasMedia is true
      // (Fails safe with db_error_fail_safe since no mock DB is attached, which confirms it passed rule #2)
      expect(decision.reason).not.toBe("empty_content");
    });

    test("processes incoming product screenshot end-to-end via AiOrchestratorService", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Mock DB insert target
      let insertedMessage: any = null;

      const mockDb = {
        selectFrom: (table: string) => ({
          select: () => ({
            where: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    executeTakeFirst: async () => undefined,
                  }),
                  executeTakeFirst: async () => {
                    if (table === "whatsapp_connection_sessions") {
                      return { id: "session-123" };
                    }
                    return undefined;
                  },
                }),
              }),
              orderBy: () => ({
                limit: () => ({
                  executeTakeFirst: async () => undefined,
                }),
                executeTakeFirst: async () => {
                  if (table === "whatsapp_connection_sessions") {
                    return { id: "session-123" };
                  }
                  return undefined;
                },
              }),
              executeTakeFirst: async () => {
                if (table === "whatsapp_connections") {
                  return { jid: "8801700000000@s.whatsapp.net" };
                }
                if (table === "whatsapp_connection_sessions") {
                  return { id: "session-123" };
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
          selectAll: () => ({
            execute: async () => mockCatalogProducts,
          }),
        }),
        transaction: () => ({
          execute: async (callback: (trx: unknown) => Promise<void>) => {
            const trx = {
              getExecutor: () => ({
                compileQuery: () => ({ sql: "SELECT 1", parameters: [] }),
                transformQuery: (node: unknown) => node,
                executeQuery: async () => ({ rows: [] }),
              }),
              insertInto: () => ({
                values: (vals: Record<string, unknown>) => ({
                  execute: async () => {
                    if (vals && vals.content) {
                      insertedMessage = vals;
                    }
                  },
                }),
              }),
              selectFrom: () => ({
                where: () => ({
                  executeTakeFirst: async () => undefined,
                }),
              }),
            };
            await callback(trx);
          },
        }),
      };

      // Mock vision service that identifies Vintage Denim Jacket
      const mockVisionService = {
        processIncomingImage: async () => ({
          success: true,
          bestMatch: mockCatalogProducts[0],
          candidateProducts: [mockCatalogProducts[0]],
          isCatalogMatch: true,
          replyText:
            "Ji bhaiya! Eta amader Vintage Denim Jacket (VDJ-09). Price 2800 Tk. M, L, XL size available ache. Apnar kon size ta lagbe?",
        }),
      } as unknown as VisionService;

      orchestrator.setMockDb(mockDb);
      orchestrator.setGeminiClient(geminiClient);
      orchestrator.setVisionService(mockVisionService);

      await orchestrator.dispatchInboundMessage({
        companyId: "test-company",
        connectionId: "conn-123",
        contactId: "contact-456",
        contactJid: "8801711223344@s.whatsapp.net",
        messageId: "msg-1",
        content: "bhai ei jacket ta ache?",
        messageType: "image",
        mediaUrl: `data:image/jpeg;base64,${VALID_JPEG_BUFFER.toString("base64")}`,
        isGroup: false,
      });

      expect(insertedMessage).not.toBeNull();
      expect(insertedMessage?.content).toContain(
        "Vintage Denim Jacket (VDJ-09)",
      );
      expect(insertedMessage?.content).toContain("2800 Tk");
      expect(insertedMessage?.from_me).toBe(true);
    });
  });
});
