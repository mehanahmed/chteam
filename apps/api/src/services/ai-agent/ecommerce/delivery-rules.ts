/**
 * Geographic Delivery Rules & Pricing Calculator Engine
 * Location: apps/api/src/services/ai-agent/ecommerce/delivery-rules.ts
 *
 * Implements:
 * 1. Multilingual regex token parser for Bangla, Banglish, and English addresses
 * 2. Delivery zone classification (inside_dhaka ৳80, sub_dhaka ৳120, outside_dhaka ৳150, ambiguous)
 * 3. Mathematical order pricing formulas (subtotal, percentage/fixed coupons, free delivery threshold, grand total)
 * 4. Outside Dhaka advance payment guard (৳120 courier advance via bKash/Nagad for courier RTO loss prevention)
 */

import {
  DEFAULT_DELIVERY_FEES,
  DEFAULT_OUTSIDE_DHAKA_ADVANCE_AMOUNT,
} from "../constants.js";
import type { SupportedLanguage } from "../gemini/prompts.js";

export type DeliveryZone =
  | "inside_dhaka"
  | "sub_dhaka"
  | "outside_dhaka"
  | "ambiguous";

export interface DeliveryRatesConfig {
  insideDhaka: number;
  subDhaka: number;
  outsideDhaka: number;
}

export interface CouponConfig {
  code?: string;
  type: "percentage" | "fixed";
  value: number; // e.g. 10 for 10%, or 100 for 100 BDT
}

export interface CalculationParams {
  items: Array<{ unitPrice: number; quantity: number }>;
  deliveryZone: DeliveryZone;
  coupon?: CouponConfig;
  freeShippingThreshold?: number;
  rates?: Partial<DeliveryRatesConfig>;
  requireOutsideDhakaAdvance?: boolean;
  outsideDhakaAdvanceAmount?: number;
  paymentMethod?: "cod" | "bkash" | "nagad" | string;
}

export interface OrderPricingResult {
  subtotal: number;
  discountAmount: number;
  deliveryFee: number;
  grandTotal: number;
  advanceRequired: boolean;
  advanceAmount: number;
  codDueAmount: number;
  isFreeDelivery: boolean;
  zone: DeliveryZone;
}

const ENGLISH_TO_BENGALI_DIGITS: Record<string, string> = {
  "0": "০",
  "1": "১",
  "2": "২",
  "3": "৩",
  "4": "৪",
  "5": "৫",
  "6": "৬",
  "7": "৭",
  "8": "৮",
  "9": "৯",
};

export function convertEnglishDigitsToBengali(input: string | number): string {
  return String(input).replace(
    /[0-9]/g,
    (match) => ENGLISH_TO_BENGALI_DIGITS[match] || match,
  );
}

/**
 * Suburbs / Sub-Dhaka Tokens (Checked FIRST before Inside Dhaka for precedence)
 * Includes Savar, Gazipur, Narayanganj, Keraniganj, Tongi, Ashulia, Dhamrai, etc.
 * Uses unicode /u flag to cleanly handle non-ASCII Bengali script without \b boundary failures.
 */
const SUB_DHAKA_PATTERN =
  /\b(?:savar|gazipur|narayanganj|narayangonj|keraniganj|keranigonj|tongi|ashulia|dhamrai|kaliganj|hemayetpur|baipayl|bypile|joydebpur|board\s*bazar|konabari|chashara|fatullah|siddhirganj|sonargaon|kanchpur|tarabo|rupganj|dhaka\s*epz|depz)\b|(?:^|[^\p{L}\p{N}])(?:সাভার|গাজীপুর|নারায়ণগঞ্জ|নারায়নগঞ্জ|কেরানীগঞ্জ|কেরানিগঞ্জ|টঙ্গী|টঙ্গি|আশুলিয়া|আশুলিয়া|ধামরাই|কালীগঞ্জ|কালিগঞ্জ|হেমায়েতপুর|হেমায়েতপুর|বাইপাইল|জয়দেবপুর|জয়দেবপুর|বোর্ড\s*বাজার|কোনাবাড়ী|কোনাবাড়ী|চাষাড়া|চাষাড়া|ফতুল্লা|সিদ্ধিরগঞ্জ|সোনারগাঁও|সোনারগা|কাঁচপুর|কাচপুর|তারাবো|রূপগঞ্জ)(?:$|[^\p{L}\p{N}])/iu;

/**
 * Outside Dhaka Tokens (All other 63 districts, divisions, explicit outside markers)
 */
const OUTSIDE_DHAKA_PATTERN =
  /\b(?:outside|baire|bayre|outside\s*dhaka|dhakar\s*baire|dhaka\s*er\s*baire|dhakar\s*bayre|gram|gramanchal|village|chittagong|chattogram|sylhet|rajshahi|khulna|barishal|barisal|rangpur|mymensingh|bogura|bogra|cumilla|comilla|cox'?s\s*bazar|coxsbazar|noakhali|tangail|jessore|jashore|feni|dinajpur|kushtia|pabna|brahmanbaria|faridpur|jamalpur|natore|sirajganj|manikganj|munshiganj|narsingdi|kishoreganj|netrokona|sherpur|bagerhat|chuadanga|jhenaidah|magura|meherpur|narail|satkhira|barguna|bhola|jhalokati|patuakhali|pirojpur|bandarban|chandpur|khagrachhari|lakshmipur|rangamati|habiganj|moulvibazar|sunamganj|gaibandha|kurigram|lalmonirhat|nilphamari|panchagarh|thakurgaon|joypurhat|naogaon|chapainawabganj|chapai\s*nawabganj)\b|(?:^|[^\p{L}\p{N}])(?:বাইরে|গ্রাম|গ্রামাঞ্চল|ঢাকার\s*বাইরে|ঢাকা\s*এর\s*বাইরে|চট্টগ্রাম|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর|ময়মনসিংহ|ময়মনসিংহ|বগুড়া|বগুড়া|কুমিল্লা|কক্সবাজার|নোয়াখালী|নোয়াখালী|টাঙ্গাইল|যশোর|ফেনী|দিনাজপুর|কুষ্টিয়া|কুষ্টিয়া|পাবনা|ব্রাহ্মণবাড়িয়া|ব্রাহ্মণবাড়িয়া|ফরিদপুর|জামালপুর|নাটোর|সিরাজগঞ্জ|মানিকগঞ্জ|মুন্সীগঞ্জ|নরসিংদী|কিশোরগঞ্জ|নেত্রকোণা|নেত্রকোনা|শেরপুর|বাগেরহাট|চুয়াডাঙ্গা|চুয়াডাঙ্গা|ঝিনাইদহ|মাগুরা|মেহেরপুর|নড়াইল|নরাইল|সাতক্ষীরা|বরগুনা|ভোলা|ঝালকাঠি|পটুয়াখালী|পটুয়াখালী|পিরোজপুর|বান্দরবান|চাঁদপুর|খাগড়াছড়ি|খাগড়াছড়ি|লক্ষ্মীপুর|রাঙ্গামাটি|হবিগঞ্জ|মৌলভীবাজার|সুনামগঞ্জ|গাইবান্ধা|কুড়িগ্রাম|কুড়িগ্রাম|লালমনিরহাট|নীলফামারী|পঞ্চগড়|পঞ্চগড়|ঠাকুরগাঁও|জয়পুরহাট|জয়পুরহাট|নওগাঁ|চাঁপাইনবাবগঞ্জ)(?:$|[^\p{L}\p{N}])/iu;

/**
 * Inside Dhaka Neighborhoods and Metro Thanas
 */
const INSIDE_DHAKA_PATTERN =
  /\b(?:dhaka|dhanmondi|gulshan|banani|mirpur|uttara|mohammadpur|badda|motijheel|khilgaon|farmgate|bashundhara|malibagh|rampura|jatrabari|wari|lalbagh|tejgaon|cantonment|paltan|new\s*market|moghbazar|shyamoli|nikunja|airport|dohs|khilkhet|azimpur|panthapath|shahbagh|elephant\s*road|eskaton|segunbagicha|kakrail|shantinagar|bijoynagar|bailey\s*road|hazaribagh|kamrangirchar|gendaria|sutrapur|kotwali|demra|kafrul|pallabi|rupnagar|kalabagan|tejkunipara|chankharpul|agargaon|shewrapara|kazipara|ibrahimpur|nakhalpara|banasree|aftabnagar|vatara|baridhara|kuril|basabo|mugda|jurain|sayedabad|postogola|sadarghat|bangshal|chawkbazar|islampur)\b|(?:^|[^\p{L}\p{N}])(?:ঢাকা|ধানমন্ডি|গুলশান|বনানী|মিরপুর|উত্তরা|মোহাম্মদপুর|বাড্ডা|মতিঝিল|খিলগাঁও|ফার্মগেট|বসুন্ধরা|মালিবাগ|রামপুরা|যাত্রাবাড়ী|যাত্রাবাড়ী|ওয়ারী|ওয়ারী|লালবাগ|তেজগাঁও|ক্যান্টনমেন্ট|পল্টন|নিউ\s*মার্কেট|মগবাজার|শ্যামলী|নিকুঞ্জ|এয়ারপোর্ট|বিমানবন্দর|ডিওএইচএস|খিলক্ষেত|আজিমপুর|পান্থপথ|শাহবাগ|এলিফ্যান্ট\s*রোড|ইস্কাটন|সেগুনবাগিচা|কাকরাইল|শান্তিনগর|বিজয়নগর|বেইলি\s*রোড|হাজারীবাগ|কামরাঙ্গীরচর|গেন্ডারিয়া|সূত্রাপুর|কোতোয়ালী|ডেমরা|কাফরুল|পল্লবী|রূপনগর|কলাবাগান|তেজকুনীপাড়া|চানখারপুল|আগারগাঁও|শেওড়াপাড়া|কাজীপাড়া|ইব্রাহিমপুর|নাখালপাড়া|বনশ্রী|আফতাবনগর|ভাটারা|বারিধারা|কুড়িল|বাসাবো|মুগদা|জুরাইন|সায়েদাবাদ|পোস্তগোলা|সদরঘাট|বংশাল|চকবাজার|ইসলামপুর)(?:$|[^\p{L}\p{N}])/iu;

/**
 * Standard Delivery Zone Classifier
 *
 * Evaluation Order:
 * 1. Sub-Dhaka regex (Savar, Gazipur, Narayanganj, Tongi, etc.) -> 'sub_dhaka'
 *    (Ensures "Savar, Dhaka" is classified as Sub-Dhaka rather than Inside Dhaka)
 * 2. Outside Dhaka regex (Chittagong, Sylhet, etc. or explicit 'outside dhaka') -> 'outside_dhaka'
 * 3. Inside Dhaka regex (Mirpur, Dhanmondi, Gulshan, Uttara, Dhaka city) -> 'inside_dhaka'
 * 4. Ambiguous (Missing or unrecognized location) -> 'ambiguous'
 */
export function detectDeliveryZone(address: string): DeliveryZone {
  if (!address || typeof address !== "string") {
    return "ambiguous";
  }

  const normalized = address.toLowerCase().trim();
  if (normalized.length === 0) {
    return "ambiguous";
  }

  // 1. Check Suburbs / Sub-Dhaka first
  if (SUB_DHAKA_PATTERN.test(normalized)) {
    return "sub_dhaka";
  }

  // Exception: Chittagong Road located inside Dhaka / Jatrabari
  if (
    (/\bchittagong\s*road\b/i.test(normalized) ||
      /(?:^|[^\p{L}\p{N}])(?:চট্টগ্রাম|চিটাগাং)\s*রোড(?:$|[^\p{L}\p{N}])/iu.test(
        normalized,
      )) &&
    INSIDE_DHAKA_PATTERN.test(normalized)
  ) {
    return "inside_dhaka";
  }

  // 2. Check Outside Dhaka
  if (OUTSIDE_DHAKA_PATTERN.test(normalized)) {
    return "outside_dhaka";
  }

  // 3. Check Inside Dhaka
  if (INSIDE_DHAKA_PATTERN.test(normalized)) {
    return "inside_dhaka";
  }

  // 4. Fallback: Ambiguous / needs clarification
  return "ambiguous";
}

/**
 * Mathematical Order Pricing Calculator
 * Computes subtotal, coupon discounts, delivery fees, and outside Dhaka advance requirements.
 */
export function calculateOrderPricing(
  params: CalculationParams,
): OrderPricingResult {
  const {
    items,
    deliveryZone,
    coupon,
    freeShippingThreshold,
    rates,
    requireOutsideDhakaAdvance = true,
    outsideDhakaAdvanceAmount = DEFAULT_OUTSIDE_DHAKA_ADVANCE_AMOUNT,
    paymentMethod = "cod",
  } = params;

  // 1. Calculate Subtotal
  let subtotal = 0;
  for (const item of items) {
    const qty = Math.max(0, item.quantity || 0);
    const unitPrice = Math.max(0, item.unitPrice || 0);
    subtotal += unitPrice * qty;
  }
  subtotal = Math.round(subtotal * 100) / 100;

  // 2. Calculate Discount
  let discountAmount = 0;
  if (coupon && coupon.value > 0) {
    if (coupon.type === "percentage") {
      const percentage = Math.min(100, Math.max(0, coupon.value));
      discountAmount = (subtotal * percentage) / 100;
    } else if (coupon.type === "fixed") {
      discountAmount = Math.min(coupon.value, subtotal);
    }
  }
  discountAmount = Math.min(subtotal, Math.max(0, discountAmount));
  discountAmount = Math.round(discountAmount * 100) / 100;

  // 3. Calculate Delivery Fee
  const effectiveRates: DeliveryRatesConfig = {
    insideDhaka: rates?.insideDhaka ?? DEFAULT_DELIVERY_FEES.INSIDE_DHAKA,
    subDhaka: rates?.subDhaka ?? DEFAULT_DELIVERY_FEES.SUB_DHAKA,
    outsideDhaka: rates?.outsideDhaka ?? DEFAULT_DELIVERY_FEES.OUTSIDE_DHAKA,
  };

  const isFreeDelivery =
    freeShippingThreshold !== undefined &&
    freeShippingThreshold > 0 &&
    subtotal >= freeShippingThreshold;

  let deliveryFee = 0;
  if (!isFreeDelivery) {
    switch (deliveryZone) {
      case "inside_dhaka":
        deliveryFee = effectiveRates.insideDhaka;
        break;
      case "sub_dhaka":
        deliveryFee = effectiveRates.subDhaka;
        break;
      case "outside_dhaka":
        deliveryFee = effectiveRates.outsideDhaka;
        break;
      case "ambiguous":
      default:
        // Ambiguous zone does not assess delivery until resolved
        deliveryFee = 0;
        break;
    }
  }

  // 4. Calculate Grand Total
  const grandTotal = Math.max(0, subtotal - discountAmount + deliveryFee);

  // 5. Outside Dhaka Advance Guard (Fraud/RTO loss prevention)
  // Required only for Cash on Delivery orders outside Dhaka when merchant policy enabled
  const isOutsideDhaka = deliveryZone === "outside_dhaka";
  const isCod = paymentMethod.toLowerCase() === "cod";
  const advanceRequired = requireOutsideDhakaAdvance && isOutsideDhaka && isCod;

  const advanceAmount = advanceRequired ? outsideDhakaAdvanceAmount : 0;
  const codDueAmount = Math.max(0, grandTotal - advanceAmount);

  return {
    subtotal,
    discountAmount,
    deliveryFee,
    grandTotal,
    advanceRequired,
    advanceAmount,
    codDueAmount,
    isFreeDelivery,
    zone: deliveryZone,
  };
}

/**
 * Returns formatted zone display name according to customer language
 */
export function formatZoneName(
  zone: DeliveryZone,
  language: SupportedLanguage = "banglish",
): string {
  switch (zone) {
    case "inside_dhaka":
      if (language === "bangla") return "ঢাকার ভেতরে";
      if (language === "english") return "Inside Dhaka";
      return "Inside Dhaka";

    case "sub_dhaka":
      if (language === "bangla") return "ঢাকা উপশহর (সাভার/গাজীপুর/নারায়ণগঞ্জ)";
      if (language === "english")
        return "Dhaka Suburbs (Savar/Gazipur/Narayanganj)";
      return "Dhaka Suburbs (Savar/Gazipur/Narayanganj)";

    case "outside_dhaka":
      if (language === "bangla") return "ঢাকার বাইরে (সমগ্র বাংলাদেশ)";
      if (language === "english") return "Outside Dhaka (All Bangladesh)";
      return "Outside Dhaka";

    case "ambiguous":
    default:
      if (language === "bangla") return "অনির্দিষ্ট এলাকা";
      if (language === "english") return "Unspecified Area";
      return "Unspecified Area";
  }
}

/**
 * Generates culturally appropriate outside Dhaka advance payment prompt
 */
export function getAdvancePaymentPrompt(
  amount: number = DEFAULT_OUTSIDE_DHAKA_ADVANCE_AMOUNT,
  language: SupportedLanguage = "banglish",
): string {
  switch (language) {
    case "bangla": {
      const bnAmount = convertEnglishDigitsToBengali(amount);
      return `ঢাকার বাইরে ডেলিভারির জন্য কুরিয়ার চার্জ ৳${bnAmount} (${amount}) টাকা অগ্রিম বিকাশ অথবা নগদে পরিশোধ করতে হবে। অবশিষ্ট টাকা পণ্য হাতে পেয়ে ক্যাশ অন ডেলিভারিতে প্রদান করবেন।`;
    }

    case "english":
      return `For delivery outside Dhaka, a courier advance payment of ৳${amount} is required via bKash or Nagad to confirm your order. The remaining balance will be payable via Cash on Delivery.`;

    case "banglish":
    case "mixed":
    default:
      return `Bhaiya, Dhakar baire delivery er jonno courier charge ৳${amount} taka advance bKash ba Nagad e payment korte hobe. Baki taka delivery pawar por Cash on Delivery te dite parben.`;
  }
}

/**
 * Evaluates whether advance payment is strictly needed
 */
export function isAdvanceRequired(
  zone: DeliveryZone,
  paymentMethod = "cod",
  policyEnabled = true,
): boolean {
  return (
    policyEnabled &&
    zone === "outside_dhaka" &&
    paymentMethod.toLowerCase() === "cod"
  );
}
