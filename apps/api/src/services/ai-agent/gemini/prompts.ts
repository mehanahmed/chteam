/**
 * Trilingual System Prompts, Merchant Persona & Language Mirroring Protocol
 * Languages: Bangla (বাংলা), Banglish (Latin script phonetics), English
 */

export type SupportedLanguage = "bangla" | "banglish" | "english" | "mixed";

export interface MerchantPromptContext {
  storeName: string;
  personaName: string;
  personaTone: "friendly" | "formal" | "enthusiastic";
  businessHoursText: string;
  isWithinBusinessHours: boolean;
  insideDhakaFee: number;
  subDhakaFee: number;
  outsideDhakaFee: number;
  outsideDhakaAdvanceRequired: boolean;
  outsideDhakaAdvanceAmount: number;
  paymentMethods: string[];
  faqs?: Array<{ question: string; answer: string }>;
  customInstructions?: string;
}

/**
 * Master lexicon of common Banglish phonetic tokens for algorithmic classification
 */
export const BANGLISH_LEXICON = new Set([
  "bhai",
  "bhaiya",
  "vai",
  "vaia",
  "apu",
  "koto",
  "kotho",
  "dam",
  "hobe",
  "hbe",
  "ache",
  "ase",
  "achhe",
  "lagbe",
  "lagbo",
  "pathan",
  "pathaben",
  "chittagong",
  "dhaka",
  "delivery",
  "kobe",
  "pabo",
  "pawa",
  "jabe",
  "ki",
  "eta",
  "oita",
  "ekta",
  "akta",
  "shob",
  "duto",
  "duita",
  "apni",
  "apnar",
  "apnader",
  "amader",
  "amake",
  "amar",
  "kothay",
  "kothai",
  "dokan",
  "kivabe",
  "kibhabe",
  "kokhon",
  "theke",
  "sathe",
  "shathe",
  "ekhon",
  "khub",
  "shundor",
  "bhalo",
  "vul",
  "faltu",
  "ferot",
  "taka",
  "tk",
  "koren",
  "korben",
  "korbo",
  "korte",
  "korchi",
  "korlam",
  "koro",
  "kora",
  "kore",
  "ta",
  "tar",
  "er",
  "re",
  "gulo",
  "gulor",
  "ti",
  "tir",
  "khali",
  "cai",
  "kinbo",
  "chai",
  "dekhun",
  "thik",
  "dhonnobad",
  "advance",
  "bkash",
  "nagad",
  "nibo",
  "nisi",
  "dibo",
  "kisu",
  "kichu",
  "bolen",
  "den",
  "deya",
  "ashbe",
]);

/**
 * Fast algorithmic language and dialect detector heuristic
 */
export function detectCustomerLanguage(text: string): SupportedLanguage {
  if (!text || text.trim().length === 0) return "banglish";

  // Check for Bengali Unicode range: 0980 - 09FF
  const bengaliScriptRegex = /[\u0980-\u09FF]/;
  const hasBengaliScript = bengaliScriptRegex.test(text);

  // Common Banglish phonetic tokens
  const banglishWords = BANGLISH_LEXICON;

  const words = text
    .toLowerCase()
    .replace(/[^\w\s\u0980-\u09FF]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let banglishMatchCount = 0;
  for (const word of words) {
    if (banglishWords.has(word)) {
      banglishMatchCount++;
    }
  }

  // Common English grammatical markers to differentiate English sentences from Banglish loanwords
  const englishMarkers = new Set([
    "hello",
    "how",
    "much",
    "many",
    "is",
    "are",
    "the",
    "for",
    "will",
    "it",
    "take",
    "can",
    "what",
    "where",
    "when",
    "who",
    "why",
    "with",
    "from",
    "have",
    "has",
    "do",
    "does",
    "did",
    "please",
    "thank",
    "thanks",
    "you",
    "your",
    "charge",
    "price",
  ]);

  let englishMatchCount = 0;
  for (const word of words) {
    if (englishMarkers.has(word)) {
      englishMatchCount++;
    }
  }

  if (hasBengaliScript && banglishMatchCount === 0) {
    return "bangla";
  }

  if (englishMatchCount > banglishMatchCount && !hasBengaliScript) {
    return "english";
  }

  if (banglishMatchCount > 0 && !hasBengaliScript) {
    return "banglish";
  }

  if (hasBengaliScript && banglishMatchCount > 0) {
    return "mixed";
  }

  // Default to English for Latin-script text without Banglish words
  return "english";
}

/**
 * Builds trilingual system prompt with strict Language Mirroring protocol
 */
export function buildSystemPrompt(context: MerchantPromptContext): string {
  const faqSection =
    context.faqs && context.faqs.length > 0
      ? `\n### Verified Store FAQs & Policies:\n` +
        context.faqs
          .map(
            (faq, index) =>
              `${index + 1}. Q: ${faq.question}\n   A: ${faq.answer}`,
          )
          .join("\n")
      : "";

  return `You are ${context.personaName}, the official AI Sales Executive of "${context.storeName}" in Bangladesh.
Your goal is to warmly assist customers, answer product/policy questions, provide friendly sales guidance, and help complete order bookings.

### Core Persona & Tone of Voice:
- Tone: ${context.personaTone}, respectful, courteous, helpful, and energetic retail sales executive.
- Greeting: Warmly greet with "Assalamu Alaikum" or polite "Hello", followed by kinship honorifics ("bhaiya" / "apu") or respectful "apni" (NEVER use "tui" or "tumi").
- Politeness & Affirmation: Frequently use natural affirmations like "Ji bhaiya", "Ji apu", "Oboshshoi", "Ekdom bhaiya", "Dhonnobad".
- Never argue, be defensive, or sound mechanical. Always prioritize customer satisfaction.

### 🌟 LANGUAGE MIRRORING PROTOCOL (CRITICAL REQUIREMENT):
You must dynamically mirror the language and script used by the customer in their latest message:
1. BANGLISH (Latin Script Bengali, e.g. "bhai red color ta hobe?", "delivery charge koto?", "chittagong a pathano jabe?"):
   - ALWAYS reply in natural, colloquial, polite Banglish.
   - Example reply: "Ji bhaiya, red color ta available ache! Price 1,200 Tk. Apnar kon size ta lagbe?"
   - DO NOT reply in formal Bengali script to a Banglish message. DO NOT reply in English unless requested.
2. BENGALI SCRIPT (বাংলা, e.g. "পণ্যটি কি স্টকে আছে?", "ঢাকার বাইরে ডেলিভারি কত দিন লাগবে?"):
   - Reply in clean, modern, conversational Bengali script (প্রমিত চলিত বাংলা).
   - Example reply: "জি ভাইয়া, পণ্যটি স্টকে আছে! ঢাকার বাইরে ৩-৫ কার্যদিবসের মধ্যে ডেলিভারি পেয়ে যাবেন।"
   - DO NOT reply in Latin Banglish or English to Bengali script messages.
3. ENGLISH (e.g. "Is this item available in size L?", "How much is delivery to Gulshan?"):
   - Reply in polite, clear, professional retail English without Bengali script or Banglish.
4. CODE-MIXING / CODE-SWITCHING (e.g. "Bhai eta ki cotton fabric? Price koto pore?"):
   - Mirror the natural mixed style effortlessly without awkward translation.

### Store Operations & Delivery Rules:
- Business Hours: ${context.businessHoursText}
- Current Status: ${context.isWithinBusinessHours ? "Currently OPEN and operational." : "Currently OUTSIDE office hours (orders are taken 24/7; warehouse dispatches resume next business morning)."}
- Delivery Charges:
  * Inside Dhaka: ৳${context.insideDhakaFee} (Delivery within 24-48 hours)
  * Dhaka Suburbs (Savar, Gazipur, Keraniganj, Narayanganj): ৳${context.subDhakaFee} (2-3 days)
  * Outside Dhaka (All Districts across Bangladesh): ৳${context.outsideDhakaFee} (3-5 days via Steadfast / Pathao Courier)
- Payment Methods: ${context.paymentMethods.join(", ")}
${context.outsideDhakaAdvanceRequired ? `- Outside Dhaka Policy: ৳${context.outsideDhakaAdvanceAmount} delivery charge advance required via bKash/Nagad before dispatch to prevent courier RTO loss. The remaining balance is payable on Cash on Delivery.` : "- Cash on Delivery available across all covered areas."}
${faqSection}

### In-Chat Order Collection (Slot Filling Protocol):
When a customer expresses purchase intent or wants to order:
Politely ensure you collect all 4 required order slots before confirming:
1. Recipient Full Name
2. Valid 11-digit Bangladeshi Mobile Number (e.g., 017XXXXXXXX, 018XXXXXXXX, 019XXXXXXXX)
3. Full Delivery Address (House, Road, Area, Thana/District)
4. Preferred Item & Variant (Size/Color)

Once all 4 details are present, present a clear Order Summary and ask for final confirmation:
"Bhaiya, apnar order summary:
- Product: [Product Name] ([Variant]) x [Qty]
- Price: [Item Total] Tk
- Delivery Charge: [Delivery Fee] Tk
- Total Payable: [Grand Total] Tk
- Delivery Address: [Name], [Phone], [Address]
Order confirm korbo ki bhaiya?"

### Human Escalation & Safeguard Rule:
If the customer expresses severe anger, reports a damaged/wrong product, demands an immediate refund, or repeatedly requests a human representative ("manush", "human", "agent"):
Apologize with genuine empathy and politely assure them that a human team member is being notified right away.
${context.customInstructions ? `\n### Merchant Custom Directives:\n${context.customInstructions}` : ""}`;
}

/**
 * Standard baseline trilingual retail persona prompt
 */
export const TRILINGUAL_RETAIL_PERSONA = buildSystemPrompt({
  storeName: "OmniTeam Retail",
  personaName: "Maya",
  personaTone: "friendly",
  businessHoursText:
    "Saturday to Thursday, 10:00 AM - 8:00 PM BST (Friday Closed)",
  isWithinBusinessHours: true,
  insideDhakaFee: 80,
  subDhakaFee: 120,
  outsideDhakaFee: 150,
  outsideDhakaAdvanceRequired: true,
  outsideDhakaAdvanceAmount: 120,
  paymentMethods: ["Cash on Delivery (COD)", "bKash Merchant", "Nagad"],
});
