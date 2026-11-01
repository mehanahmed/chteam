/**
 * WhatsApp Client Name & Dynamic Honorific Intelligence Detector
 *
 * Lightweight name extraction & sanitization.
 * Gender deduction and honorific selection ("bhaiya/sir" or "apu/ma'am")
 * are handled dynamically by Gemini AI from WhatsApp context, profile name,
 * and conversational evidence without static hardcoded name dictionaries.
 */

export interface ClientHonorificProfile {
  rawName: string | null;
  detectedFirstName: string | null;
  gender: "male" | "female" | "neutral";
  banglaHonorific: "ভাইয়া" | "আপু";
  banglishHonorific: "bhaiya" | "apu";
  englishHonorific: "sir" | "ma'am";
  salutationBangla: string;
  salutationBanglish: string;
  salutationEnglish: string;
}

/**
 * Clean and normalize raw WhatsApp sender or profile name:
 * Strips phone numbers, emojis, corporate roles (CEO, Admin, Co-founder), and company suffixes.
 */
export function cleanRawClientName(
  rawName: string | null | undefined,
): string | null {
  if (!rawName) return null;

  // 1. Remove emojis and non-alphanumeric noise (keep Latin, Bengali script, spaces)
  let cleaned = rawName
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
      "",
    )
    .trim();

  // 2. Reject pure phone numbers or JIDs (e.g. "8801947554040", "+880 1711...")
  if (/^[\d\s+\-().]+$/.test(cleaned) || cleaned.length < 2) {
    return null;
  }

  // 3. Remove professional role prefixes/suffixes like "CEO", "Co-founder", "Founder", "Admin", "Manager", "Ltd", "Inc"
  const corporateTitlesRegex =
    /\b(?:ceo|co-founder|founder|managing director|md|director|manager|admin|official|team|ltd|limited|inc|corp|technologies|solutions|soft|software)\b/gi;
  cleaned = cleaned.replace(corporateTitlesRegex, "").trim();

  // 4. Remove leading/trailing non-letters
  cleaned = cleaned.replace(/^[^a-zA-Z\u0980-\u09FF]+/, "").replace(/[^a-zA-Z\u0980-\u09FF]+$/, "").trim();

  if (!cleaned || cleaned.length < 2) {
    return null;
  }

  return cleaned;
}

function toTitleCase(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Extracts client name and provides respectful baseline salutations.
 * Full context-aware gender detection ("bhaiya/sir" or "apu/ma'am") is performed
 * dynamically by Gemini AI via system prompts without hardcoded dictionaries.
 */
export function detectClientHonorific(
  clientName?: string | null,
): ClientHonorificProfile {
  const clean = cleanRawClientName(clientName);

  if (!clean) {
    return {
      rawName: null,
      detectedFirstName: null,
      gender: "neutral",
      banglaHonorific: "ভাইয়া",
      banglishHonorific: "bhaiya",
      englishHonorific: "sir",
      salutationBangla: "ভাইয়া",
      salutationBanglish: "bhaiya",
      salutationEnglish: "Sir",
    };
  }

  const tokens = clean
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const skipPrefixes = new Set([
    "mr",
    "md",
    "mohd",
    "dr",
    "engr",
    "adv",
    "mrs",
    "ms",
    "miss",
    "মিঃ",
    "মোঃ",
    "ডঃ",
  ]);

  let firstNameToken = tokens[0];
  for (const t of tokens) {
    if (!skipPrefixes.has(t.toLowerCase().replace(/\./g, ""))) {
      firstNameToken = t;
      break;
    }
  }

  const detectedFirstName = toTitleCase(firstNameToken);

  return {
    rawName: clean,
    detectedFirstName,
    gender: "neutral",
    banglaHonorific: "ভাইয়া",
    banglishHonorific: "bhaiya",
    englishHonorific: "sir",
    salutationBangla: `${detectedFirstName} ভাইয়া`,
    salutationBanglish: `${detectedFirstName} bhaiya`,
    salutationEnglish: `${detectedFirstName} sir`,
  };
}
