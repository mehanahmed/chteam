/**
 * Multimodal Audio & Voice Recognition Service
 *
 * Provides native Gemini multimodal audio ingestion, header validation,
 * verbatim transcription, trilingual language understanding (Bangla, Banglish, English),
 * and language-mirrored conversational sales replies.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { env } from "../../../lib/env.js";
import { createLogger, formatError } from "../../../lib/logger.js";
import {
  downloadMediaFromUrl,
  readMediaObject,
  resolveMediaKeyForCompany,
} from "../../../lib/storage.js";
import type { GeminiClient } from "./gemini.client.js";
import {
  buildSystemPrompt,
  detectCustomerLanguage,
  type MerchantPromptContext,
  type SupportedLanguage,
} from "./prompts.js";

const logger = createLogger("audio-service");

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface AudioInlineData {
  mimeType: string;
  data: string; // Base64 encoded
}

export type AudioIngestionSource =
  | Buffer
  | Uint8Array
  | AudioInlineData
  | { url: string }
  | { mediaUrl: string }
  | string; // URL, S3 URI, or base64 data string

export interface AudioTranscriptionResult {
  transcription: string;
  detectedLanguage: SupportedLanguage;
  intent?: string;
  confidence: number;
}

export interface AudioProcessingResult {
  success: boolean;
  isCorrupted?: boolean;
  error?: string;
  transcription?: string;
  detectedLanguage?: SupportedLanguage;
  replyText: string;
  intent?: string;
}

export interface ProcessAudioOptions {
  companyId: string;
  audioSource: AudioIngestionSource;
  hintMimeType?: string | null;
  customerQuery?: string;
  language?: SupportedLanguage;
  // biome-ignore lint/suspicious/noExplicitAny: optional database parameter
  tenantDb?: any;
  geminiClient?: GeminiClient;
  personaContext?: MerchantPromptContext;
  contactId?: string;
}

export class AudioIngestionError extends Error {
  public readonly isCorrupted: boolean;

  constructor(message: string, isCorrupted = true) {
    super(message);
    this.name = "AudioIngestionError";
    this.isCorrupted = isCorrupted;
  }
}

// ============================================================================
// Stage 0: Audio Ingestion & Header Verification
// ============================================================================

/**
 * Detect audio MIME type from magic bytes in buffer
 */
export function detectAudioMimeTypeFromMagicBytes(
  buffer: Buffer | Uint8Array,
): string | null {
  if (buffer.length < 4) return null;

  // 1. OGG container (OggS): 4F 67 67 53 (Used for WhatsApp Opus voice notes)
  if (
    buffer[0] === 0x4f &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  ) {
    return "audio/ogg";
  }

  // 2. MP3 with ID3v2 tag (ID3): 49 44 33
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return "audio/mp3";
  }

  // 3. AAC with ADTS header: 0xFF followed by 0xF0 (MPEG-4 or MPEG-2 AAC)
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) {
    return "audio/aac";
  }

  // 4. MP3 raw MPEG sync frame: 11 bits set to 1 (0xFF followed by 0xE0 mask)
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return "audio/mp3";
  }

  // 5. WAV container: 'RIFF' .... 'WAVE'
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x41 && // A
    buffer[10] === 0x56 && // V
    buffer[11] === 0x45 // E
  ) {
    return "audio/wav";
  }

  // 6. M4A / MP4 container: 'ftyp' at offset 4
  if (
    buffer.length >= 8 &&
    buffer[4] === 0x66 && // f
    buffer[5] === 0x74 && // t
    buffer[6] === 0x79 && // y
    buffer[7] === 0x70 // p
  ) {
    return "audio/m4a";
  }

  // 7. FLAC container: 'fLaC': 66 4C 61 43
  if (
    buffer[0] === 0x66 &&
    buffer[1] === 0x4c &&
    buffer[2] === 0x61 &&
    buffer[3] === 0x43
  ) {
    return "audio/flac";
  }

  // 8. WebM / Matroska audio: 1A 45 DF A3
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return "audio/webm";
  }

  // 9. AMR container: '#!AMR\n' or '#!AMR-WB\n'
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x23 &&
    buffer[1] === 0x21 &&
    buffer[2] === 0x41 &&
    buffer[3] === 0x4d &&
    buffer[4] === 0x52
  ) {
    return "audio/amr";
  }

  return null;
}

/**
 * Normalizes input MIME type or content-type header to Gemini-compatible audio MIME type
 */
export function normalizeAudioMimeType(mime?: string | null): string {
  if (!mime) return "audio/ogg";
  const clean = mime.split(";")[0].trim().toLowerCase();
  if (clean === "audio/mpeg" || clean === "audio/mp3") return "audio/mp3";
  if (
    clean === "audio/ogg" ||
    clean === "audio/opus" ||
    clean === "application/ogg"
  ) {
    return "audio/ogg";
  }
  if (
    clean === "audio/wav" ||
    clean === "audio/x-wav" ||
    clean === "audio/wave"
  ) {
    return "audio/wav";
  }
  if (
    clean === "audio/m4a" ||
    clean === "audio/x-m4a" ||
    clean === "audio/mp4" ||
    clean === "audio/aac"
  ) {
    return "audio/m4a";
  }
  if (clean === "audio/amr" || clean === "audio/3gpp") return "audio/amr";
  if (clean === "audio/webm") return "audio/webm";
  if (clean === "audio/flac" || clean === "audio/x-flac") return "audio/flac";
  if (clean.startsWith("audio/")) return clean;
  return "audio/ogg";
}

/**
 * Validate that an audio buffer is readable, has recognized headers or hint, and is within size limits
 */
export function validateAudioBuffer(
  buffer: Buffer | Uint8Array,
  hintMimeType?: string | null,
): {
  isValid: boolean;
  mimeType: string;
  errorReason?: string;
} {
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      mimeType: "unknown",
      errorReason: "Audio buffer is empty (0 bytes).",
    };
  }

  if (buffer.length < 4) {
    return {
      isValid: false,
      mimeType: "unknown",
      errorReason: `Audio buffer is too small to be valid header (${buffer.length} bytes).`,
    };
  }

  // Max 25 MB limit for Gemini inline payloads
  if (buffer.length > 25 * 1024 * 1024) {
    return {
      isValid: false,
      mimeType: "unknown",
      errorReason: `Audio buffer exceeds 25MB limit (${(buffer.length / (1024 * 1024)).toFixed(2)} MB).`,
    };
  }

  // Reject obvious non-audio payloads (XML error from S3/MinIO, HTML, JSON, or plain text)
  if (
    buffer[0] === 0x3c || // '<' (e.g. <?xml, <!DOCTYPE, <html>)
    buffer[0] === 0x7b // '{' (e.g. {"error": ...})
  ) {
    return {
      isValid: false,
      mimeType: "unknown",
      errorReason:
        "Corrupted audio payload (received XML/HTML/JSON error payload instead of binary audio stream).",
    };
  }

  // Reject printable ASCII text streams that do not match audio magic bytes
  const headerSlice = Buffer.from(
    buffer.subarray(0, Math.min(buffer.length, 32)),
  ).toString("utf8");
  if (/^[a-zA-Z0-9_\-\s:=!?,.]{8,}$/.test(headerSlice)) {
    return {
      isValid: false,
      mimeType: "unknown",
      errorReason:
        "Corrupted audio buffer (contains plain text characters instead of binary audio header).",
    };
  }

  const magicMime = detectAudioMimeTypeFromMagicBytes(buffer);
  if (magicMime) {
    return { isValid: true, mimeType: magicMime };
  }

  // If magic bytes did not match standard header, check if hint is a recognized audio MIME type
  if (hintMimeType) {
    const normalized = normalizeAudioMimeType(hintMimeType);
    if (
      normalized.startsWith("audio/") ||
      hintMimeType.includes("ogg") ||
      hintMimeType.includes("opus")
    ) {
      return { isValid: true, mimeType: normalized };
    }
  }

  return {
    isValid: false,
    mimeType: "unknown",
    errorReason: "Unrecognized audio format or corrupted byte header.",
  };
}

/**
 * Ingest audio from diverse inputs (S3 URI, HTTP URL, Buffer, or Base64) into Gemini inlineData
 */
export async function ingestAudioToInlineData(
  source: AudioIngestionSource,
  companyId?: string,
  hintMimeType?: string | null,
): Promise<AudioInlineData> {
  // Case 1: Already an AudioInlineData object
  if (
    typeof source === "object" &&
    source !== null &&
    "mimeType" in source &&
    "data" in source &&
    typeof (source as AudioInlineData).data === "string"
  ) {
    const inline = source as AudioInlineData;
    if (!inline.data || inline.data.trim().length === 0) {
      throw new AudioIngestionError(
        "Provided inline audio base64 data is empty.",
      );
    }
    const buffer = Buffer.from(inline.data, "base64");
    const check = validateAudioBuffer(buffer, inline.mimeType || hintMimeType);
    if (!check.isValid) {
      throw new AudioIngestionError(
        check.errorReason || "Corrupted inline audio data.",
      );
    }
    return {
      mimeType: check.mimeType,
      data: inline.data,
    };
  }

  // Case 2: Raw Buffer or Uint8Array
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    const check = validateAudioBuffer(source, hintMimeType);
    if (!check.isValid) {
      throw new AudioIngestionError(
        check.errorReason || "Corrupted audio buffer.",
      );
    }
    return {
      mimeType: check.mimeType,
      data: Buffer.from(source).toString("base64"),
    };
  }

  // Case 3: URL/MediaUrl object or string
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
    throw new AudioIngestionError("Audio source string or URL is empty.");
  }

  // Data URI: data:audio/ogg;base64,...
  if (rawUrl.startsWith("data:")) {
    const match = rawUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new AudioIngestionError("Malformed data URI scheme for audio.");
    }
    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");
    const check = validateAudioBuffer(buffer, mimeType || hintMimeType);
    if (!check.isValid) {
      throw new AudioIngestionError(
        check.errorReason || "Corrupted base64 audio data URI.",
      );
    }
    return {
      mimeType: check.mimeType,
      data: base64Data,
    };
  }

  // Local storage path or file:// URI
  if (
    !rawUrl.startsWith("data:") &&
    !rawUrl.startsWith("http://") &&
    !rawUrl.startsWith("https://") &&
    !rawUrl.startsWith("s3://")
  ) {
    const isFileUri = rawUrl.startsWith("file://");
    const localCandidate = isFileUri ? fileURLToPath(rawUrl) : rawUrl;
    if (existsSync(localCandidate)) {
      try {
        const fileBuffer = await readFile(localCandidate);
        const check = validateAudioBuffer(fileBuffer, hintMimeType);
        if (!check.isValid) {
          throw new AudioIngestionError(
            check.errorReason || "Corrupted local audio file.",
          );
        }
        return {
          mimeType: check.mimeType,
          data: fileBuffer.toString("base64"),
        };
      } catch (err) {
        if (err instanceof AudioIngestionError) throw err;
        throw new AudioIngestionError(
          `Failed to read local audio file: ${formatError(err).message}`,
          false,
        );
      }
    }
  }

  // S3 URI or Storage Key: s3://bucket/media/... or media/... or /media/...
  const cleanStorageKey = rawUrl.replace(/^\/+/, "");
  if (rawUrl.startsWith("s3://") || cleanStorageKey.startsWith("media/")) {
    try {
      let key = cleanStorageKey;
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
      const check = validateAudioBuffer(buffer, hintMimeType);
      if (!check.isValid) {
        throw new AudioIngestionError(
          check.errorReason || "Corrupted S3 audio object.",
        );
      }
      return {
        mimeType: check.mimeType,
        data: buffer.toString("base64"),
      };
    } catch (err) {
      if (err instanceof AudioIngestionError) throw err;
      throw new AudioIngestionError(
        `Failed to read audio object from S3 storage: ${formatError(err).message}`,
        false,
      );
    }
  }

  // HTTP / HTTPS URL
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    // If it's an internal S3/MinIO endpoint, attempt authorized S3 retrieval first
    if (companyId) {
      try {
        const s3Key = resolveMediaKeyForCompany(rawUrl, companyId);
        const buffer = await readMediaObject(s3Key);
        const check = validateAudioBuffer(buffer, hintMimeType);
        if (!check.isValid) {
          throw new AudioIngestionError(
            check.errorReason || "Corrupted S3 audio object.",
          );
        }
        return {
          mimeType: check.mimeType,
          data: buffer.toString("base64"),
        };
      } catch (err) {
        if (err instanceof AudioIngestionError) throw err;
        // Not an internal S3 URL or outside tenant scope; proceed to external download
      }
    }

    try {
      const downloaded = await downloadMediaFromUrl(rawUrl);
      const check = validateAudioBuffer(
        downloaded.data,
        downloaded.mimeType || hintMimeType,
      );
      if (!check.isValid) {
        throw new AudioIngestionError(
          check.errorReason || "Downloaded audio media is corrupt.",
        );
      }
      return {
        mimeType: check.mimeType,
        data: downloaded.data.toString("base64"),
      };
    } catch (err) {
      if (err instanceof AudioIngestionError) throw err;
      throw new AudioIngestionError(
        `Failed to download audio from external URL: ${formatError(err).message}`,
        false,
      );
    }
  }

  // Fallback: Check if raw string is raw base64
  try {
    const buffer = Buffer.from(rawUrl, "base64");
    const check = validateAudioBuffer(buffer, hintMimeType);
    if (check.isValid) {
      return {
        mimeType: check.mimeType,
        data: rawUrl,
      };
    }
  } catch {
    // ignore
  }

  throw new AudioIngestionError(
    `Unsupported audio source or invalid audio format: ${rawUrl.slice(0, 60)}`,
  );
}

// ============================================================================
// Stage 1: Audio Analysis System Prompt & Response Parsing
// ============================================================================

export const AUDIO_ANALYSIS_SYSTEM_PROMPT = `You are a high-precision multimodal speech recognition and conversational sales intelligence engine for an e-commerce retail platform in Bangladesh.

You will receive an audio voice note recorded by a customer on WhatsApp (in Bengali, Banglish, or English).

Your tasks:
1. TRANSCRIBE: Listen to the audio voice note and provide a faithful, verbatim transcription of the spoken words.
   - If spoken in Bengali, transcribe in Bengali script (e.g. "ভাইয়া ডেলিভারি চার্জ কত?").
   - If spoken in Banglish, transcribe in Banglish (e.g. "bhaiya delivery charge koto?").
   - If spoken in English, transcribe in English (e.g. "Hello, how much is the delivery charge?").
   - If the audio is completely silent, inaudible, or contains only noise/static, leave transcription empty ("").

2. LANGUAGE DETECTION: Detect the predominant language used in the voice note: "bangla", "banglish", "english", or "mixed".

3. SALES EXECUTIVE RESPONSE:
   - Act as the store's AI Sales Executive.
   - Answer the customer's question or assist with their order directly, warmly, and politely.
   - Mirror the customer's language and tone (Bangla, Banglish, or English).
   - Follow the store persona, pricing, delivery policies, and FAQs provided in the system context.
   - If the audio is inaudible or silent, provide a polite apology in the expected language asking them to resend or send text.

You MUST respond in valid JSON with this exact structure:
{
  "transcription": "Verbatim transcript of spoken audio",
  "language": "bangla" | "banglish" | "english" | "mixed",
  "intent": "inquiry" | "order" | "complaint" | "greeting" | "inaudible",
  "replyText": "Direct, conversational, polite sales reply to the customer"
}`;

/**
 * Parses Gemini model output into structured AudioProcessingResult fields
 */
export function parseAudioModelResponse(rawText: string): {
  transcription: string;
  detectedLanguage: SupportedLanguage;
  replyText: string;
  intent?: string;
} {
  if (!rawText || rawText.trim().length === 0) {
    return {
      transcription: "",
      detectedLanguage: "banglish",
      replyText: "",
    };
  }

  let jsonToParse = rawText.trim();
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    jsonToParse = codeBlockMatch[1].trim();
  } else {
    const objMatch = rawText.match(/(\{[\s\S]*\})/);
    if (objMatch) {
      jsonToParse = objMatch[1].trim();
    }
  }

  try {
    const parsed = JSON.parse(jsonToParse);
    if (parsed && typeof parsed === "object") {
      const transcription =
        typeof parsed.transcription === "string"
          ? parsed.transcription.trim()
          : "";
      const replyText =
        typeof parsed.replyText === "string" ? parsed.replyText.trim() : "";
      const intent =
        typeof parsed.intent === "string" ? parsed.intent.trim() : undefined;

      let lang: SupportedLanguage = "banglish";
      if (
        parsed.language &&
        ["bangla", "banglish", "english", "mixed"].includes(
          String(parsed.language).toLowerCase(),
        )
      ) {
        lang = String(parsed.language).toLowerCase() as SupportedLanguage;
      } else if (transcription) {
        lang = detectCustomerLanguage(transcription);
      }

      return {
        transcription,
        detectedLanguage: lang,
        replyText,
        intent,
      };
    }
  } catch {
    // Not valid JSON, treated as raw conversational response below
  }

  const lang = detectCustomerLanguage(rawText);
  return {
    transcription: "",
    detectedLanguage: lang,
    replyText: rawText.trim(),
  };
}

// ============================================================================
// Stage 2: Audio Service Implementation
// ============================================================================

export class AudioService {
  /**
   * Transcribes an inbound audio note using Gemini native multimodal speech understanding
   */
  async transcribeAudio(
    audioSource: AudioIngestionSource,
    options?: {
      geminiClient?: GeminiClient;
      companyId?: string;
      hintMimeType?: string | null;
    },
  ): Promise<AudioTranscriptionResult> {
    const inlineData = await ingestAudioToInlineData(
      audioSource,
      options?.companyId,
      options?.hintMimeType,
    );

    if (!options?.geminiClient) {
      throw new Error("Gemini client is required to transcribe audio");
    }

    const response = await options.geminiClient.generateChatResponse({
      messages: [
        {
          role: "user",
          content:
            "Please transcribe this customer audio voice note verbatim. Respond in JSON with keys 'transcription' and 'language'.",
          media: {
            mimeType: inlineData.mimeType,
            base64Data: inlineData.data,
          },
        },
      ],
      systemInstruction: AUDIO_ANALYSIS_SYSTEM_PROMPT,
      temperature: 0.1,
    });

    const parsed = parseAudioModelResponse(response.text);
    const transcription =
      typeof parsed.transcription === "string"
        ? parsed.transcription
        : response.text.trim();
    return {
      transcription,
      detectedLanguage: parsed.detectedLanguage,
      intent: parsed.intent,
      confidence: transcription ? 0.95 : 0.0,
    };
  }

  /**
   * End-to-End Multimodal Audio & Voice Recognition Processing Pipeline
   */
  async processIncomingAudio(
    options: ProcessAudioOptions,
  ): Promise<AudioProcessingResult> {
    const {
      companyId,
      audioSource,
      hintMimeType,
      customerQuery = "",
      geminiClient,
      personaContext,
    } = options;

    let language = options.language || "banglish";

    // 0. Audio Ingestion & Header Verification
    let inlineData: AudioInlineData;
    try {
      inlineData = await ingestAudioToInlineData(
        audioSource,
        companyId,
        hintMimeType,
      );
    } catch (error) {
      const isCorrupted =
        error instanceof AudioIngestionError ? error.isCorrupted : true;
      const errorMsg = formatError(error).message;
      logger.warn({ error: errorMsg, companyId }, "Audio ingestion failed");

      // Courteous apology for unreadable/corrupted audio
      let reply =
        "Dukkhito bhaiya, voice note-ti open kora jachhe na ba format ti supported noy. Doya kore arekbar WhatsApp voice note send korben ki?";
      if (language === "bangla") {
        reply =
          "দুঃখিত ভাইয়া, ভয়েস নোটটি ওপেন করা যাচ্ছে না অথবা ফাইলটির ফরম্যাটটি সাপোর্টেড নয়। অনুগ্রহ করে পুনরায় ভয়েস নোটটি সেন্ড করবেন কি?";
      } else if (language === "english") {
        reply =
          "Sorry, we could not open this voice note or the format is not supported. Could you please resend your voice note?";
      }

      return {
        success: false,
        isCorrupted,
        error: errorMsg,
        replyText: reply,
      };
    }

    if (!geminiClient) {
      logger.warn(
        { companyId },
        "No Gemini client provided for audio processing",
      );
      return {
        success: false,
        error: "GEMINI_NOT_AVAILABLE",
        replyText:
          "Dukkhito bhaiya, ei muhurte voice note process kora jachhe na. Doya kore text message pathaben ki?",
      };
    }

    try {
      const userPrompt = customerQuery
        ? `Customer text caption: "${customerQuery}". Listen to this customer voice note, transcribe it faithfully, and provide an immediate helpful sales executive response.`
        : "Listen to this customer voice note, transcribe it faithfully, and provide an immediate helpful sales executive response.";

      const systemInstruction = personaContext
        ? `${AUDIO_ANALYSIS_SYSTEM_PROMPT}\n\n### Store Persona & Context:\n${buildSystemPrompt(personaContext)}`
        : AUDIO_ANALYSIS_SYSTEM_PROMPT;

      const response = await geminiClient.generateChatResponse({
        messages: [
          {
            role: "user",
            content: userPrompt,
            media: {
              mimeType: inlineData.mimeType,
              base64Data: inlineData.data,
            },
          },
        ],
        systemInstruction,
        temperature: 0.2,
      });

      const parsed = parseAudioModelResponse(response.text);
      if (parsed.detectedLanguage) {
        language = parsed.detectedLanguage;
      }

      // Check if audio was completely inaudible or empty
      if (
        parsed.intent === "inaudible" ||
        !parsed.transcription ||
        parsed.transcription.trim().length === 0
      ) {
        let inaudibleReply =
          "Dukkhito bhaiya, apnar voice note-ti porishkar shona jachhe na. Doya kore arekbar bolben ki, othoba text message pathaben?";
        if (language === "bangla") {
          inaudibleReply =
            "দুঃখিত ভাইয়া, আপনার ভয়েস মেসেজটি পরিষ্কার শোনা যাচ্ছে না। দয়া করে আরেকবার বলবেন কি, অথবা টেক্সট করে পাঠাবেন?";
        } else if (language === "english") {
          inaudibleReply =
            "Sorry, we could not hear your voice note clearly. Could you please speak a bit louder and resend, or send us a text message?";
        }

        return {
          success: true,
          transcription: "",
          detectedLanguage: language,
          replyText: inaudibleReply,
          intent: "inaudible",
        };
      }

      return {
        success: true,
        transcription: parsed.transcription,
        detectedLanguage: language,
        replyText: parsed.replyText || response.text.trim(),
        intent: parsed.intent,
      };
    } catch (err) {
      logger.warn(
        { err: formatError(err), companyId },
        "Gemini audio processing failed; falling back to courteous apology",
      );

      let fallbackReply =
        "Dukkhito bhaiya, voice note ti process korte ektu somoshya hoyeche. Doya kore abar pathaben ki, othoba text message koren?";
      if (language === "bangla") {
        fallbackReply =
          "দুঃখিত ভাইয়া, ভয়েস নোটটি প্রসেস করতে কিছুটা সমস্যা হয়েছে। দয়া করে পুনরায় পাঠাবেন কি, অথবা টেক্সট মেসেজ করুন।";
      } else if (language === "english") {
        fallbackReply =
          "Sorry, we had trouble processing your voice note. Could you please resend it or send a text message?";
      }

      return {
        success: false,
        error: formatError(err).message,
        replyText: fallbackReply,
      };
    }
  }
}

export const audioService = new AudioService();
