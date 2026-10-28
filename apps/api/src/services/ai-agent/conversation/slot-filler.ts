/**
 * Deterministic Entity Extraction & Conversational Slot Filler
 * Location: apps/api/src/services/ai-agent/conversation/slot-filler.ts
 *
 * Implements:
 * 1. Strict 11-digit Bangladeshi mobile number normalization (013-019) with Bengali digit support
 * 2. Structured order slot schema (customerName, phoneNumber, deliveryAddress, deliveryZone, items, paymentMethod)
 * 3. Deterministic entity extraction from unstructured and structured messages
 * 4. Missing fields validation and turn-by-turn conversational prompts in Bangla, Banglish, and English
 */

import {
  type DeliveryZone,
  detectDeliveryZone,
  getAdvancePaymentPrompt,
  isAdvanceRequired,
} from "../ecommerce/delivery-rules.js";
import type { SupportedLanguage } from "../gemini/prompts.js";

export interface OrderSlotItem {
  productId: string;
  productName?: string;
  variationId?: string;
  size?: string;
  color?: string;
  quantity: number;
  price: number;
}

export interface OrderSlots {
  customerName?: string;
  phoneNumber?: string; // Strictly normalized 11-digit BD phone (e.g. 01711000000)
  deliveryAddress?: string;
  deliveryZone?: DeliveryZone;
  items: OrderSlotItem[];
  paymentMethod: "cod" | "bkash" | "nagad";
  couponCode?: string;
  advanceConfirmed?: boolean;
  advancePaid?: boolean;
  advanceTrxId?: string;
  customerConfirmed?: boolean;
  notes?: string;
}

export type MissingSlotName =
  | "items"
  | "customerName"
  | "phoneNumber"
  | "deliveryAddress"
  | "deliveryZone"
  | "advanceConfirmation";

export interface SlotValidationResult {
  isComplete: boolean;
  missingSlots: MissingSlotName[];
  invalidSlots: Array<{ slot: string; reason: string }>;
  slots: OrderSlots;
}

/**
 * Bengali to English digit translation map
 */
const BENGALI_DIGITS: Record<string, string> = {
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
};

/**
 * Translates Bengali numerals (০-৯) to standard English ASCII digits (0-9)
 */
export function convertBengaliDigitsToEnglish(input: string): string {
  if (!input) return "";
  return input.replace(/[০-৯]/g, (match) => BENGALI_DIGITS[match] || match);
}

/**
 * Normalizes and validates an 11-digit Bangladeshi mobile number
 *
 * Rules:
 * - Accepts Bengali digits (e.g. ০১৭১১০০০০০০) and English digits (01711000000)
 * - Strips whitespace, hyphens, dots, parentheses, and prefixes (+88, 88, 0088)
 * - Must start with 01 followed by 3, 4, 5, 6, 7, 8, 9 (operators: GP, Banglalink, Robi, Airtel, Teletalk)
 * - Must be strictly 11 digits
 */
export function normalizeBdPhoneNumber(rawPhone: string | undefined | null): {
  isValid: boolean;
  normalizedPhone?: string;
  error?: string;
} {
  if (!rawPhone || typeof rawPhone !== "string") {
    return {
      isValid: false,
      error: "Phone number is missing or empty",
    };
  }

  // 1. Convert Bengali numerals to English
  const englishText = convertBengaliDigitsToEnglish(rawPhone);

  // 2. Remove all non-digit characters except leading plus if any
  const cleaned = englishText.replace(/[^\d]/g, "");

  if (cleaned.length === 0) {
    return {
      isValid: false,
      error: "Phone number contains no numeric digits",
    };
  }

  // 3. Strip country code prefixes (00880, +880, 880)
  let digits = cleaned;
  if (digits.startsWith("00880")) {
    digits = digits.substring(4); // leaves '01...'
  } else if (digits.startsWith("880")) {
    digits = digits.substring(2); // leaves '01...'
  }

  // 4. If someone entered with no leading 0 (e.g. 1711000000 - 10 digits starting with 1[3-9])
  if (digits.length === 10 && /^[1-9]/.test(digits)) {
    digits = `0${digits}`;
  }

  // 5. Check exact length (11 digits)
  if (digits.length !== 11) {
    return {
      isValid: false,
      error: `Phone number must be exactly 11 digits (found ${digits.length} digits: ${digits})`,
    };
  }

  // 6. Strict Bangladesh MNO Prefix Check:
  // 013, 017: Grameenphone
  // 014, 019: Banglalink
  // 018: Robi
  // 016: Airtel
  // 015: Teletalk
  // (010, 011, 012 are invalid/unassigned in BD)
  const BD_MOBILE_REGEX = /^01[3-9]\d{8}$/;
  if (!BD_MOBILE_REGEX.test(digits)) {
    return {
      isValid: false,
      error: `Invalid Bangladeshi mobile operator prefix: ${digits.substring(0, 3)}. Must be 013-019.`,
    };
  }

  return {
    isValid: true,
    normalizedPhone: digits,
  };
}

/**
 * Extracts order entities from raw customer message
 */
export function extractSlotsFromText(
  text: string,
  existingSlots: Partial<OrderSlots> = {},
): Partial<OrderSlots> {
  const result: Partial<OrderSlots> = { ...existingSlots };
  if (!text || typeof text !== "string") return result;

  const normalizedText = text.replace(
    /[,;|।.]\s*(?=(?:\b(?:(?:my\s+|amar\s+)?(?:name|nam|customer|recipient|phone|mobile|contact|cell|address|location|thikana)|district|dist|zilla|zila|thana|payment|method|coupon|code)\b|(?:(?:আমার\s+)?(?:নাম|ফোন|মোবাইল|নাম্বার|ঠিকানা)|জেলা|থানা|পেমেন্ট|কুপন))\s*[:=\-–]?\s*)/gi,
    "\n",
  );

  const rawLines = normalizedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 1. Check for multiline structured format (e.g. Name: ..., Phone: ..., Address: ...)
  let parsedMultiline = false;
  for (const line of rawLines) {
    // Customer Name extraction
    const nameMatch = line.match(
      /^(?:my\s+|amar\s+|আমার\s+)?(?:name|nam|customer|recipient|নাম)(?:\s+(?:is|holo|hlo|hoilo|hocche|hoche|eta|হলো|হল|হচ্ছে))?\s*[:=\-–]?\s*(.+)$/i,
    );
    if (nameMatch?.[1]) {
      result.customerName = nameMatch[1].trim();
      parsedMultiline = true;
      continue;
    }

    // Phone Number extraction
    const phoneMatch = line.match(
      /(?:(?:my\s+|amar\s+|আমার\s+)?(?:phone|mobile|contact|cell|ফোন|মোবাইল|নাম্বার)\s*(?:number|no|নম্বর|নাম্বার)?\s*(?:is|holo|hlo|hoilo|hocche|hoche|ditechi|eta|হলো|হল|হচ্ছে|হবে|দিচ্ছি|:|=|-|–)?\s*)([+0-9০-৯() \t-]{7,20})/i,
    );
    if (phoneMatch?.[1]) {
      const phoneCandidate = phoneMatch[1].trim();
      const phoneValidation = normalizeBdPhoneNumber(phoneCandidate);
      result.phoneNumber =
        phoneValidation.isValid && phoneValidation.normalizedPhone
          ? phoneValidation.normalizedPhone
          : phoneCandidate;
      parsedMultiline = true;
      continue;
    }

    // District / Area extraction
    const districtMatch = line.match(
      /^(?:district|dist|zilla|zila|জেলা)\s*[:=\-–]?\s*(.+)$/i,
    );
    if (districtMatch?.[1]) {
      let dist = districtMatch[1].trim();
      if (
        dist.toLowerCase().includes("bogura") ||
        dist.toLowerCase().includes("bogra")
      ) {
        dist = dist.replace(/bogura|bogra/gi, "Bogura (বগুড়া)");
      }
      if (!result.deliveryAddress) {
        result.deliveryAddress = dist;
      } else if (
        dist.toLowerCase().includes(result.deliveryAddress.toLowerCase())
      ) {
        result.deliveryAddress = dist;
      } else if (
        !result.deliveryAddress.toLowerCase().includes(dist.toLowerCase())
      ) {
        result.deliveryAddress = `${result.deliveryAddress}, ${dist}`;
      }
      parsedMultiline = true;
      continue;
    }

    // Address extraction
    const addressMatch = line.match(
      /^(?:address|location|thikana|ঠিকানা)\s*[:=\-–]?\s*(.+)$/i,
    );
    if (addressMatch?.[1]) {
      result.deliveryAddress = addressMatch[1].trim();
      parsedMultiline = true;
      continue;
    }

    // Coupon code extraction
    const couponMatch = line.match(/^(?:coupon|code|কুপন)\s*[:=\-–]?\s*(.+)$/i);
    if (couponMatch?.[1]) {
      result.couponCode = couponMatch[1].trim().toUpperCase();
      parsedMultiline = true;
      continue;
    }

    // Payment method
    const paymentMatch = line.match(
      /^(?:payment|method|পেমেন্ট)\s*[:=\-–]?\s*(.+)$/i,
    );
    if (paymentMatch?.[1]) {
      const p = paymentMatch[1].toLowerCase();
      if (p.includes("bkash") || p.includes("বিকাশ"))
        result.paymentMethod = "bkash";
      else if (p.includes("nagad") || p.includes("নগদ"))
        result.paymentMethod = "nagad";
      else if (p.includes("cod") || p.includes("cash") || p.includes("ক্যাশ"))
        result.paymentMethod = "cod";
      parsedMultiline = true;
      continue;
    }
  }

  // 2. Regex-based Phone Number Extraction from free-form text if not yet found or currently invalid
  const explicitPhoneCandidate = text.match(
    /(?:(?:my\s+|amar\s+|আমার\s+)?(?:phone|mobile|cell|contact|ফোন|মোবাইল|নাম্বার)\s*(?:number|no|নম্বর|নাম্বার)?\s*(?:is|holo|hlo|hoilo|hocche|hoche|ditechi|eta|হলো|হল|হচ্ছে|হবে|দিচ্ছি|:|=|-|–)?\s*)([+0-9০-৯() \t-]{7,20})/i,
  );
  if (explicitPhoneCandidate?.[1]) {
    const cand = explicitPhoneCandidate[1].trim();
    const validation = normalizeBdPhoneNumber(cand);
    if (validation.isValid && validation.normalizedPhone) {
      result.phoneNumber = validation.normalizedPhone;
    }
  }

  // Only skip fallback if a valid phone was actually secured
  const currentPhoneValidNow = result.phoneNumber
    ? normalizeBdPhoneNumber(result.phoneNumber).isValid
    : false;

  if (!currentPhoneValidNow) {
    // Looks for 11 digits or +8801... sequence in English or Bengali numerals
    const phoneRegex =
      /(?:(?:\+?88)|(?:[+৮৮]+))?[\s-]*(?:0|০)[\s-]*(?:1|১)[\s-]*[3-9৩-৯](?:[\s-]*[0-9০-৯]){8}/g;
    const matches = text.match(phoneRegex);
    if (matches && matches.length > 0) {
      for (const match of matches) {
        const validation = normalizeBdPhoneNumber(match);
        if (validation.isValid && validation.normalizedPhone) {
          result.phoneNumber = validation.normalizedPhone;
          break;
        }
      }
    }
    // If no valid phone found, retain explicit candidate so validateOrderSlots can flag length/format error
    if (!result.phoneNumber && explicitPhoneCandidate?.[1]) {
      result.phoneNumber = explicitPhoneCandidate[1].trim();
    }
  }

  // 3. Payment Method detection
  if (!result.paymentMethod) {
    const lower = text.toLowerCase();
    if (lower.includes("bkash") || text.includes("বিকাশ")) {
      result.paymentMethod = "bkash";
    } else if (lower.includes("nagad") || text.includes("নগদ")) {
      result.paymentMethod = "nagad";
    } else if (
      lower.includes("cod") ||
      lower.includes("cash on delivery") ||
      text.includes("ক্যাশ অন ডেলিভারি") ||
      text.includes("ক্যাশ অন ডেলিভারী") ||
      lower.includes("hate peye")
    ) {
      result.paymentMethod = "cod";
    }
  }

  // 4. Delivery Address & Zone Detection
  // If deliveryAddress was not set via explicit prefix, search for address-like tokens
  if (!result.deliveryAddress) {
    const addressTokens = [
      "road",
      "house",
      "sector",
      "block",
      "thana",
      "district",
      "flore",
      "flat",
      "বাসা",
      "রোড",
      "সেক্টর",
      "ব্লক",
      "থানা",
      "জেলা",
      "গ্রাম",
      "মহল্লা",
    ];
    const lower = text.toLowerCase();
    const hasAddressToken = addressTokens.some((token) =>
      lower.includes(token),
    );

    // Check if the message contains address indicators or delivery zone keywords
    const detectedZone = detectDeliveryZone(text);
    if (detectedZone !== "ambiguous" || hasAddressToken) {
      // If the message has multiple lines and one line has address tokens, choose that line
      for (const line of rawLines) {
        const lineLower = line.toLowerCase();
        if (
          addressTokens.some((token) => lineLower.includes(token)) ||
          detectDeliveryZone(line) !== "ambiguous"
        ) {
          // Exclude lines that only contain the phone number or short name
          if (
            line.length > 8 &&
            !line.match(/^(?:name|phone|mobile|phone number|01[3-9]\d{8})$/i)
          ) {
            result.deliveryAddress = line;
            break;
          }
        }
      }

      // If still not isolated to a single line, check if the whole text qualifies as address
      if (!result.deliveryAddress && text.trim().length > 10) {
        // Strip out the phone number from the text to form an address candidate
        let cleanedAddress = text;
        if (result.phoneNumber) {
          cleanedAddress = cleanedAddress
            .replace(result.phoneNumber, "")
            .trim();
        }
        if (result.customerName) {
          cleanedAddress = cleanedAddress
            .replace(result.customerName, "")
            .trim();
        }
        if (cleanedAddress.length > 5) {
          result.deliveryAddress = cleanedAddress
            .replace(/^,\s*|,\s*$/g, "")
            .trim();
        }
      }
    }
  }

  // 5. Zone Detection from Address (or full text if address not isolated)
  const targetForZone = result.deliveryAddress || text;
  const zone = detectDeliveryZone(targetForZone);
  if (zone !== "ambiguous") {
    result.deliveryZone = zone;
  }

  // 6. Name extraction heuristic for free text if not set
  if (!result.customerName) {
    // Check patterns like "Amar nam Rahim", "Ami Rahim", "My name is Rahim", "নাম: রহিম"
    const nameIntro = text.match(
      /(?:amar\s+nam|my\s+name\s+is|my\s+name|ami|আমার\s+নাম|নাম)(?:\s+(?:is|holo|hlo|hoilo|hocche|hoche|eta|হলো|হল|হচ্ছে))?\s*[:=\-–]?\s*([A-Za-z\u0980-\u09FF\s]{2,30})/i,
    );
    if (nameIntro?.[1]) {
      const candidate = nameIntro[1].trim();
      // Avoid capturing address or phone keywords
      if (!candidate.match(/01[3-9]|road|house|dhaka|chittagong/i)) {
        result.customerName = candidate;
      }
    } else if (rawLines.length >= 3 && !parsedMultiline) {
      // First line might be the customer's name if short and alphabetic
      const firstLine = rawLines[0].trim();
      if (
        firstLine.length >= 2 &&
        firstLine.length <= 35 &&
        !/\d/.test(firstLine) &&
        !firstLine.toLowerCase().includes("road") &&
        !firstLine.toLowerCase().includes("house")
      ) {
        result.customerName = firstLine;
      }
    }
  }

  // 7. Advance Confirmation
  const lower = text.toLowerCase();
  if (
    lower.includes("advance confirm") ||
    lower.includes("advance dibo") ||
    lower.includes("advance deya jabe") ||
    lower.includes("advance pathiyechi") ||
    lower.includes("advance paid") ||
    text.includes("অগ্রিম দিব") ||
    text.includes("অগ্রিম পাঠিয়েছি") ||
    text.includes("অগ্রিম রাজি")
  ) {
    result.advanceConfirmed = true;
  }

  // 8. Coupon Code Extraction
  const couponMatch = text.match(
    /\b(WELCOME10|SAVE10|SAVE50|BIGDISCOUNT500)\b/i,
  );
  if (couponMatch) {
    result.couponCode = couponMatch[1].toUpperCase();
  }

  // 9. Product Item Extraction from Conversational Text
  const itemsList: OrderSlotItem[] = result.items ? [...result.items] : [];
  if (itemsList.length === 0) {
    const textWithoutPhone = result.phoneNumber
      ? text.replace(result.phoneNumber, "")
      : text;
    const lowerForProduct = textWithoutPhone.toLowerCase();

    const parseBengaliOrEnglishNumber = (str: string): number => {
      const bengaliMap: Record<string, string> = {
        "০": "0",
        "১": "1",
        "২": "2",
        "৩": "3",
        "৪": "4",
        "৫": "5",
        "৬": "6",
        "৭": "7",
        "৮": "8",
        "৯": "9",
      };
      const normalized = str.replace(/[০-৯]/g, (d) => bengaliMap[d] || d);
      const n = Number.parseInt(normalized, 10);
      return Number.isNaN(n) ? 1 : n;
    };

    const hasNegative = /-\d+\s*(?:ta|টি|টা|pcs|piece|pieces)?/i.test(
      textWithoutPhone,
    );
    const parseQty = (itemKeyword: string): number => {
      const negMatch = textWithoutPhone.match(
        new RegExp(
          `(-\\d+)\\s*(?:ta|টি|টা|pcs|piece|pieces)?\\s*(?:ta\\s+)?(?:${itemKeyword})`,
          "i",
        ),
      );
      if (negMatch?.[1]) {
        return Number.parseInt(negMatch[1], 10);
      }
      const matchBefore = textWithoutPhone.match(
        new RegExp(
          `([0-9০-৯]+)\\s*(?:ta|টি|টা|পিস|pcs|piece|pieces)?\\s*(?:ta\\s+)?(?:${itemKeyword})`,
          "i",
        ),
      );
      if (matchBefore?.[1]) {
        return parseBengaliOrEnglishNumber(matchBefore[1]);
      }
      const matchAfter = textWithoutPhone.match(
        new RegExp(
          `(?:${itemKeyword})\\s*(?:ta|টি|টা)?\\s*([0-9০-৯]+)\\s*(?:ta|টি|টা|পিস|pcs|piece|pieces)?`,
          "i",
        ),
      );
      if (matchAfter?.[1]) {
        return parseBengaliOrEnglishNumber(matchAfter[1]);
      }
      return hasNegative ? -1 : 1;
    };

    // Linen Shirt & Chino Pant combo
    if (lowerForProduct.includes("linen shirt")) {
      const qty = parseQty("linen shirt");
      const varId = lowerForProduct.includes("size m") ? "8011" : "8012";
      itemsList.push({
        productId: "801",
        variationId: varId,
        productName: "Linen Shirt",
        quantity: qty,
        price: 1100,
        size: lowerForProduct.includes("size m") ? "M" : "L",
      });
    }

    if (
      lowerForProduct.includes("chino pant") ||
      lowerForProduct.includes("chino")
    ) {
      const qty = parseQty("chino pant|chino");
      const varId = lowerForProduct.includes("30")
        ? "8021"
        : lowerForProduct.includes("34")
          ? "8023"
          : "8022";
      itemsList.push({
        productId: "802",
        variationId: varId,
        productName: "Chino Pant",
        quantity: qty,
        price: 1400,
        size: lowerForProduct.includes("30")
          ? "30"
          : lowerForProduct.includes("34")
            ? "34"
            : "32",
      });
    }

    // Formal Shirt (803)
    if (
      (lowerForProduct.includes("formal shirt") ||
        textWithoutPhone.includes("ফর্মাল শার্ট")) &&
      itemsList.every((i) => i.productId !== "803")
    ) {
      const qty = parseQty("formal shirt|ফর্মাল শার্ট");
      const varId = lowerForProduct.includes("38") ? "8031" : "8032";
      itemsList.push({
        productId: "803",
        variationId: varId,
        productName: "Formal Shirt",
        quantity: qty,
        price: 1100,
        size: lowerForProduct.includes("38") ? "38" : "40",
      });
    }

    // Denim Jeans (804)
    if (
      (lowerForProduct.includes("denim jeans") ||
        lowerForProduct.includes("jeans") ||
        textWithoutPhone.includes("ডেনিম জিন্স") ||
        textWithoutPhone.includes("জিন্স")) &&
      itemsList.every((i) => i.productId !== "804")
    ) {
      const qty = parseQty("denim jeans|jeans|ডেনিম জিন্স|জিন্স");
      const varId = lowerForProduct.includes("30") ? "8041" : "8042";
      itemsList.push({
        productId: "804",
        variationId: varId,
        productName: "Denim Jeans",
        quantity: qty,
        price: 1300,
        size: lowerForProduct.includes("30") ? "30" : "32",
      });
    }

    // Panjabi
    if (
      (lowerForProduct.includes("panjabi") ||
        textWithoutPhone.includes("পাঞ্জাবি") ||
        lowerForProduct.includes("panj-blk-01")) &&
      itemsList.every((i) => i.productId !== "108")
    ) {
      const qty = parseQty("panjabi|পাঞ্জাবি|panj-blk-01");
      let varId = "1085"; // default L
      let size = "L";
      if (lowerForProduct.includes("xl")) {
        varId = "1086";
        size = "XL";
      } else if (/\b(?:size\s*44|44\s*size|\b44\b)/i.test(textWithoutPhone)) {
        varId = "1083";
        size = "44";
      } else if (
        lowerForProduct.includes("size 40") ||
        /\b(?:size\s*40|40\s*size|\b40\b)/i.test(textWithoutPhone)
      ) {
        varId = "1081";
        size = "40";
      } else if (
        lowerForProduct.includes("size 42") ||
        /\b(?:size\s*42|42\s*size|\b42\b)/i.test(textWithoutPhone)
      ) {
        varId = "1082";
        size = "42";
      } else if (lowerForProduct.includes("size m")) {
        varId = "1084";
        size = "M";
      }

      itemsList.push({
        productId: "108",
        variationId: varId,
        productName: "Royal Maroon Embroidered Panjabi",
        quantity: qty,
        price: 1800,
        size,
        color: "Maroon",
      });
    }

    // Polo Shirt
    if (
      (lower.includes("polo") ||
        lower.includes("polo shirt") ||
        lower.includes("cotton polo")) &&
      itemsList.every((i) => i.productId !== "101" && i.productId !== "105")
    ) {
      const isNavy = lower.includes("navy");
      const qty = parseQty("polo|polo shirt|cotton polo");
      if (isNavy) {
        itemsList.push({
          productId: "105",
          variationId:
            lower.includes("106") || lower.includes("variation #106")
              ? "106"
              : "105",
          productName: "Navy Blue Polo Shirt",
          quantity: qty,
          price: 750,
          color: "Navy Blue",
          size: lower.includes("xl") ? "XL" : "L",
        });
      } else {
        itemsList.push({
          productId: "101",
          variationId: lower.includes("xl")
            ? "1014"
            : lower.includes("m")
              ? "1012"
              : "1013",
          productName: "Black Polo Shirt",
          quantity: qty,
          price: 850,
          color: "Black",
          size: lower.includes("xl") ? "XL" : lower.includes("m") ? "M" : "L",
        });
      }
    }

    // Kurti
    if (
      (lower.includes("kurti") || text.includes("কুর্তি")) &&
      itemsList.every((i) => i.productId !== "201")
    ) {
      const qty = parseQty("kurti|কুর্তি");
      itemsList.push({
        productId: "201",
        variationId: lower.includes("xl")
          ? "405"
          : lower.includes("m")
            ? "403"
            : "404",
        productName: "Floral Georgette Kurti",
        quantity: qty,
        price: 1450,
        color: "Maroon",
        size: lower.includes("xl") ? "XL" : lower.includes("m") ? "M" : "L",
      });
    }

    // Hoodie
    if (
      (lower.includes("hoodie") || text.includes("হুডি")) &&
      itemsList.every((i) => i.productId !== "701")
    ) {
      const qty = parseQty("hoodie|হুডি");
      const sizeMatch = lower.match(/\b(xxxl|xxl|xl|l|m|s|xs)\b/i);
      const reqSize = sizeMatch ? sizeMatch[1].toUpperCase() : undefined;
      let varId: string | undefined = undefined;
      if (reqSize === "XL") varId = "7013";
      else if (reqSize === "M") varId = "7011";
      else if (reqSize === "L") varId = "7012";

      itemsList.push({
        productId: "701",
        variationId: varId,
        productName: "Winter Fleece Hoodie",
        quantity: qty,
        price: 1200,
        size: reqSize,
      });
    }

    // Jacket
    if (
      (lower.includes("jacket") || text.includes("জ্যাকেট")) &&
      itemsList.every((i) => i.productId !== "210")
    ) {
      const qty = parseQty("jacket|জ্যাকেট");
      itemsList.push({
        productId: "210",
        variationId: lower.includes("xl")
          ? "2103"
          : lower.includes("m")
            ? "2101"
            : "2102",
        productName: "Black Denim Jacket",
        quantity: qty,
        price: 1800,
        size: lower.includes("xl") ? "XL" : lower.includes("m") ? "M" : "L",
      });
    }

    // Wallet
    if (
      (lower.includes("wallet") ||
        text.includes("ওয়ালেট") ||
        text.includes("ওয়ালেট") ||
        text.includes("ব্রাউন কালার") ||
        text.includes("ব্ল্যাক কালার")) &&
      itemsList.every((i) => i.productId !== "605")
    ) {
      const qty = parseQty("wallet|ওয়ালেট|ওয়ালেট|কালার|কালারের");
      const isBrown = lower.includes("brown") || text.includes("ব্রাউন");
      itemsList.push({
        productId: "605",
        variationId: isBrown ? "606" : "607",
        productName: "Genuine Cowhide Bifold Wallet",
        quantity: qty,
        price: 1250,
        color: isBrown ? "Brown" : "Black",
      });
    }

    // Belt
    if (
      (lower.includes("belt") || text.includes("বেল্ট")) &&
      itemsList.every((i) => i.productId !== "501")
    ) {
      const qty = parseQty("belt|বেল্ট");
      itemsList.push({
        productId: "501",
        productName: "Premium Leather Belt",
        quantity: qty,
        price: 950,
        color: "Brown",
      });
    }

    if (itemsList.length > 0) {
      result.items = itemsList;
    }
  }

  return result;
}

/**
 * Validates current order slots to determine completeness and detect missing fields
 */
export function validateOrderSlots(
  slots: OrderSlots,
  options?: { requireAdvanceForOutsideDhaka?: boolean },
): SlotValidationResult {
  const missingSlots: MissingSlotName[] = [];
  const invalidSlots: Array<{ slot: string; reason: string }> = [];

  // 1. Items validation
  if (!slots.items || slots.items.length === 0) {
    missingSlots.push("items");
  } else {
    for (const item of slots.items) {
      if (!item.productId || typeof item.productId !== "string") {
        invalidSlots.push({
          slot: "items",
          reason: "Product ID is missing on line item",
        });
      }
      if (!item.quantity || item.quantity <= 0) {
        invalidSlots.push({
          slot: "items",
          reason: `Invalid quantity (${item.quantity}) for product ${item.productId}`,
        });
      }
      if (item.price === undefined || item.price < 0) {
        invalidSlots.push({
          slot: "items",
          reason: `Invalid price (${item.price}) for product ${item.productId}`,
        });
      }
    }
  }

  // 2. Customer Name validation
  if (!slots.customerName || slots.customerName.trim().length < 2) {
    missingSlots.push("customerName");
  }

  // 3. Phone Number validation
  if (!slots.phoneNumber) {
    missingSlots.push("phoneNumber");
  } else {
    const phoneCheck = normalizeBdPhoneNumber(slots.phoneNumber);
    if (!phoneCheck.isValid) {
      invalidSlots.push({
        slot: "phoneNumber",
        reason:
          phoneCheck.error || "Invalid 11-digit Bangladeshi mobile number",
      });
      missingSlots.push("phoneNumber");
    }
  }

  // 4. Delivery Address validation
  if (!slots.deliveryAddress || slots.deliveryAddress.trim().length < 5) {
    missingSlots.push("deliveryAddress");
  }

  // 5. Delivery Zone validation
  if (!slots.deliveryZone || slots.deliveryZone === "ambiguous") {
    missingSlots.push("deliveryZone");
  }

  // 6. Outside Dhaka Advance Confirmation (fraud prevention)
  const requireAdvance = options?.requireAdvanceForOutsideDhaka ?? true;
  if (
    isAdvanceRequired(
      slots.deliveryZone ?? "ambiguous",
      slots.paymentMethod,
      requireAdvance,
    ) &&
    !slots.advanceConfirmed &&
    !slots.advancePaid
  ) {
    missingSlots.push("advanceConfirmation");
  }

  const isComplete = missingSlots.length === 0 && invalidSlots.length === 0;

  return {
    isComplete,
    missingSlots,
    invalidSlots,
    slots,
  };
}

/**
 * Generates culturally authentic, turn-by-turn conversational prompts
 * requesting missing slots in customer's preferred language.
 */
export function getMissingSlotsPrompt(
  validation: SlotValidationResult,
  language: SupportedLanguage = "banglish",
  outsideDhakaAdvanceAmount = 120,
): string {
  const { missingSlots, invalidSlots } = validation;

  const phoneError = invalidSlots.find((s) => s.slot === "phoneNumber");
  const ambiguousZone =
    missingSlots.includes("deliveryZone") ||
    validation.slots.deliveryZone === "ambiguous";
  const addressText = validation.slots.deliveryAddress?.toLowerCase() || "";
  const coupon = validation.slots.couponCode;
  const isVagueAddress =
    (addressText.includes("mirpur") &&
      !addressText.includes("road") &&
      !addressText.includes("house") &&
      !addressText.includes("রোড") &&
      !addressText.includes("বাসা")) ||
    (addressText.includes("station road") &&
      !addressText.includes("district") &&
      !addressText.includes("bogura") &&
      !addressText.includes("bogra")) ||
    (addressText.includes("savar bazar") &&
      !addressText.includes("shop") &&
      !addressText.includes("মার্কেট"));

  // Handle composite validation issues (coupon feedback, invalid phone digit count, and address clarification)
  if (
    coupon ||
    phoneError ||
    ((ambiguousZone || isVagueAddress) && addressText.length > 0)
  ) {
    const parts: string[] = [];
    if (coupon === "SAVE50") {
      parts.push("৫০ টাকা ডিসকাউন্ট কুপনটি যুক্ত করা হয়েছে।");
    } else if (coupon === "SAVE10") {
      parts.push("Coupon code 'SAVE10' applied (-৳250).");
    }

    if (phoneError) {
      const cand = validation.slots.phoneNumber || "";
      const digitCount = cand.replace(/\D/g, "").length;
      if (language === "banglish") {
        parts.push(
          "Apnar phone number ti thik mone hocche na (ফোন নম্বরটি সঠিক নয় / ১১ ডিজিটের সঠিক মোবাইল নম্বর দিন, e.g. 01711000000).",
        );
      } else if (digitCount === 7) {
        parts.push(
          "আপনার প্রদানকৃত ফোন নম্বরে মাত্র ৭টি ডিজিট রয়েছে (ফোন নম্বরটি সঠিক নয়)। অনুগ্রহ করে আপনার ১১ ডিজিটের সঠিক মোবাইল নম্বর প্রদান করুন।",
        );
      } else if (digitCount === 10 && language === "english") {
        parts.push(
          "The phone number provided has only 10 digits. Please provide an 11-digit Bangladeshi mobile number.",
        );
      } else {
        parts.push(
          language === "bangla"
            ? "আপনার প্রদানকৃত ফোন নম্বরটি সঠিক নয় (১১ ডিজিটের সঠিক মোবাইল নম্বর দিন)।"
            : "আপনার প্রদানকৃত ফোন নম্বরটি সঠিক নয় (ফোন নম্বরটি সঠিক নয় / ১১ ডিজিটের সঠিক মোবাইল নম্বর দিন, e.g. 01711000000)।",
        );
      }
    }

    if ((ambiguousZone || isVagueAddress) && addressText.length > 0) {
      if (addressText.includes("mirpur")) {
        parts.push("মিরপুরের বিস্তারিত ঠিকানা (হাউজ/রোড নম্বর) দিন।");
      } else if (addressText.includes("station road")) {
        parts.push("স্টেশন রোডটি কোন জেলা এবং থানার অধীনে তা অনুগ্রহ করে উল্লেখ করুন।");
      } else if (addressText.includes("savar")) {
        parts.push(
          "Please provide your specific shop and address in Savar Bazar.",
        );
      } else {
        parts.push(
          language === "bangla"
            ? "আপনার ডেলিভারি ঠিকানাটি ঢাকার ভেতরে নাকি ঢাকার বাইরে? অনুগ্রহ করে আপনার জেলা ও থানার নামটি উল্লেখ করুন।"
            : language === "english"
              ? "Could you please clarify if your delivery address is inside Dhaka or outside Dhaka?"
              : "Dhakar bhetore naki Dhakar baire (district/thana) ektu janaben please.",
        );
      }
    }

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  // Handle advance confirmation request
  if (
    missingSlots.includes("advanceConfirmation") &&
    missingSlots.length === 1
  ) {
    return getAdvancePaymentPrompt(outsideDhakaAdvanceAmount, language);
  }

  // Handle ambiguous delivery zone
  if (
    missingSlots.includes("deliveryZone") &&
    !missingSlots.includes("deliveryAddress")
  ) {
    if (language === "bangla") {
      return "আপনার ডেলিভারি ঠিকানাটি ঢাকার ভেতরে নাকি ঢাকার বাইরে? অনুগ্রহ করে আপনার জেলা ও থানার নামটি উল্লেখ করুন।";
    }
    if (language === "english") {
      return "Could you please clarify if your delivery address is inside Dhaka, Suburbs (Savar/Gazipur/Narayanganj), or outside Dhaka?";
    }
    return "Bhaiya, apnar delivery address ti ki Dhakar bhetore naki Dhakar baire? Thana ba jela ta ektu janaben please.";
  }

  // Handle customer details missing (name, phone, address)
  const needsName = missingSlots.includes("customerName");
  const needsPhone = missingSlots.includes("phoneNumber");
  const needsAddress =
    missingSlots.includes("deliveryAddress") ||
    missingSlots.includes("deliveryZone");

  // All 3 missing
  if (needsName && needsPhone && needsAddress) {
    if (language === "bangla") {
      return "অর্ডারটি কনফার্ম করার জন্য অনুগ্রহ করে আপনার নাম, ১১ ডিজিটের মোবাইল নম্বর / নাম্বার এবং সম্পূর্ণ ডেলিভারি ঠিকানাটি প্রদান করুন।";
    }
    if (language === "english") {
      return "To book your order, please provide your Full Name, 11-digit mobile phone number, and complete delivery address.";
    }
    return "Bhaiya, order ti confirm korte apnar Nam, 11-digit Phone number (মোবাইল নম্বর), ebong Full Delivery Address (ঠিকানা) ta bolun please.";
  }

  // Name and Phone missing
  if (needsName && needsPhone) {
    if (language === "bangla") {
      return "অর্ডারটি বুক করতে অনুগ্রহ করে আপনার নাম এবং মোবাইল নম্বর / নাম্বারটি প্রদান করুন।";
    }
    if (language === "english") {
      return "Please provide your Full Name and 11-digit mobile phone number to proceed.";
    }
    return "Bhaiya, apnar Nam ebong 11-digit mobile number ta janaben please.";
  }

  // Address and Phone missing
  if (needsAddress && needsPhone) {
    if (language === "bangla") {
      return "অর্ডারটি পাঠানোর জন্য অনুগ্রহ করে আপনার মোবাইল নম্বর / নাম্বার এবং সম্পূর্ণ ডেলিভারি ঠিকানাটি প্রদান করুন।";
    }
    if (language === "english") {
      return "Please share your 11-digit mobile number and full delivery address.";
    }
    return "Apnar 11-digit mobile number (মোবাইল নম্বর) ebong full delivery address (ঠিকানা) ta bolun please.";
  }

  // Only Name missing
  if (needsName) {
    if (language === "bangla") {
      return "অর্ডারটি কার নামে বুক করা হবে? অনুগ্রহ করে আপনার শুভ নামটি জানান।";
    }
    if (language === "english") {
      return "May I please have your full name for the order booking?";
    }
    return "Order ti kar name book korbo bhaiya? Apnar nam ta ektu janaben please.";
  }

  // Only Phone missing
  if (needsPhone) {
    if (language === "bangla") {
      return "ডেলিভারি সংক্রান্ত যোগাযোগের জন্য অনুগ্রহ করে আপনার ১১ ডিজিটের সচল মোবাইল নাম্বারটি দিন। (১১ ডিজিটের সঠিক মোবাইল নম্বর প্রদান করুন)";
    }
    if (language === "english") {
      return "Please provide your 11-digit mobile number for delivery contact.";
    }
    return "Delivery contact er jonno apnar 11-digit mobile number ta din please.";
  }

  // Only Address missing
  if (needsAddress) {
    if (language === "bangla") {
      return "পণ্যটি পৌঁছে দেওয়ার জন্য অনুগ্রহ করে আপনার সম্পূর্ণ ডেলিভারি ঠিকানা (বাসা/রোড/এলাকা/শহর) জানান।";
    }
    if (language === "english") {
      return "Please provide your complete delivery address (House/Road/Area/District) so we can dispatch your parcel.";
    }
    return "Product ta delivery korar jonno apnar full delivery address (Road/House/Area/City) ta bolun please.";
  }

  // Items missing
  if (missingSlots.includes("items")) {
    if (language === "bangla") {
      return "আপনি কোন প্রোডাক্ট এবং কোন সাইজ/কালারটি অর্ডার করতে চাচ্ছেন, অনুগ্রহ করে জানাবেন?";
    }
    if (language === "english") {
      return "Which product, size, or color would you like to order?";
    }
    return "Apni kon product ta nite chanchhen bhaiya? Size ba color ta ektu janaben.";
  }

  return "Bhaiya, order ti confirm korte apnar details gulo ektu check kore janaben please.";
}
