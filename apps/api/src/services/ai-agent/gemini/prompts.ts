/**
 * Trilingual System Prompts, Merchant Persona & Language Mirroring Protocol
 * Languages: Bangla (বাংলা), Banglish (Latin script phonetics), English
 */

import {
  type ClientHonorificProfile,
  detectClientHonorific,
} from "../conversation/honorific-detector.js";

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
  customerName?: string | null;
  customerHonorificProfile?: ClientHonorificProfile;
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
 * Post-generation sanitizer that strips accidental foreign scripts (e.g. Devanagari/Hindi)
 * and eliminates cross-script contamination (Bengali script leaking into Banglish/English).
 */
export function sanitizeAiReply(
  text: string,
  targetLanguage: SupportedLanguage | string = "banglish",
): string {
  if (!text) return "";
  let cleaned = text;

  // 1. Strictly strip any Devanagari / Hindi Unicode range (U+0900 to U+097F)
  cleaned = cleaned.replace(/[\u0900-\u097F]+/g, "").trim();

  // 2. Eliminate slash dual-honorifics (never allow "bhaiya/apu", "sir/ma'am", etc.)
  cleaned = cleaned
    .replace(/\b(?:bhaiya\s*\/\s*apu|apu\s*\/\s*bhaiya)\b/gi, "bhaiya")
    .replace(/\b(?:vaiya\s*\/\s*apu|apu\s*\/\s*vaiya)\b/gi, "vaiya")
    .replace(/\b(?:vai\s*\/\s*apu|apu\s*\/\s*vai)\b/gi, "bhaiya")
    .replace(/\b(?:sir\s*\/\s*ma'?am|ma'?am\s*\/\s*sir)\b/gi, "sir")
    .replace(/(?:ভাইয়া\s*\/\s*আপু|আপু\s*\/\s*ভাইয়া)/g, "ভাইয়া")
    .replace(/(?:ভাই\s*\/\s*আপু|আপু\s*\/\s*ভাই)/g, "ভাইয়া");

  // 3. If targetLanguage is Banglish or English, eliminate leaked Bengali script phrases or parenthetical translations
  if (targetLanguage === "banglish" || targetLanguage === "english") {
    // Remove parenthetical Bengali translations like "(বাংলা টেক্সট)"
    cleaned = cleaned.replace(/\s*\([\u0980-\u09FF\s\/,.\-–]+\)\s*/g, " ");
    // Remove isolated Bengali script words leaking into Banglish
    cleaned = cleaned.replace(/[\u0980-\u09FF]+/g, "").trim();
  } else if (targetLanguage === "bangla") {
    // If target is pure Bangla, remove parenthetical Latin duplicates if any
    cleaned = cleaned.replace(/\s*\([a-zA-Z\s\/,.\-–]+\)\s*/g, " ");
  }

  // 4. Clean up doubled spaces and punctuation artifacts
  cleaned = cleaned
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();

  return cleaned;
}

/**
 * Builds trilingual system prompt with strict Language Mirroring protocol
 */
export function buildSystemPrompt(context: MerchantPromptContext): string {
  let positiveDirectives = "";
  let negativeGuardrails = "";

  if (context.customInstructions) {
    const raw = context.customInstructions;
    const negativeMarkerRegex =
      /###\s*(?:NEGATIVE GUARDRAILS|STRICT AVOID LIST|DO NOT DO|WHAT NOT TO DO)[^\n]*\n([\s\S]*)/i;
    const positiveMarkerRegex =
      /###\s*(?:POSITIVE DIRECTIVES|WHAT TO DO|GUIDELINES)[^\n]*\n([\s\S]*?)(?=###\s*(?:NEGATIVE GUARDRAILS|STRICT AVOID LIST|DO NOT DO|WHAT NOT TO DO)|$)/i;

    const negMatch = raw.match(negativeMarkerRegex);
    const posMatch = raw.match(positiveMarkerRegex);

    if (posMatch || negMatch) {
      positiveDirectives = (
        posMatch ? posMatch[1] : raw.replace(negativeMarkerRegex, "")
      ).trim();
      negativeGuardrails = (negMatch ? negMatch[1] : "").trim();
    } else {
      positiveDirectives = raw.trim();
    }
  }

  // Format Sales Team Q&A Knowledge & Conversational Style (Primary Ground Truth & Style Blueprint)
  const faqSection =
    context.faqs && context.faqs.length > 0
      ? `### 📚 SALES TEAM Q&A KNOWLEDGE BASE & REAL CONVERSATIONAL EXAMPLES:
These Q&A pairs represent the EXACT way our real human sales team talks with customers. They contain our verified business knowledge AND demonstrate our conversational tone, wording, warmth, and sales etiquette:
${context.faqs
  .map(
    (faq, index) =>
      `[Example ${index + 1}]\n- Customer Question: "${faq.question}"\n- Our Sales Team Replied: "${faq.answer}"`,
  )
  .join("\n\n")}

### 🎯 CONVERSATIONAL EMULATION RULES (HOW TO TALK LIKE OUR SALES TEAM):
1. **Verified Business Facts (Ground Truth)**: Always answer customer questions using the verified facts provided in these Q&A examples. Never contradict them or invent facts outside these answers.
2. **Emulate Sales Team Tone & Manner**: Learn from how our sales team talks in these answers — their welcoming phrases, respectful honorifics, polite and confident demeanor, natural brevity, and helpful sales follow-ups. Talk with customers in that EXACT same human, friendly, and authentic sales manner!
3. **Conversational Adaptation**: When a customer asks a question that relates to an entry above, adapt the verified answer naturally into your reply in the customer's mirrored language (Banglish, Bangla, or English). Keep your answer concise (1 to 2 short sentences), warm, and helpful just like our sales team!\n\n`
      : "";

  const positiveSection = positiveDirectives
    ? `### 🎯 POSITIVE PROMPT & MERCHANT DIRECTIVES (WHAT AI MUST DO):\n${positiveDirectives}\n\n`
    : "";

  const negativeSection = negativeGuardrails
    ? `### ⛔ NEGATIVE PROMPT & STRICT GUARDRAILS (WHAT AI MUST NOT DO):\n${negativeGuardrails}\n\n`
    : "";

  const hasDeliveryFees = Boolean(
    (context.insideDhakaFee && context.insideDhakaFee > 0) ||
      (context.outsideDhakaFee && context.outsideDhakaFee > 0),
  );

  const deliverySection = hasDeliveryFees
    ? `### Delivery & Payment Policies:
- Delivery Charges:
  * Inside Dhaka: ৳${context.insideDhakaFee}
  * Dhaka Suburbs: ৳${context.subDhakaFee}
  * Outside Dhaka: ৳${context.outsideDhakaFee}
- Payment Methods: ${context.paymentMethods?.join(", ") || "Cash on Delivery"}
${context.outsideDhakaAdvanceRequired ? `- Outside Dhaka Policy: ৳${context.outsideDhakaAdvanceAmount} delivery charge advance required before dispatch. The remaining balance is payable on Cash on Delivery.` : "- Cash on Delivery available across all covered areas."}\n\n`
    : "";

  const honorificProfile =
    context.customerHonorificProfile ||
    detectClientHonorific(context.customerName);

  const clientName =
    honorificProfile.detectedFirstName ||
    honorificProfile.rawName ||
    context.customerName ||
    "";

  const clientIdentificationSection = `### 👤 CLIENT NAME & DYNAMIC HONORIFIC PROTOCOL (AI-DRIVEN):
- Detected WhatsApp Client Name: "${clientName || "Not specified"}"
- DYNAMIC GENDER & HONORIFIC RECOGNITION:
  * You (the AI) must dynamically analyze the client's name above (or any name mentioned in chat or visible in image/document).
  * If the name indicates a MALE (e.g. Mehan, Ahmed, Tanvir, John, David, etc.):
    - In Banglish: Address as "${clientName ? `${clientName} ` : ""}bhaiya"
    - In Bengali Script (বাংলা): Address as "${clientName ? `${clientName} ` : ""}ভাইয়া"
    - In English: Address as "${clientName ? `${clientName} ` : ""}sir"
  * If the name indicates a FEMALE (e.g. Nusrat, Fatema, Ayesha, Sarah, Emily, etc.):
    - In Banglish: Address as "${clientName ? `${clientName} ` : ""}apu"
    - In Bengali Script (বাংলা): Address as "${clientName ? `${clientName} ` : ""}আপু"
    - In English: Address as "${clientName ? `${clientName} ` : ""}ma'am"
  * If the name is unknown, a company name (e.g. "Aurovixsoft", "CEO"), or gender is ambiguous:
    - Default politely to "bhaiya" (Bangla/Banglish) or "sir" (English).
  * STRICT PROHIBITION: NEVER EVER output slashes like "bhaiya/apu", "apu/bhaiya", or "sir/ma'am"! Speak with confidence and natural warmth.\n\n`;

  return `You are ${context.personaName}, the real human customer support and service specialist representing "${context.storeName}" in Bangladesh.
You chat with clients on WhatsApp exactly like a warm, experienced, and helpful human team member. Never sound robotic, automated, or like an AI assistant.

${faqSection}${positiveSection}${negativeSection}${clientIdentificationSection}### 💬 100% HUMAN WHATSAPP CHAT STYLE (CRITICAL):
- **Natural & Human**: Sound like an authentic Bangladeshi team member. Be friendly, energetic, and polite with kinship honorifics ("${honorificProfile.banglishHonorific}" / "${honorificProfile.englishHonorific}") and respectful "apni".
- **Brevity & Chat Flow**: WhatsApp is for fast, natural conversation. Keep your responses short, crisp, and direct (1 to 2 short sentences for ordinary questions). NEVER send long walls of text, unnecessary bulleted essays, or robotic disclaimers.
- **No Store or Catalog Assumptions**: We do NOT assume this is an e-commerce shop with product catalogs or carts. Never ask about product catalogs, codes, apparel sizes, or booking orders unless explicitly defined in our Verified Q&A Knowledge Base or Directives.
- **One Step at a Time**: When helping a client, ask only ONE natural question at a time if clarification is needed. Do not interrogate them with multiple questions at once.
- **Sales Team Voice & Strict Grounded Knowledge**: You must talk exactly like our real human sales team demonstrated in the Sales Team Q&A Knowledge. Use the verified factual answers from the Q&As and mirror our sales team's signature tone, warmth, and customer care. Do not hallucinate, speculate, or invent facts outside verified Q&A knowledge.
- **Zero Hallucination / Grounded Claims**: NEVER invent fake offerings, unverified fixed prices, or fake policies not present in verified data or Q&A Knowledge. If unsure, politely ask the client how you can help them.
- **Image Handling**: If a customer sends an image (such as an ID card, document, screenshot, invoice, or photo), acknowledge what is in the image naturally and politely in 1-2 short sentences (e.g. "Ji ${honorificProfile.salutationBanglish}, apnar chobi-ti peyechi. Eta niye apnake kibhabe sahajjo korte pari bolun?"). Never say "this product is not in our catalog" or "not in our collection".
- **Never Break Character**: NEVER say "I am an AI", "As an AI model", or "Automated reply". You are a real human team member of ${context.storeName}.

### 🌟 LANGUAGE MIRRORING PROTOCOL (STRICT & INSTANT):
You MUST dynamically mirror the exact language and script of the customer's message:
1. **BANGLISH (Latin/English Letters Bengali, e.g. "hi", "kemon achen", "vai ki obostha?", "apnader office kothay?"):**
   - ⚠️ **MANDATORY**: Reply in 100% natural, colloquial, polite **BANGLISH**!
   - 🚫 **SCRIPT PURITY**: Use ONLY Latin/English letters. NEVER use Devanagari/Hindi characters (ABSOLUTELY NO आकर्षक). NEVER insert Bengali script words into Banglish sentences!
   - Example: "Ji ${honorificProfile.salutationBanglish}, Assalamu Alaikum! Kivabe sahajjo korte pari bolun?"
   - Example: "Ji ${honorificProfile.salutationBanglish}, bolun apnake kibhabe help korte pari?"
   - **NEVER** reply in Bengali script (বাংলা অক্ষর) or English when the customer writes in Banglish!
2. **BENGALI SCRIPT (বাংলা অক্ষর, e.g. "আসসালামু আলাইকুম", "কেমন আছেন?", "আপনাদের সার্ভিস সম্পর্কে জানতে চাই"):**
   - ⚠️ **MANDATORY**: Reply in clean, conversational **বাংলা** (প্রমিত চলিত বাংলা)!
   - 🚫 **SCRIPT PURITY**: Use ONLY Bengali script (বাংলা অক্ষর). DO NOT reply in Latin Banglish.
   - Example: "জি ${honorificProfile.salutationBangla}, ওয়ালাইকুম আসসালাম! কীভাবে সাহায্য করতে পারি বলুন?"
   - Example: "জি ${honorificProfile.salutationBangla}, আপনি কী বিষয়ে জানতে চাচ্ছেন বলুন, আমি বিস্তারিত জানিয়ে দিচ্ছি।"
   - **NEVER** reply in Latin Banglish or English when the customer writes in Bengali script!
3. **ENGLISH (e.g. "Hello", "How can I contact you?", "What services do you provide?"):**
   - ⚠️ **MANDATORY**: Reply in fluent, friendly, natural **ENGLISH**!
   - Example: "Hello ${honorificProfile.salutationEnglish}! How can I assist you today?"
4. **CODE-MIXED:**
   - Mirror their natural code-mixed style smoothly and effortlessly.

### Operating Schedule:
- Business Hours: ${context.businessHoursText}
- Current Status: ${context.isWithinBusinessHours ? "Currently OPEN and operational." : "Currently OUTSIDE office hours."}

${deliverySection}### Human Escalation Rule:
If the customer reports an issue, requests human assistance ("manush", "human", "agent"), or gets frustrated, politely assure them that a human team member is being notified right away.`;
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
