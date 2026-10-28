/**
 * Mock Base64 media fixtures for Multimodal Vision & OCR testing.
 */

// Valid bKash receipt with ৳120 advance (TrxID: 9K87LM54)
export const BKASH_RECEIPT_VALID_120 = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "bkash_receipt_120.jpg",
  mockMetadata: {
    is_payment_receipt: true,
    provider: "bKash",
    amount: 120,
    trx_id: "9K87LM54",
    confidence: 0.98,
  },
};

// Valid bKash receipt for Scenario 3 (TrxID: 9L43KP889A)
export const BKASH_RECEIPT_SCENARIO_3 = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "bkash_receipt_scenario3.jpg",
  mockMetadata: {
    is_payment_receipt: true,
    provider: "bKash",
    amount: 120,
    trx_id: "9L43KP889A",
    confidence: 0.99,
  },
};

// Valid bKash receipt for TC-T3-05 (TrxID: 9K32MX41L7)
export const BKASH_RECEIPT_TC_T3_05 = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "bkash_receipt_t305.jpg",
  mockMetadata: {
    is_payment_receipt: true,
    provider: "bKash",
    amount: 120,
    trx_id: "9K32MX41L7",
    confidence: 0.97,
  },
};

// Cropped bKash receipt with incomplete TrxID (TC-T2-R2-06)
export const BKASH_RECEIPT_CROPPED = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "bkash_cropped.jpg",
  mockMetadata: {
    is_payment_receipt: true,
    provider: "bKash",
    amount: 120,
    trx_id: "9J7...",
    trx_id_complete: false,
    confidence: 0.65,
  },
};

// Facebook post screenshot showing Panjabi with price ৳1800 (T1-R2-01)
export const PRODUCT_SCREENSHOT_PANJABI = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "fb_panjabi_1800.jpg",
  mockMetadata: {
    extracted_text: "Premium Black Panjabi - ৳1800\nExclusive Eid Collection",
    matched_sku: "PANJ-BLK-01",
    matched_product_id: 108,
    price: 1800,
    available_sizes: ["40", "42", "44"],
  },
};

// Raw garment photo of maroon floral kurti without text (T1-R2-02)
export const PRODUCT_SCREENSHOT_KURTI = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "kurti_photo.jpg",
  mockMetadata: {
    category: "Women / Kurti",
    color: "Maroon / Floral",
    matched_product_id: 201,
  },
};

// Competitor screenshot with Aarong watermark (TC-T2-R2-04 / TC-T3-08)
export const COMPETITOR_SCREENSHOT_AARONG = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "competitor_aarong.jpg",
  mockMetadata: {
    watermark: "Aarong Silk Saree #982",
    in_merchant_catalog: false,
    category: "Party Wear / Gown",
    color: "Emerald Green",
    fabric: "Georgette",
  },
};

// Non-product image: cat meme / landscape (TC-T2-R2-02)
export const NON_PRODUCT_IMAGE_MEME = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "cat_meme.jpg",
  mockMetadata: {
    classification: "non_product",
    is_commercial: false,
  },
};

// Multi-product collage (4 Kurtis in 1 image) (TC-T2-R2-03)
export const MULTI_PRODUCT_COLLAGE = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "kurti_4_collage.jpg",
  mockMetadata: {
    multiple_items_detected: true,
    item_count: 4,
    colors: ["Maroon", "Navy Blue", "Olive", "Black"],
  },
};

// Low-resolution / blurry image (<0.5 confidence) (T1-R2-05 / TC-T2-R2-01)
export const LOW_RES_BLURRY_IMAGE = {
  mimeType: "image/jpeg",
  base64Data:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  fileName: "blurry_thumb.jpg",
  mockMetadata: {
    confidence: 0.35,
    unidentifiable: true,
  },
};

// Corrupted / Unsupported file (TC-T2-R2-05)
export const CORRUPTED_ZERO_BYTE = {
  mimeType: "application/x-msdownload",
  base64Data: "",
  fileName: "malicious_payload.exe",
};
