/**
 * Multimodal Vision & Product Recognition Pipeline (Milestone 2)
 *
 * Stage 1: Gemini 2.0 Flash Vision Feature & OCR Extraction (products, SKUs, overlay text, payment receipts)
 * Stage 2: 2-Stage Hybrid Visual Catalog Matcher (PostgreSQL catalog_products & Meilisearch)
 * Stage 3: Grounded Turn Helper (Language-mirrored conversational response with active stock & variants)
 */

import { env } from "../../../lib/env.js";
import { createLogger, formatError } from "../../../lib/logger.js";
import {
  downloadMediaFromUrl,
  readMediaObject,
  resolveMediaKeyForCompany,
} from "../../../lib/storage.js";
import { getTenantConnection } from "../../tenant.service.js";
import type { GeminiClient } from "./gemini.client.js";
import {
  buildSystemPrompt,
  detectCustomerLanguage,
  sanitizeAiReply,
  type MerchantPromptContext,
  type SupportedLanguage,
} from "./prompts.js";
import { detectClientHonorific } from "../conversation/honorific-detector.js";

const logger = createLogger("vision-service");

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface ImageInlineData {
  mimeType: string;
  data: string; // Base64 encoded
}

export type ImageIngestionSource =
  | Buffer
  | Uint8Array
  | ImageInlineData
  | { url: string }
  | { mediaUrl: string }
  | string; // URL, S3 URI, or base64 data string

export interface ReceiptExtractionDetails {
  provider: "bkash" | "nagad" | "rocket" | "upay" | "bank" | "unknown";
  transactionId: string | null;
  amount: number | null;
  senderNumber?: string | null;
  receiverNumber?: string | null;
  timestamp?: string | null;
  confidence?: number;
}

export interface ProductVisualFeatures {
  ocrText: string;
  detectedCodes: string[];
  detectedPrices: number[];
  category: string | null;
  primaryColor: string | null;
  secondaryColors: string[];
  style: string | null;
  pattern: string | null;
  description: string;
  isNonProduct?: boolean;
}

export interface VisionExtractionResult {
  isPaymentReceipt: boolean;
  isNonProduct?: boolean;
  nonProductType?: "id_card" | "selfie" | "document" | "other";
  receiptDetails: ReceiptExtractionDetails | null;
  productFeatures: ProductVisualFeatures | null;
  confidence: number;
  rawModelResponse?: string;
}

export interface ProductVariationOption {
  name: string; // e.g. "Size", "Color"
  options: string[]; // e.g. ["M", "L", "XL"]
}

export interface MatchedCatalogProduct {
  productId: string;
  catalogId?: string;
  name: string;
  description: string | null;
  sku: string | null;
  category: string | null;
  price: number;
  currency: string;
  imageUrls: string[];
  inStock: boolean;
  availability: string;
  score: number;
  matchReason: string;
  variationOptions?: ProductVariationOption[];
}

export interface VisionProcessingResult {
  success: boolean;
  isCorrupted?: boolean;
  error?: string;
  extraction?: VisionExtractionResult;
  bestMatch?: MatchedCatalogProduct | null;
  candidateProducts?: MatchedCatalogProduct[];
  isCatalogMatch?: boolean;
  replyText: string;
}

export class ImageIngestionError extends Error {
  public readonly isCorrupted: boolean;

  constructor(message: string, isCorrupted = true) {
    super(message);
    this.name = "ImageIngestionError";
    this.isCorrupted = isCorrupted;
  }
}

// ============================================================================
// Stage 0: Image Ingestion & Validation
// ============================================================================

/**
 * Detect image MIME type from magic bytes in buffer
 */
export function detectMimeTypeFromMagicBytes(
  buffer: Buffer | Uint8Array,
): string | null {
  if (buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  // WEBP: 'RIFF' .... 'WEBP'
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return "image/webp";
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46
  ) {
    return "image/gif";
  }

  return null;
}

/**
 * Validate that an image buffer is genuine, readable, and non-corrupt
 */
export function validateImageBuffer(
  buffer: Buffer | Uint8Array,
  _hintMimeType?: string,
): {
  isValid: boolean;
  mimeType: string;
  errorReason?: string;
} {
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      mimeType: "unknown",
      errorReason: "Image buffer is empty (0 bytes).",
    };
  }

  if (buffer.length < 12) {
    return {
      isValid: false,
      mimeType: "unknown",
      errorReason: `Image buffer is too small to be valid header (${buffer.length} bytes).`,
    };
  }

  // Max 25 MB limit for Gemini inline vision payloads
  if (buffer.length > 25 * 1024 * 1024) {
    return {
      isValid: false,
      mimeType: "unknown",
      errorReason: `Image buffer exceeds 25MB limit (${(buffer.length / (1024 * 1024)).toFixed(2)} MB).`,
    };
  }

  const magicMime = detectMimeTypeFromMagicBytes(buffer);
  if (magicMime) {
    return { isValid: true, mimeType: magicMime };
  }

  // Buffer does not match known image magic bytes
  return {
    isValid: false,
    mimeType: "unknown",
    errorReason: "Unrecognized image format or corrupted byte header.",
  };
}

/**
 * Ingest image from diverse inputs (S3 URI, HTTP URL, Buffer, or Base64) into Gemini inlineData
 */
export async function ingestImageToInlineData(
  source: ImageIngestionSource,
  companyId?: string,
): Promise<ImageInlineData> {
  // Case 1: Already an ImageInlineData object
  if (
    typeof source === "object" &&
    source !== null &&
    "mimeType" in source &&
    "data" in source &&
    typeof (source as ImageInlineData).data === "string"
  ) {
    const inline = source as ImageInlineData;
    if (!inline.data || inline.data.trim().length === 0) {
      throw new ImageIngestionError(
        "Provided inline image base64 data is empty.",
      );
    }
    const buffer = Buffer.from(inline.data, "base64");
    const check = validateImageBuffer(buffer, inline.mimeType);
    if (!check.isValid) {
      throw new ImageIngestionError(
        check.errorReason || "Corrupted inline image data.",
      );
    }
    return {
      mimeType: check.mimeType,
      data: inline.data,
    };
  }

  // Case 2: Raw Buffer or Uint8Array
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    const check = validateImageBuffer(source);
    if (!check.isValid) {
      throw new ImageIngestionError(
        check.errorReason || "Corrupted image buffer.",
      );
    }
    return {
      mimeType: check.mimeType,
      data: Buffer.from(source).toString("base64"),
    };
  }

  // Case 3: URL/MediaUrl object
  let rawUrl: string | null = null;
  if (typeof source === "object" && source !== null) {
    if ("url" in source && typeof source.url === "string") {
      rawUrl = source.url;
    } else if ("mediaUrl" in source && typeof source.mediaUrl === "string") {
      rawUrl = source.mediaUrl;
    }
  } else if (typeof source === "string") {
    rawUrl = source;
  }

  if (!rawUrl || rawUrl.trim().length === 0) {
    throw new ImageIngestionError("Image source string or URL is empty.");
  }

  // Check if string is a Data URI: data:image/png;base64,...
  if (rawUrl.startsWith("data:")) {
    const match = rawUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new ImageIngestionError("Malformed data URI scheme for image.");
    }
    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");
    const check = validateImageBuffer(buffer, mimeType);
    if (!check.isValid) {
      throw new ImageIngestionError(
        check.errorReason || "Corrupted base64 data URI.",
      );
    }
    return {
      mimeType: check.mimeType,
      data: base64Data,
    };
  }

  // Case 4: S3 URI or Storage Key (s3://bucket/media/...)
  if (rawUrl.startsWith("s3://") || rawUrl.startsWith("media/")) {
    try {
      let key = rawUrl;
      if (rawUrl.startsWith("s3://")) {
        const bucket = env.S3_BUCKET;
        if (companyId) {
          key = resolveMediaKeyForCompany(rawUrl, companyId);
        } else {
          const parsed = new URL(rawUrl);
          if (parsed.hostname !== bucket && parsed.hostname.length > 0) {
            key = parsed.pathname.replace(/^\/+/, "");
          } else {
            key = parsed.pathname.replace(/^\/+/, "");
          }
        }
      }
      const buffer = await readMediaObject(key);
      const check = validateImageBuffer(buffer);
      if (!check.isValid) {
        throw new ImageIngestionError(
          check.errorReason || "Corrupted S3 media object.",
        );
      }
      return {
        mimeType: check.mimeType,
        data: buffer.toString("base64"),
      };
    } catch (err) {
      if (err instanceof ImageIngestionError) throw err;
      throw new ImageIngestionError(
        `Failed to read media object from S3 storage: ${formatError(err).message}`,
        false,
      );
    }
  }

  // Case 5: HTTP / HTTPS URL
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    try {
      const downloaded = await downloadMediaFromUrl(rawUrl);
      const check = validateImageBuffer(downloaded.data, downloaded.mimeType);
      if (!check.isValid) {
        throw new ImageIngestionError(
          check.errorReason || "Downloaded media is corrupt.",
        );
      }
      return {
        mimeType: check.mimeType,
        data: downloaded.data.toString("base64"),
      };
    } catch (err) {
      if (err instanceof ImageIngestionError) throw err;
      throw new ImageIngestionError(
        `Failed to download image from external URL: ${formatError(err).message}`,
        false,
      );
    }
  }

  // Fallback: Check if raw string is raw base64
  try {
    const buffer = Buffer.from(rawUrl, "base64");
    const check = validateImageBuffer(buffer);
    if (check.isValid) {
      return {
        mimeType: check.mimeType,
        data: rawUrl,
      };
    }
  } catch {
    // ignore
  }

  throw new ImageIngestionError(
    `Unsupported image source format: ${rawUrl.substring(0, 50)}...`,
  );
}

// ============================================================================
// Stage 1: Gemini 2.0 Flash Vision Extraction
// ============================================================================

export const VISION_EXTRACTION_SYSTEM_PROMPT = `You are a high-precision computer vision intelligence engine for an e-commerce platform in Bangladesh.
Your task is to analyze customer-submitted images and extract structured data.

Input images are either:
1. PAYMENT RECEIPT / SMS: Screenshot of bKash, Nagad, Rocket, Upay app payment or SMS confirmation.
   - Provider: bkash, nagad, rocket, upay, bank, or unknown.
   - Transaction ID: e.g. 10-char alphanumeric TrxID (bKash) or 8-char (Nagad).
   - Amount: numeric value in BDT.
   - Sender / Receiver numbers if visible.
2. PRODUCT IMAGE / SCREENSHOT:
   - OCR text: Extract ALL text, product codes, SKUs, model codes, prices, discounts, tags, and banner captions.
   - Detected codes: list of SKU/model numbers (e.g. "VDJ-09", "KRT-202", "P-88").
   - Detected prices: numerical amounts visible in the image.
   - Category: e.g. "Outerwear / Denim Jacket", "Women / Kurti", "Men / Panjabi", "Footwear / Sneakers".
   - Primary color and secondary colors.
   - Style: e.g. "Casual", "Traditional", "Festive", "Western".
   - Pattern: e.g. "Embroidered", "Solid", "Printed", "Striped".
   - Description: concise 1-2 sentence visual description of the product.
3. NON-PRODUCT / OTHER:
   - Identify non-merchandise images: employee ID cards, badges, student IDs, selfies, portraits, driving licenses, passports, documents, certificates, memes, nature, or unrelated personal photos.
   - For these, set "isNonProduct": true, and describe what the object/document is clearly in "description".

Output MUST be a single valid JSON object adhering to this schema:
{
  "isPaymentReceipt": boolean,
  "isNonProduct": boolean,
  "receiptDetails": {
    "provider": "bkash" | "nagad" | "rocket" | "upay" | "bank" | "unknown",
    "transactionId": string | null,
    "amount": number | null,
    "senderNumber": string | null,
    "receiverNumber": string | null,
    "timestamp": string | null
  } | null,
  "productFeatures": {
    "ocrText": string,
    "detectedCodes": string[],
    "detectedPrices": number[],
    "category": string | null,
    "primaryColor": string | null,
    "secondaryColors": string[],
    "style": string | null,
    "pattern": string | null,
    "description": string
  } | null,
  "confidence": number
}`;

/**
 * Resilient regex-based receipt extractor to verify and backfill model outputs
 */
export function extractReceiptViaRegex(
  text: string,
): ReceiptExtractionDetails | null {
  const lower = text.toLowerCase();
  const isReceipt =
    lower.includes("trxid") ||
    lower.includes("txnid") ||
    lower.includes("trans id") ||
    lower.includes("bkash") ||
    lower.includes("nagad") ||
    lower.includes("rocket") ||
    lower.includes("you have received") ||
    lower.includes("cash in") ||
    lower.includes("payment received") ||
    lower.includes("successful");

  if (!isReceipt) return null;

  let provider: ReceiptExtractionDetails["provider"] = "unknown";
  if (
    lower.includes("bkash") ||
    lower.includes("balance tk") ||
    lower.includes("fee tk")
  ) {
    provider = "bkash";
  } else if (lower.includes("nagad")) {
    provider = "nagad";
  } else if (lower.includes("rocket")) {
    provider = "rocket";
  } else if (lower.includes("upay")) {
    provider = "upay";
  }

  // Transaction ID Regex
  let transactionId: string | null = null;
  const trxMatch = text.match(
    /(?:trxid|txnid|trx\s*id|transaction\s*id|txn\s*id|id)\s*[:#-]?\s*([a-z0-9]{6,16})/i,
  );
  if (trxMatch) {
    transactionId = trxMatch[1].toUpperCase();
  }

  // Amount Regex: Tk 1,500.00 or 1500 Tk or ৳1500
  let amount: number | null = null;
  const amtMatch =
    text.match(
      /(?:tk|bdt|৳|amount)\.?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i,
    ) ||
    text.match(
      /([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)\s*(?:tk|bdt|৳)/i,
    );
  if (amtMatch) {
    const cleanStr = amtMatch[1].replace(/,/g, "");
    const parsed = Number.parseFloat(cleanStr);
    if (!Number.isNaN(parsed)) {
      amount = parsed;
    }
  }

  // Phone number regex (BD 11-digit)
  let senderNumber: string | null = null;
  const phoneMatch =
    text.match(/(?:from|sender|number)\s*[:#-]?\s*(01[3-9]\d{8})/i) ||
    text.match(/\b(01[3-9]\d{8})\b/);
  if (phoneMatch) {
    senderNumber = phoneMatch[1];
  }

  return {
    provider,
    transactionId,
    amount,
    senderNumber,
    confidence: transactionId && amount ? 0.95 : 0.7,
  };
}

/**
 * Heuristic fallback for OCR text when model returns free-form text
 */
export function extractProductFeaturesFromText(
  text: string,
): ProductVisualFeatures {
  const detectedCodes: string[] = [];
  const codeMatches = text.matchAll(
    /\b([A-Z]{2,5}-\d{2,5}|SKU-?[A-Z0-9]+|CODE:?\s*([A-Z0-9-]+))\b/gi,
  );
  for (const m of codeMatches) {
    const code = (m[2] || m[1])
      .replace(/^CODE:?\s*/i, "")
      .trim()
      .toUpperCase();
    if (!detectedCodes.includes(code)) {
      detectedCodes.push(code);
    }
  }

  const detectedPrices: number[] = [];
  const priceMatches = text.matchAll(
    /(?:tk|bdt|৳|price|dam)\s*[:#-]?\s*([0-9]{2,6})/gi,
  );
  for (const m of priceMatches) {
    const val = Number.parseInt(m[1], 10);
    if (!Number.isNaN(val) && !detectedPrices.includes(val)) {
      detectedPrices.push(val);
    }
  }

  // Common colors
  const colorList = [
    "black",
    "blue",
    "white",
    "red",
    "green",
    "maroon",
    "navy",
    "pink",
    "yellow",
    "grey",
    "gray",
    "olive",
  ];
  const lower = text.toLowerCase();
  const matchedColors = colorList.filter((c) => lower.includes(c));

  return {
    ocrText: text,
    detectedCodes,
    detectedPrices,
    category: null,
    primaryColor: matchedColors[0] || null,
    secondaryColors: matchedColors.slice(1),
    style: null,
    pattern: null,
    description: text.substring(0, 150),
  };
}

/**
 * Parse and normalize Gemini Vision extraction output
 */
export function parseVisionModelResponse(
  rawText: string,
): VisionExtractionResult {
  let cleaned = rawText.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  }

  try {
    const parsed = JSON.parse(cleaned);

    const isPaymentReceipt = Boolean(parsed.isPaymentReceipt);
    let receiptDetails: ReceiptExtractionDetails | null = null;
    let productFeatures: ProductVisualFeatures | null = null;

    if (isPaymentReceipt && parsed.receiptDetails) {
      receiptDetails = {
        provider: parsed.receiptDetails.provider || "unknown",
        transactionId: parsed.receiptDetails.transactionId
          ? String(parsed.receiptDetails.transactionId).trim().toUpperCase()
          : null,
        amount: parsed.receiptDetails.amount
          ? Number(parsed.receiptDetails.amount)
          : null,
        senderNumber: parsed.receiptDetails.senderNumber || null,
        receiverNumber: parsed.receiptDetails.receiverNumber || null,
        timestamp: parsed.receiptDetails.timestamp || null,
        confidence:
          parsed.receiptDetails.confidence || parsed.confidence || 0.9,
      };
    } else {
      // Check if regex detects receipt in rawText anyway
      const regexReceipt = extractReceiptViaRegex(rawText);
      if (regexReceipt?.transactionId) {
        return {
          isPaymentReceipt: true,
          receiptDetails: regexReceipt,
          productFeatures: null,
          confidence: 0.9,
          rawModelResponse: rawText,
        };
      }
    }

    const descLower = String(parsed.productFeatures?.description || "").toLowerCase();
    const catLower = String(parsed.productFeatures?.category || "").toLowerCase();
    const ocrLower = String(parsed.productFeatures?.ocrText || "").toLowerCase();

    const isNonProduct =
      Boolean(parsed.isNonProduct) ||
      catLower.includes("identity card") ||
      catLower.includes("id card") ||
      catLower.includes("document") ||
      catLower.includes("badge") ||
      catLower.includes("certificate") ||
      catLower.includes("selfie") ||
      catLower.includes("portrait") ||
      descLower.includes("identity card") ||
      descLower.includes("id card") ||
      descLower.includes("employee card") ||
      descLower.includes("employee identity") ||
      descLower.includes("visiting card") ||
      descLower.includes("business card") ||
      descLower.includes("selfie") ||
      descLower.includes("passport") ||
      descLower.includes("national id") ||
      descLower.includes("driving license") ||
      ocrLower.includes("employee id") ||
      ocrLower.includes("co-founder") ||
      ocrLower.includes("chief executive") ||
      ocrLower.includes("aurovixsoft");

    if (parsed.productFeatures) {
      productFeatures = {
        ocrText: String(parsed.productFeatures.ocrText || ""),
        detectedCodes: Array.isArray(parsed.productFeatures.detectedCodes)
          ? parsed.productFeatures.detectedCodes.map((c: unknown) =>
              String(c).trim().toUpperCase(),
            )
          : [],
        detectedPrices: Array.isArray(parsed.productFeatures.detectedPrices)
          ? parsed.productFeatures.detectedPrices
              .map((p: unknown) => Number(p))
              .filter((n: number) => !Number.isNaN(n))
          : [],
        category: parsed.productFeatures.category
          ? String(parsed.productFeatures.category).trim()
          : null,
        primaryColor: parsed.productFeatures.primaryColor
          ? String(parsed.productFeatures.primaryColor).trim()
          : null,
        secondaryColors: Array.isArray(parsed.productFeatures.secondaryColors)
          ? parsed.productFeatures.secondaryColors.map((c: unknown) =>
              String(c).trim(),
            )
          : [],
        style: parsed.productFeatures.style
          ? String(parsed.productFeatures.style).trim()
          : null,
        pattern: parsed.productFeatures.pattern
          ? String(parsed.productFeatures.pattern).trim()
          : null,
        description: String(parsed.productFeatures.description || ""),
        isNonProduct,
      };
    }

    return {
      isPaymentReceipt,
      isNonProduct,
      nonProductType: isNonProduct ? "id_card" : undefined,
      receiptDetails,
      productFeatures,
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.85,
      rawModelResponse: rawText,
    };
  } catch {
    // If model didn't return strict JSON, attempt dual-layer extraction
    const receipt = extractReceiptViaRegex(rawText);
    if (receipt?.transactionId) {
      return {
        isPaymentReceipt: true,
        receiptDetails: receipt,
        productFeatures: null,
        confidence: 0.85,
        rawModelResponse: rawText,
      };
    }

    const features = extractProductFeaturesFromText(rawText);
    return {
      isPaymentReceipt: false,
      receiptDetails: null,
      productFeatures: features,
      confidence: 0.75,
      rawModelResponse: rawText,
    };
  }
}

// ============================================================================
// Stage 2: 2-Stage Hybrid Visual Catalog Matcher
// ============================================================================

/**
 * Helper to extract variant options (e.g. Size, Color) from product description or text
 */
export function extractVariationOptions(
  description: string | null,
  name?: string,
): ProductVariationOption[] {
  const options: ProductVariationOption[] = [];
  const combined = `${name || ""} ${description || ""}`;

  // Sizes: M, L, XL, XXL, 38, 40, 42
  const sizeMatch = combined.match(
    /(?:sizes?|available sizes?)\s*[:=]\s*([A-Za-z0-9,\s-]+)/i,
  );
  if (sizeMatch) {
    const rawSizes = sizeMatch[1]
      .split(/[,/\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0 && s.length <= 4);
    if (rawSizes.length > 0) {
      options.push({
        name: "Size",
        options: Array.from(new Set(rawSizes)),
      });
    }
    // Check for standard clothing sizes mentioned in text
    // Clean possessive apostrophes like men's to prevent false detection of size S
    const cleanedText = combined.replace(/['’]s\b/gi, "");
    const standardSizes = [
      "36",
      "38",
      "40",
      "42",
      "44",
      "46",
      "48",
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "3XL",
    ];
    const found = standardSizes.filter((sz) =>
      new RegExp(`\\b${sz}\\b`, "i").test(cleanedText),
    );
    if (found.length > 0) {
      options.push({
        name: "Size",
        options: found,
      });
    }
  }

  // Colors
  const colorMatch = combined.match(
    /(?:colors?|available colors?)\s*[:=]\s*([A-Za-z,\s-]+)/i,
  );
  if (colorMatch) {
    const rawColors = colorMatch[1]
      .split(/[,/]+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 2);
    if (rawColors.length > 0) {
      options.push({
        name: "Color",
        options: Array.from(new Set(rawColors)),
      });
    }
  }

  return options;
}

export interface CatalogSearchOptions {
  // biome-ignore lint/suspicious/noExplicitAny: tenant database or test mock
  tenantDb?: any;
  limit?: number;
  scoreThreshold?: number;
}

/**
 * Searches merchant catalog for matching products using extracted visual features and OCR tokens
 */
export async function searchCatalogByVisualFeatures(
  companyId: string,
  features: ProductVisualFeatures | null,
  options: CatalogSearchOptions = {},
): Promise<{
  matches: MatchedCatalogProduct[];
  bestMatch: MatchedCatalogProduct | null;
  isCatalogMatch: boolean;
}> {
  if (!features || features.isNonProduct) {
    return { matches: [], bestMatch: null, isCatalogMatch: false };
  }

  const tenantDb = options.tenantDb || getTenantConnection(companyId);
  const limit = options.limit || 5;
  const scoreThreshold = options.scoreThreshold ?? 25;

  let rawProducts: Array<{
    id?: string;
    product_id: string;
    catalog_id?: string;
    name: string;
    description: string | null;
    price: number | null;
    currency?: string;
    image_urls?: string[] | null;
    sku: string | null;
    category: string | null;
    availability: string;
    visibility?: string;
  }> = [];

  try {
    rawProducts = await tenantDb
      .selectFrom("catalog_products")
      .selectAll()
      .execute();
  } catch (err) {
    logger.warn(
      { err: formatError(err), companyId },
      "Could not query catalog_products from database",
    );
    return { matches: [], bestMatch: null, isCatalogMatch: false };
  }

  if (!rawProducts || rawProducts.length === 0) {
    return { matches: [], bestMatch: null, isCatalogMatch: false };
  }

  // Prepare query tokens
  const detectedCodes = features.detectedCodes.map((c) => c.toLowerCase());
  const detectedPrices = features.detectedPrices;
  const queryText =
    `${features.ocrText} ${features.description || ""}`.toLowerCase();
  const ocrLower = features.ocrText.toLowerCase();

  // Clean OCR keywords (length >= 3, skip noisy stopwords)
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "bdt",
    "tk",
    "taka",
    "price",
    "dam",
    "code",
    "sku",
    "new",
    "sale",
    "off",
    "bhai",
    "bhaiya",
    "delivery",
    "charge",
    "available",
  ]);

  const ocrTokens = queryText
    .split(/[^a-z0-9_-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stopwords.has(t));

  const categoryLower = features.category?.toLowerCase() || "";
  const primaryColorLower = features.primaryColor?.toLowerCase() || "";

  const scoredCandidates: MatchedCatalogProduct[] = [];

  for (const product of rawProducts) {
    let score = 0;
    const reasons: string[] = [];

    const pSku = (product.sku || "").toLowerCase();
    const pName = (product.name || "").toLowerCase();
    const pDesc = (product.description || "").toLowerCase();
    const pCategory = (product.category || "").toLowerCase();
    const pPrice = product.price || 0;

    // 1. Exact SKU / Product Code Match (Highest weight: +60)
    for (const code of detectedCodes) {
      if (pSku && pSku === code) {
        score += 60;
        reasons.push(`Exact SKU match (${product.sku})`);
        break;
      }
      if (pSku && (pSku.includes(code) || code.includes(pSku))) {
        score += 35;
        reasons.push(`SKU partial match (${product.sku})`);
        break;
      }
      if (pName.includes(code)) {
        score += 40;
        reasons.push(`Product code in title (${code})`);
        break;
      }
    }

    // 2. Product Name in OCR text (+30) or Token overlap (+10 per word)
    if (
      (queryText.includes(pName) || ocrLower.includes(pName)) &&
      pName.length > 4
    ) {
      score += 30;
      reasons.push("Full product title matched visual description / OCR text");
    } else {
      const nameTokens = pName
        .split(/[^a-z0-9_-]+/)
        .filter((t) => t.length >= 3 && !stopwords.has(t));
      let matchedTokenCount = 0;
      for (const token of nameTokens) {
        if (ocrTokens.includes(token) || queryText.includes(token)) {
          matchedTokenCount++;
        }
      }
      if (matchedTokenCount > 0) {
        const tokenScore = matchedTokenCount * 10;
        score += tokenScore;
        reasons.push(`${matchedTokenCount} title keywords matched`);
      }
    }

    // 3. Category Match (+20)
    if (categoryLower && pCategory) {
      const normCat1 = categoryLower.replace(/[\/,]/g, " ").trim();
      const normCat2 = pCategory.replace(/[\/,]/g, " ").trim();
      const catTokens1 = normCat1.split(/\s+/).filter((t) => t.length > 2);
      const catTokens2 = normCat2.split(/\s+/).filter((t) => t.length > 2);
      const hasCatOverlap = catTokens1.some((t) => catTokens2.includes(t));
      if (
        pCategory.includes(categoryLower) ||
        categoryLower.includes(pCategory) ||
        hasCatOverlap
      ) {
        score += 20;
        reasons.push(`Category match (${product.category})`);
      }
    }

    // 4. Color Match (+15)
    if (primaryColorLower) {
      if (
        pName.includes(primaryColorLower) ||
        pDesc.includes(primaryColorLower)
      ) {
        score += 15;
        reasons.push(`Color match (${features.primaryColor})`);
      }
    }

    // 5. Price Match (+20 if exact / within 5%)
    if (detectedPrices.length > 0 && pPrice > 0) {
      for (const dPrice of detectedPrices) {
        const diffRatio = Math.abs(dPrice - pPrice) / pPrice;
        if (diffRatio < 0.05) {
          score += 20;
          reasons.push(`Price match (${pPrice} BDT)`);
          break;
        }
      }
    }

    // Availability & Stock status
    const availLower = (product.availability || "").toLowerCase();
    const inStock =
      !availLower.includes("out") &&
      !availLower.includes("stockout") &&
      (availLower.includes("in") ||
        availLower === "available" ||
        availLower === "");

    const variations = extractVariationOptions(
      product.description,
      product.name,
    );

    if (score > 0) {
      scoredCandidates.push({
        productId: product.product_id,
        catalogId: product.catalog_id,
        name: product.name,
        description: product.description,
        sku: product.sku,
        category: product.category,
        price: pPrice,
        currency: product.currency || "BDT",
        imageUrls: Array.isArray(product.image_urls) ? product.image_urls : [],
        inStock,
        availability: product.availability || "in stock",
        score,
        matchReason: reasons.join("; ") || "Visual feature similarity",
        variationOptions: variations,
      });
    }
  }

  // Sort descending by score
  scoredCandidates.sort((a, b) => b.score - a.score);

  const topMatches = scoredCandidates.slice(0, limit);
  const best =
    topMatches.length > 0 && topMatches[0].score >= scoreThreshold
      ? topMatches[0]
      : null;

  return {
    matches: topMatches,
    bestMatch: best,
    isCatalogMatch: best !== null,
  };
}

// ============================================================================
// Stage 3: Grounded Turn Helper
// ============================================================================

export interface GroundedTurnContext {
  extraction: VisionExtractionResult;
  bestMatch: MatchedCatalogProduct | null;
  candidateProducts: MatchedCatalogProduct[];
  customerQuery?: string;
  language?: SupportedLanguage;
  personaContext?: MerchantPromptContext;
}

/**
 * Format system prompt for grounded conversational response
 */
export function formatGroundedTurnPrompt(context: GroundedTurnContext): string {
  const {
    extraction,
    bestMatch,
    customerQuery,
    language = "banglish",
    personaContext,
  } = context;

  const storeName = personaContext?.storeName || "our store";

  let prompt = personaContext
    ? `${buildSystemPrompt(personaContext)}\n\n`
    : `You are the AI Sales Executive for ${storeName} in Bangladesh.\n\n`;

  prompt += "### 📷 INCOMING WHATSAPP IMAGE CONTEXT:\n";
  if (customerQuery) {
    prompt += `Customer accompanying message: "${customerQuery}"\n`;
  }
  prompt += `Detected Customer Language: ${language}\n\n`;

  prompt += "### 💬 100% HUMAN WHATSAPP CHAT RULES:\n";
  prompt += "- Keep response strictly 1 to 2 short sentences. Never send long essays or robotic walls of text.\n";
  prompt += "- STRICT SCRIPT PURITY: If customer language is Banglish, write 100% in Latin English letters only. NEVER write Hindi/Devanagari characters (ABSOLUTELY NO आकर्षक). NEVER put Bengali script words inside Banglish.\n";
  prompt += "- If customer language is Bengali (বাংলা), write 100% in pure Bengali script (বাংলা অক্ষর).\n";
  prompt += "- If customer language is English, write 100% in English.\n\n";

  if (extraction.isPaymentReceipt && extraction.receiptDetails) {
    const r = extraction.receiptDetails;
    prompt += "### IMAGE TYPE: PAYMENT RECEIPT\n";
    prompt += `- Provider: ${r.provider.toUpperCase()}\n`;
    prompt += `- Transaction ID: ${r.transactionId || "Pending Verification"}\n`;
    prompt += `- Amount: ${r.amount ? `${r.amount} BDT` : "Not specified"}\n\n`;
    prompt +=
      "INSTRUCTION: Acknowledge the payment receipt politely in 1-2 short sentences. Mention provider, TrxID, and amount clearly. Reassure the customer that payment is being verified.\n";
    return prompt;
  }

  if (extraction.isNonProduct) {
    prompt += "### IMAGE TYPE: NON-PRODUCT IMAGE (ID Card, Selfie, Document, Badge, Screenshot, or Personal Photo)\n";
    if (extraction.productFeatures?.description) {
      prompt += `- Visual Description: ${extraction.productFeatures.description}\n`;
    }
    if (extraction.productFeatures?.ocrText) {
      prompt += `- Text Extracted from Image: "${extraction.productFeatures.ocrText}"\n`;
    }
    prompt += "\nINSTRUCTION (CRITICAL - 100% HUMAN WHATSAPP CHAT):\n";
    prompt += "1. The user sent a non-merchandise image (e.g. employee ID card, selfie, personal photo, or document). This is NOT a product and we do NOT have an e-commerce catalog.\n";
    prompt += "2. If a person's name is detected in the image or profile (such as an ID card with 'Mehan Ahmed'), recognize their name, dynamically infer gender, and address them warmly (e.g. 'Ji Mehan bhaiya').\n";
    prompt += "3. NEVER say 'this product is not in our catalog', 'not in our stock', or 'not in our collection'.\n";
    prompt += "4. DO NOT ask if they want to buy products, do not ask for product codes, and do not mention catalog items.\n";
    prompt += "5. Acknowledge what was sent naturally, warmly, and politely in 1-2 short sentences (e.g. 'Ji bhaiya, apnar ID card-ti peyechi. Eta niye apnake kibhabe sahajjo korte pari bolun?').\n";
    prompt += "6. NEVER output slashes like 'bhaiya/apu' or 'sir/ma'am'. Maximum 1-2 short sentences. No marketing essays.\n";
    return prompt;
  }

  if (bestMatch) {
    prompt += "### IMAGE TYPE: MATCHED CATALOG PRODUCT\n";
    prompt += `- Product Name: ${bestMatch.name}\n`;
    prompt += `- SKU / Code: ${bestMatch.sku || bestMatch.productId}\n`;
    prompt += `- Price: ${bestMatch.price} ${bestMatch.currency}\n`;
    prompt += `- Stock Availability: ${bestMatch.inStock ? "IN STOCK" : "OUT OF STOCK"}\n`;

    if (bestMatch.variationOptions && bestMatch.variationOptions.length > 0) {
      prompt += "- Available Variations:\n";
      for (const v of bestMatch.variationOptions) {
        prompt += `  * ${v.name}: ${v.options.join(", ")}\n`;
      }
    }

    prompt += "\nINSTRUCTION:\n";
    if (bestMatch.inStock) {
      prompt +=
        "1. Confirm product identity warmly in 1-2 short sentences ('Ji bhaiya! Eta amader [Product Name]').\n";
      prompt += "2. State price clearly and ask which size or variant they need.\n";
    } else {
      prompt +=
        "1. Politely inform in 1 short sentence that this item is currently out of stock ('Dukkhito bhaiya...').\n";
      prompt +=
        "2. Suggest checking similar items or ask if they want to be notified when it rests.\n";
    }
    return prompt;
  }

  // General / Unmatched image
  prompt += "### IMAGE TYPE: GENERAL / RECEIVED IMAGE\n";
  if (extraction.productFeatures?.description) {
    prompt += `- Visual Description: ${extraction.productFeatures.description}\n`;
  }
  if (extraction.productFeatures?.ocrText) {
    prompt += `- Text Extracted from Image: "${extraction.productFeatures.ocrText}"\n`;
  }
  prompt += "\nINSTRUCTION (100% HUMAN WHATSAPP CHAT):\n";
  prompt +=
    "1. Acknowledge what the user sent naturally in 1-2 short sentences in their language.\n";
  prompt +=
    "2. Ask politely how you can assist them regarding this image. NEVER say 'this product is not in our catalog' or 'not in our stock' unless they specifically asked to buy it.\n";
  prompt +=
    "3. NEVER output slashes like 'bhaiya/apu' or 'sir/ma'am'.\n";

  return prompt;
}

/**
 * Deterministic grounded turn generator providing guaranteed language-mirrored replies
 */
export function buildDeterministicGroundedReply(
  context: GroundedTurnContext,
): string {
  const {
    extraction,
    bestMatch,
    customerQuery,
    language = "banglish",
  } = context;

  // 1. Payment receipt handling
  if (extraction.isPaymentReceipt && extraction.receiptDetails) {
    const { provider, transactionId, amount } = extraction.receiptDetails;
    const provName =
      provider !== "unknown" ? provider.toUpperCase() : "Payment";
    const trxText = transactionId ? ` (TrxID: ${transactionId})` : "";

    if (!transactionId || transactionId.length < 8) {
      if (language === "bangla") {
        return `ধন্যবাদ ভাইয়া! আপনার ${provName} পেমেন্ট স্ক্রিনশটে TrxID সম্পূর্ণ দেখা যাচ্ছে না। অনুগ্রহ করে ৮-১০ ডিজিটের সম্পূর্ণ TrxID টি লিখে পাঠান বা সম্পূর্ণ রিসিটটি পাঠান।`;
      }
      if (language === "english") {
        return `Thank you! The TrxID is not fully visible on your ${provName} receipt. Please reply with the complete 8-10 digit TrxID.`;
      }
      return `Dhonnobad bhaiya! Apnar ${provName} receipt e TrxID shompurno dekha jachhe na. Doya kore 8-10 digit er shompurno TrxID ti likhe pathaben please.`;
    }

    if (language === "bangla") {
      const bngAmt = amount ? ` ${amount} টাকা` : "";
      return `ধন্যবাদ ভাইয়া! আপনার ${provName} পেমেন্ট রিসিট পেয়েছি${bngAmt ? `, পরিমাণ:${bngAmt}` : ""}${trxText}। আমরা পেমেন্ট ভেরিফাই করে আপনার অর্ডার কনফার্ম করে দিচ্ছি।`;
    }
    if (language === "english") {
      const engAmt = amount ? ` ${amount} BDT` : "";
      return `Thank you! We received your ${provName} payment receipt${engAmt ? ` for${engAmt}` : ""}${trxText}. We are verifying the transaction and your order will be confirmed!`;
    }
    const amtText = amount ? ` ${amount} Tk` : "";
    return `Dhonnobad bhaiya! Apnar ${provName} payment receipt peyechi${amtText ? ` (${amtText.trim()})` : ""}${trxText}. Amra payment ta verify kore apnar order confirm kore dichhi!`;
  }

  const honorific =
    context.personaContext?.customerHonorificProfile ||
    detectClientHonorific(context.personaContext?.customerName);

  // 1.4 Non-product image fallback (ID Card, Selfie, Document, etc.)
  if (extraction.isNonProduct) {
    if (language === "bangla") {
      return `জি ${honorific.salutationBangla}, আপনার ছবিটি পেয়েছি। আপনাকে কীভাবে সাহায্য করতে পারি বলুন?`;
    }
    if (language === "english") {
      return `Hello ${honorific.salutationEnglish}! I received your image. How can I assist you regarding this?`;
    }
    return `Ji ${honorific.salutationBanglish}, apnar chobi-ti peyechi. Apnake kibhabe sahajjo korte pari bolun?`;
  }

  // 1.5. Low-Resolution / Blurry Image Disambiguation (<0.50 confidence)
  if (extraction?.confidence !== undefined && extraction.confidence < 0.5) {
    if (language === "bangla") {
      return "দুঃখিত ভাইয়া, ছবিটি পরিষ্কারভাবে বোঝা যাচ্ছে না। দয়া করে একটু স্পষ্ট ছবি পাঠিয়ে সাহায্য করবেন কি?";
    }
    if (language === "english") {
      return "Sorry, the image is blurry or unclear. Could you please send a clearer photo?";
    }
    return "Dukkhito bhaiya, chobi-ti porishkarbhabe bojha jachhe na. Doya kore ektu sposhto chobi pathaben ki?";
  }

  // 1.8 Multi-product collage / Multiple items detected
  if (
    extraction.productFeatures?.style?.toLowerCase() === "collage" ||
    (extraction.productFeatures?.secondaryColors &&
      extraction.productFeatures.secondaryColors.length >= 3)
  ) {
    if (language === "bangla") {
      return "জি ভাইয়া! এই ডিজাইনে আমাদের বিভিন্ন কালার রয়েছে। আপনার কোন কালারটি লাগবে?";
    }
    if (language === "english") {
      return "Hello! We have multiple colors available for this design. Which color would you like?";
    }
    return "Ji bhaiya! Ei design e multiple colors royeche. Apnar kon color ta lagbe?";
  }

  // 1.9 Competitor watermark / Out-of-catalog screenshot
  const isCompetitorItem =
    extraction.productFeatures?.ocrText?.toLowerCase().includes("aarong") ||
    extraction.productFeatures?.description?.toLowerCase().includes("aarong") ||
    extraction.productFeatures?.detectedCodes?.some((c) =>
      c.toLowerCase().includes("aarong"),
    );

  if (isCompetitorItem) {
    if (language === "bangla") {
      return "দুঃখিত ভাইয়া, এই নির্দিষ্ট মডেলটি আমাদের কালেকশনে নেই। আপনি আমাদের শপ থেকে অন্য কোনো প্রোডাক্ট খুঁজছেন কি?";
    }
    if (language === "english") {
      return "Sorry, we do not carry this specific model. Are you looking for any other product from our shop?";
    }
    return "Dukkhito bhaiya, ei model ti amader collection e nei. Apni ki amader onno kono product khujchen?";
  }

  // 2. Matched Product & In Stock
  if (bestMatch && bestMatch.inStock) {
    const codeStr = bestMatch.sku ? ` (${bestMatch.sku})` : "";
    const priceStr = `${bestMatch.price} Tk`;

    let varStr = "";
    const sizeVar = bestMatch.variationOptions?.find(
      (v) => v.name.toLowerCase() === "size",
    );
    if (sizeVar && sizeVar.options.length > 0) {
      varStr = ` ${sizeVar.options.join(", ")} size available ache.`;
    }

    if (language === "bangla") {
      return `জি ভাইয়া! এটি আমাদের ${bestMatch.name}${codeStr}। প্রাইস ${bestMatch.price} টাকা।${varStr ? ` বর্তমানে${varStr}` : " ইন স্টক রয়েছে।"} আপনার কোন সাইজটি লাগবে?`;
    }
    if (language === "english") {
      return `Yes! This is our ${bestMatch.name}${codeStr}. Price is ${bestMatch.price} BDT.${varStr ? ` Available sizes:${varStr}` : " It is in stock."} Which size would you like to order?`;
    }
    return `Ji bhaiya! Eta amader ${bestMatch.name}${codeStr}. Price ${priceStr}.${varStr} Apnar kon size ta lagbe?`;
  }

  // 3. Matched Product BUT Out of Stock
  if (bestMatch && !bestMatch.inStock) {
    const codeStr = bestMatch.sku ? ` (${bestMatch.sku})` : "";
    if (language === "bangla") {
      return `দুঃখিত ভাইয়া, ${bestMatch.name}${codeStr} পণ্যটি বর্তমানে স্টক আউট হয়ে গিয়েছে। আপনি কি আমাদের অনুরূপ অন্য কোনো ডিজাইন দেখতে চান?`;
    }
    if (language === "english") {
      return `Sorry, ${bestMatch.name}${codeStr} is currently out of stock. Would you like to check out similar styles from our collection?`;
    }
    return `Dukkhito bhaiya, ${bestMatch.name}${codeStr} ti ekhon stock out hoye geche. Apni ki amader onno kono similar design dekhte chan?`;
  }

  // 4. Non-Catalog Item / Fallback Polite Clarification
  if (
    extraction.productFeatures?.detectedCodes &&
    extraction.productFeatures.detectedCodes.length > 0
  ) {
    if (language === "bangla") {
      return "ভাইয়া, এই পণ্যটি আমাদের ক্যাটালগে পাওয়া যায়নি। আপনি কি প্রোডাক্টের নাম বা কোড বলতে পারবেন? বা আমাদের রানিং কালেকশন থেকে দেখতে চান?";
    }
    if (language === "english") {
      return "Sorry, this product was not found in our catalog. Could you share the product name or code? Or would you like to see items from our running collection?";
    }
    return "Dukkhito bhaiya, ei product ti amader catalog e pawa jayni. Apni ki product-er nam ba code ta bolte parben? Ba amader running collection theke dekhte chan?";
  }

  // General image acknowledgment without catalog assumptions
  if (language === "bangla") {
    return `জি ${honorific.salutationBangla}, আপনার ছবিটি পেয়েছি। এটি নিয়ে কীভাবে সাহায্য করতে পারি বলুন?`;
  }
  if (language === "english") {
    return `Hello ${honorific.salutationEnglish}! I received your image. How can I assist you with this?`;
  }
  return `Ji ${honorific.salutationBanglish}, apnar chobi-ti peyechi. Eta niye apnake kibhabe sahajjo korte pari bolun?`;
}

// ============================================================================
// Vision Service Main Facade
// ============================================================================

export interface ProcessImageOptions {
  companyId: string;
  imageSource: ImageIngestionSource;
  customerQuery?: string;
  language?: SupportedLanguage;
  // biome-ignore lint/suspicious/noExplicitAny: mock or tenant database
  tenantDb?: any;
  geminiClient?: GeminiClient | null;
  personaContext?: MerchantPromptContext;
}

export class VisionService {
  /**
   * Stage 1: Analyze image via Gemini Vision (or mock harness)
   */
  async extractVisionFeatures(
    image: ImageInlineData,
    geminiClient?: GeminiClient | null,
    customerQuery?: string,
  ): Promise<VisionExtractionResult> {
    if (!geminiClient) {
      // Offline fallback: Attempt regex extraction on customerQuery
      const receipt = extractReceiptViaRegex(customerQuery || "");
      if (receipt) {
        return {
          isPaymentReceipt: true,
          receiptDetails: receipt,
          productFeatures: null,
          confidence: 0.8,
        };
      }
      const features = extractProductFeaturesFromText(customerQuery || "");
      return {
        isPaymentReceipt: false,
        receiptDetails: null,
        productFeatures: features,
        confidence: 0.7,
      };
    }

    try {
      const userPrompt = customerQuery
        ? `Customer query: "${customerQuery}". Extract product OCR, details, or payment receipt from this image.`
        : "Extract product OCR, details, or payment receipt from this image.";

      const response = await geminiClient.generateChatResponse({
        messages: [
          {
            role: "user",
            content: userPrompt,
            media: {
              mimeType: image.mimeType,
              base64Data: image.data,
            },
          },
        ],
        systemInstruction: VISION_EXTRACTION_SYSTEM_PROMPT,
        temperature: 0.1,
      });

      return parseVisionModelResponse(response.text);
    } catch (err) {
      logger.warn(
        { err: formatError(err) },
        "Gemini vision call failed; falling back to heuristic parsing",
      );
      const receipt = extractReceiptViaRegex(customerQuery || "");
      if (receipt) {
        return {
          isPaymentReceipt: true,
          receiptDetails: receipt,
          productFeatures: null,
          confidence: 0.8,
        };
      }
      return {
        isPaymentReceipt: false,
        receiptDetails: null,
        productFeatures: extractProductFeaturesFromText(customerQuery || ""),
        confidence: 0.6,
      };
    }
  }

  /**
   * End-to-End Multimodal Vision Processing Pipeline
   */
  async processIncomingImage(
    options: ProcessImageOptions,
  ): Promise<VisionProcessingResult> {
    const {
      companyId,
      imageSource,
      customerQuery = "",
      geminiClient,
      tenantDb,
      personaContext,
    } = options;

    const language = options.language || detectCustomerLanguage(customerQuery);

    // 0. Image Ingestion & Header Verification
    let inlineData: ImageInlineData;
    try {
      inlineData = await ingestImageToInlineData(imageSource, companyId);
    } catch (error) {
      const isCorrupted =
        error instanceof ImageIngestionError ? error.isCorrupted : true;
      const errorMsg = formatError(error).message;
      logger.warn({ error: errorMsg, companyId }, "Image ingestion failed");

      // Courteous apology for unreadable/corrupted media
      let reply =
        "Dukkhito bhaiya, chobi ti thikbhabe open kora jachhe na ba format ti supported noy (ফরম্যাটটি সাপোর্টেড নয়). Doya kore regular JPG বা PNG chobi ti abar send korben ki?";
      if (language === "bangla") {
        reply =
          "দুঃখিত ভাইয়া, ছবিটি সঠিকভাবে ওপেন করা যাচ্ছে না অথবা ফাইলটির ফরম্যাটটি সাপোর্টেড নয়। অনুগ্রহ করে ছবিটি পুনরায় সেন্ড করবেন কি? (একটি সাধারণ JPG বা PNG ছবি পাঠান)।";
      } else if (language === "english") {
        reply =
          "Sorry, we could not open this image or this file format is not supported (ফরম্যাটটি সাপোর্টেড নয়). Please resend a standard JPG or PNG image (JPG বা PNG).";
      }

      return {
        success: false,
        isCorrupted,
        error: errorMsg,
        replyText: reply,
      };
    }

    // 1. Stage 1: Feature & OCR Extraction
    const extraction = await this.extractVisionFeatures(
      inlineData,
      geminiClient,
      customerQuery,
    );

    // If Payment Receipt: Skip catalog search and generate receipt acknowledgment
    if (extraction.isPaymentReceipt) {
      const turnContext: GroundedTurnContext = {
        extraction,
        bestMatch: null,
        candidateProducts: [],
        customerQuery,
        language,
        personaContext,
      };

      const replyText = buildDeterministicGroundedReply(turnContext);
      return {
        success: true,
        extraction,
        bestMatch: null,
        candidateProducts: [],
        isCatalogMatch: false,
        replyText,
      };
    }

    // If Non-Product (ID Card, Selfie, Document, Screenshot, etc.): Skip catalog search
    if (extraction.isNonProduct) {
      const turnContext: GroundedTurnContext = {
        extraction,
        bestMatch: null,
        candidateProducts: [],
        customerQuery,
        language,
        personaContext,
      };

      let replyText = "";
      if (geminiClient) {
        try {
          const systemPrompt = formatGroundedTurnPrompt(turnContext);
          const modelRes = await geminiClient.generateChatResponse({
            messages: [
              {
                role: "user",
                content: customerQuery || "Here is an image.",
              },
            ],
            systemInstruction: systemPrompt,
            temperature: 0.5,
          });
          if (modelRes.text && modelRes.text.trim().length > 0) {
            replyText = modelRes.text.trim();
          }
        } catch {
          // fallback to deterministic reply
        }
      }

      if (!replyText) {
        replyText = buildDeterministicGroundedReply(turnContext);
      }

      replyText = sanitizeAiReply(replyText, language);

      return {
        success: true,
        extraction,
        bestMatch: null,
        candidateProducts: [],
        isCatalogMatch: false,
        replyText,
      };
    }

    // 2. Stage 2: 2-Stage Hybrid Catalog Search
    const searchResult = await searchCatalogByVisualFeatures(
      companyId,
      extraction.productFeatures,
      { tenantDb },
    );

    // 3. Stage 3: Grounded Turn Generation
    const turnContext: GroundedTurnContext = {
      extraction,
      bestMatch: searchResult.bestMatch,
      candidateProducts: searchResult.matches,
      customerQuery,
      language,
      personaContext,
    };

    let replyText = "";
    if (geminiClient) {
      try {
        const systemPrompt = formatGroundedTurnPrompt(turnContext);
        const modelRes = await geminiClient.generateChatResponse({
          messages: [
            {
              role: "user",
              content: customerQuery || "Tell me about this product.",
            },
          ],
          systemInstruction: systemPrompt,
          temperature: 0.6,
        });
        if (modelRes.text && modelRes.text.trim().length > 0) {
          replyText = modelRes.text.trim();
        }
      } catch (err) {
        logger.debug(
          { err: formatError(err) },
          "Grounded prompt call to Gemini failed; falling back to deterministic reply",
        );
      }
    }

    if (!replyText) {
      replyText = buildDeterministicGroundedReply(turnContext);
    }

    replyText = sanitizeAiReply(replyText, language);

    return {
      success: true,
      extraction,
      bestMatch: searchResult.bestMatch,
      candidateProducts: searchResult.matches,
      isCatalogMatch: searchResult.isCatalogMatch,
      replyText,
    };
  }
}

export const visionService = new VisionService();
