/**
 * Unit Test Suite for Multimodal Audio & Voice Recognition Pipeline
 * Location: apps/api/src/services/ai-agent/__tests__/audio.test.ts
 *
 * Covers:
 * 1. Audio Magic Bytes Header Detection & MIME Normalization (OGG/Opus, MP3, WAV, M4A, AAC, FLAC, WebM)
 * 2. Ingestion & Validation (Buffers, Data URIs, InLine Objects, Corrupted Headers, Size Limits)
 * 3. Gemini Audio Model Response Parsing (JSON, Code-fenced JSON, Raw Text Fallback)
 * 4. AudioService Speech Recognition & Trilingual Sales Executive Turn Generation
 * 5. AiOrchestratorService Integration with Audio Attachments & Circuit Breaker Handshake
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AiOrchestratorService } from "../ai-orchestrator.service.js";
import { orderFlowManager } from "../conversation/order-flow.js";
import {
  AudioIngestionError,
  AudioService,
  audioService,
  detectAudioMimeTypeFromMagicBytes,
  ingestAudioToInlineData,
  normalizeAudioMimeType,
  parseAudioModelResponse,
  validateAudioBuffer,
} from "../gemini/audio.service.js";
import { GeminiClient } from "../gemini/gemini.client.js";
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

// Binary audio fixtures for diverse formats
const VALID_OGG_BUFFER = Buffer.from([
  0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00,
]);
const VALID_MP3_ID3_BUFFER = Buffer.from([
  0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const VALID_MP3_SYNC_BUFFER = Buffer.from([
  0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00,
]);
const VALID_WAV_BUFFER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66,
  0x6d, 0x74, 0x20,
]);
const VALID_M4A_BUFFER = Buffer.from([
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
]);
const VALID_AAC_BUFFER = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x00, 0x20]);
const VALID_FLAC_BUFFER = Buffer.from([
  0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22,
]);
const VALID_WEBM_BUFFER = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81,
]);
const VALID_AMR_BUFFER = Buffer.from([0x23, 0x21, 0x41, 0x4d, 0x52, 0x0a]);

describe("Multimodal Audio & Voice Recognition Pipeline", () => {
  let geminiClient: GeminiClient;

  beforeEach(() => {
    harness.reset();
    geminiClient = new GeminiClient({ apiKey: "test-audio-api-key" });
  });

  afterEach(() => {
    harness.reset();
  });

  // ==========================================================================
  // 1. Audio Magic Bytes Header Detection & MIME Normalization
  // ==========================================================================
  describe("1. Audio Header Detection & Normalization", () => {
    test("detects OGG container (OggS) for WhatsApp opus voice notes", () => {
      expect(detectAudioMimeTypeFromMagicBytes(VALID_OGG_BUFFER)).toBe(
        "audio/ogg",
      );
    });

    test("detects MP3 with ID3 tag", () => {
      expect(detectAudioMimeTypeFromMagicBytes(VALID_MP3_ID3_BUFFER)).toBe(
        "audio/mp3",
      );
    });

    test("detects MP3 with MPEG sync frame", () => {
      expect(detectAudioMimeTypeFromMagicBytes(VALID_MP3_SYNC_BUFFER)).toBe(
        "audio/mp3",
      );
    });

    test("detects WAV RIFF WAVE container", () => {
      expect(detectAudioMimeTypeFromMagicBytes(VALID_WAV_BUFFER)).toBe(
        "audio/wav",
      );
    });

    test("detects M4A / MP4 ftyp container", () => {
      expect(detectAudioMimeTypeFromMagicBytes(VALID_M4A_BUFFER)).toBe(
        "audio/m4a",
      );
    });

    test("detects AAC ADTS sync header", () => {
      expect(detectAudioMimeTypeFromMagicBytes(VALID_AAC_BUFFER)).toBe(
        "audio/aac",
      );
    });

    test("detects FLAC header", () => {
      expect(detectAudioMimeTypeFromMagicBytes(VALID_FLAC_BUFFER)).toBe(
        "audio/flac",
      );
    });

    test("detects WebM audio header", () => {
      expect(detectAudioMimeTypeFromMagicBytes(VALID_WEBM_BUFFER)).toBe(
        "audio/webm",
      );
    });

    test("returns null for non-audio or short buffers", () => {
      expect(detectAudioMimeTypeFromMagicBytes(Buffer.from([0x01, 0x02]))).toBe(
        null,
      );
      expect(
        detectAudioMimeTypeFromMagicBytes(
          Buffer.from("RANDOM_NON_AUDIO_BYTES_HERE"),
        ),
      ).toBe(null);
    });

    test("normalizes WhatsApp and audio MIME types correctly", () => {
      expect(normalizeAudioMimeType("audio/ogg; codecs=opus")).toBe(
        "audio/ogg",
      );
      expect(normalizeAudioMimeType("audio/opus")).toBe("audio/ogg");
      expect(normalizeAudioMimeType("application/ogg")).toBe("audio/ogg");
      expect(normalizeAudioMimeType("audio/mpeg")).toBe("audio/mp3");
      expect(normalizeAudioMimeType("audio/mp3")).toBe("audio/mp3");
      expect(normalizeAudioMimeType("audio/x-wav")).toBe("audio/wav");
      expect(normalizeAudioMimeType("audio/x-m4a")).toBe("audio/m4a");
      expect(normalizeAudioMimeType("audio/mp4")).toBe("audio/m4a");
      expect(normalizeAudioMimeType("audio/webm")).toBe("audio/webm");
      expect(normalizeAudioMimeType(undefined)).toBe("audio/ogg");
      expect(normalizeAudioMimeType(null)).toBe("audio/ogg");
    });

    test("validates genuine audio buffers with validateAudioBuffer", () => {
      const check = validateAudioBuffer(VALID_OGG_BUFFER);
      expect(check.isValid).toBe(true);
      expect(check.mimeType).toBe("audio/ogg");
    });

    test("rejects empty (0 byte) audio buffer", () => {
      const check = validateAudioBuffer(Buffer.alloc(0));
      expect(check.isValid).toBe(false);
      expect(check.errorReason).toContain("empty (0 bytes)");
    });

    test("rejects audio buffer smaller than 4 bytes", () => {
      const check = validateAudioBuffer(Buffer.from([0x4f, 0x67]));
      expect(check.isValid).toBe(false);
      expect(check.errorReason).toContain("too small");
    });

    test("rejects buffer exceeding 25MB limit", () => {
      const oversized = { length: 26 * 1024 * 1024 } as unknown as Buffer;
      const check = validateAudioBuffer(oversized);
      expect(check.isValid).toBe(false);
      expect(check.errorReason).toContain("exceeds 25MB limit");
    });

    test("accepts buffer with valid audio hint MIME even when magic bytes are generic", () => {
      const genericAudio = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
      const check = validateAudioBuffer(genericAudio, "audio/ogg; codecs=opus");
      expect(check.isValid).toBe(true);
      expect(check.mimeType).toBe("audio/ogg");
    });

    test("detects AMR container header (#!AMR)", () => {
      expect(detectAudioMimeTypeFromMagicBytes(VALID_AMR_BUFFER)).toBe(
        "audio/amr",
      );
    });

    test("rejects S3 XML error payload even when audio hint is provided", () => {
      const xmlError = Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code></Error>',
      );
      const check = validateAudioBuffer(xmlError, "audio/ogg; codecs=opus");
      expect(check.isValid).toBe(false);
      expect(check.errorReason).toContain("XML/HTML/JSON error payload");
    });

    test("rejects JSON error payload even when audio hint is provided", () => {
      const jsonError = Buffer.from(
        '{"error": {"code": 404, "message": "Object not found"}}',
      );
      const check = validateAudioBuffer(jsonError, "audio/ogg; codecs=opus");
      expect(check.isValid).toBe(false);
      expect(check.errorReason).toContain("XML/HTML/JSON error payload");
    });

    test("rejects plain ASCII text stream even when audio hint is provided", () => {
      const textStream = Buffer.from("NOT_AN_AUDIO_FILE_JUST_PLAIN_TEXT");
      const check = validateAudioBuffer(textStream, "audio/ogg; codecs=opus");
      expect(check.isValid).toBe(false);
      expect(check.errorReason).toContain("plain text characters");
    });
  });

  // ==========================================================================
  // 2. Audio Ingestion Sources
  // ==========================================================================
  describe("2. Audio Ingestion Sources", () => {
    test("ingests local audio file path directly from disk", async () => {
      const tmpPath = path.join(os.tmpdir(), `test-audio-${Date.now()}.ogg`);
      fs.writeFileSync(tmpPath, VALID_OGG_BUFFER);
      try {
        const inline = await ingestAudioToInlineData(tmpPath);
        expect(inline.mimeType).toBe("audio/ogg");
        expect(inline.data).toBe(VALID_OGG_BUFFER.toString("base64"));
      } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      }
    });

    test("ingests raw Buffer successfully", async () => {
      const inline = await ingestAudioToInlineData(VALID_OGG_BUFFER);
      expect(inline.mimeType).toBe("audio/ogg");
      expect(inline.data).toBe(VALID_OGG_BUFFER.toString("base64"));
    });

    test("ingests AudioInlineData object directly", async () => {
      const inline = await ingestAudioToInlineData({
        mimeType: "audio/ogg",
        data: VALID_OGG_BUFFER.toString("base64"),
      });
      expect(inline.mimeType).toBe("audio/ogg");
      expect(inline.data).toBe(VALID_OGG_BUFFER.toString("base64"));
    });

    test("ingests data URI scheme (data:audio/ogg;base64,...)", async () => {
      const dataUri = `data:audio/ogg;base64,${VALID_OGG_BUFFER.toString("base64")}`;
      const inline = await ingestAudioToInlineData(dataUri);
      expect(inline.mimeType).toBe("audio/ogg");
      expect(inline.data).toBe(VALID_OGG_BUFFER.toString("base64"));
    });

    test("throws AudioIngestionError on empty input or invalid data URI", async () => {
      await expect(ingestAudioToInlineData("")).rejects.toThrow(
        AudioIngestionError,
      );
      await expect(
        ingestAudioToInlineData("data:audio/ogg;notbase64,123"),
      ).rejects.toThrow(AudioIngestionError);
    });

    test("throws AudioIngestionError on corrupted non-audio bytes", async () => {
      const corrupt = Buffer.from("NOT_AN_AUDIO_FILE");
      await expect(ingestAudioToInlineData(corrupt)).rejects.toThrow(
        AudioIngestionError,
      );
    });
  });

  // ==========================================================================
  // 3. Audio Model Output Parsing
  // ==========================================================================
  describe("3. Audio Model Output Parsing", () => {
    test("parses structured JSON with transcription and replyText", () => {
      const raw = JSON.stringify({
        transcription: "bhaiya delivery charge koto?",
        language: "banglish",
        intent: "inquiry",
        replyText:
          "Bhaiya, amader delivery charge inside Dhaka 80 Tk, outside Dhaka 150 Tk.",
      });

      const parsed = parseAudioModelResponse(raw);
      expect(parsed.transcription).toBe("bhaiya delivery charge koto?");
      expect(parsed.detectedLanguage).toBe("banglish");
      expect(parsed.intent).toBe("inquiry");
      expect(parsed.replyText).toContain("delivery charge inside Dhaka 80 Tk");
    });

    test("parses markdown code-fenced JSON output", () => {
      const raw = `\`\`\`json
{
  "transcription": "ঢাকার বাইরে ডেলিভারি কত দিন লাগবে?",
  "language": "bangla",
  "intent": "inquiry",
  "replyText": "ঢাকার বাইরে ৩-৫ কার্যদিবসের মধ্যে ডেলিভারি পেয়ে যাবেন।"
}
\`\`\``;

      const parsed = parseAudioModelResponse(raw);
      expect(parsed.transcription).toBe("ঢাকার বাইরে ডেলিভারি কত দিন লাগবে?");
      expect(parsed.detectedLanguage).toBe("bangla");
      expect(parsed.replyText).toContain("৩-৫ কার্যদিবসের মধ্যে");
    });

    test("falls back gracefully when model returns conversational plain text", () => {
      const plainText =
        "Ji bhaiya! Amader delivery charge Dhaka r moddhe 80 taka.";
      const parsed = parseAudioModelResponse(plainText);

      expect(parsed.transcription).toBe("");
      expect(parsed.replyText).toBe(plainText);
      expect(parsed.detectedLanguage).toBe("banglish");
    });

    test("detects customer language from Bengali transcription if language field missing", () => {
      const raw = JSON.stringify({
        transcription: "পণ্যটির দাম কত ভাইয়া?",
        replyText: "জি ভাইয়া, পণ্যটির মূল্য ১২০০ টাকা।",
      });

      const parsed = parseAudioModelResponse(raw);
      expect(parsed.detectedLanguage).toBe("bangla");
    });

    test("parses markdown code-fenced JSON with conversational framing before and after", () => {
      const raw = `Here is what the customer asked in the audio note:
\`\`\`json
{
  "transcription": "bhaiya delivery charge koto?",
  "language": "banglish",
  "intent": "inquiry",
  "replyText": "Inside Dhaka 80 Tk, Outside Dhaka 150 Tk."
}
\`\`\`
Hope this helps!`;

      const parsed = parseAudioModelResponse(raw);
      expect(parsed.transcription).toBe("bhaiya delivery charge koto?");
      expect(parsed.detectedLanguage).toBe("banglish");
      expect(parsed.intent).toBe("inquiry");
      expect(parsed.replyText).toContain(
        "Inside Dhaka 80 Tk, Outside Dhaka 150 Tk.",
      );
    });
  });

  // ==========================================================================
  // 4. AudioService Multimodal Pipeline
  // ==========================================================================
  describe("4. AudioService Speech Recognition & Turn Generation", () => {
    test("processes Banglish voice note and answers customer question", async () => {
      harness.onPattern(
        /voice note/i,
        JSON.stringify({
          transcription: "bhaiya delivery charge koto?",
          language: "banglish",
          intent: "inquiry",
          replyText:
            "Bhaiya, amader delivery charge inside Dhaka 80 Tk, outside Dhaka 150 Tk.",
        }),
      );

      const result = await audioService.processIncomingAudio({
        companyId: "comp-123",
        audioSource: VALID_OGG_BUFFER,
        geminiClient,
      });

      expect(result.success).toBe(true);
      expect(result.transcription).toBe("bhaiya delivery charge koto?");
      expect(result.detectedLanguage).toBe("banglish");
      expect(result.replyText).toContain("delivery charge inside Dhaka 80 Tk");
    });

    test("processes Bengali script voice note and mirrors Bangla reply", async () => {
      harness.onPattern(
        /voice note/i,
        JSON.stringify({
          transcription: "ভাইয়া ডেলিভারি চার্জ কত?",
          language: "bangla",
          intent: "inquiry",
          replyText:
            "জি ভাইয়া, আমাদের ডেলিভারি চার্জ ঢাকার ভেতরে ৮০ টাকা এবং বাইরে ১৫০ টাকা।",
        }),
      );

      const result = await audioService.processIncomingAudio({
        companyId: "comp-123",
        audioSource: VALID_OGG_BUFFER,
        language: "bangla",
        geminiClient,
      });

      expect(result.success).toBe(true);
      expect(result.transcription).toBe("ভাইয়া ডেলিভারি চার্জ কত?");
      expect(result.detectedLanguage).toBe("bangla");
      expect(result.replyText).toContain("ঢাকার ভেতরে ৮০ টাকা");
    });

    test("handles corrupted audio buffer gracefully with courteous apology", async () => {
      const corrupt = Buffer.from("CORRUPT_BUFFER_123");

      const result = await audioService.processIncomingAudio({
        companyId: "comp-123",
        audioSource: corrupt,
        geminiClient,
      });

      expect(result.success).toBe(false);
      expect(result.isCorrupted).toBe(true);
      expect(result.replyText).toContain(
        "voice note-ti open kora jachhe na ba format ti supported noy",
      );
    });

    test("handles inaudible / silent audio with courteous clarification request", async () => {
      harness.onPattern(
        /voice note/i,
        JSON.stringify({
          transcription: "",
          language: "banglish",
          intent: "inaudible",
          replyText: "",
        }),
      );

      const result = await audioService.processIncomingAudio({
        companyId: "comp-123",
        audioSource: VALID_OGG_BUFFER,
        geminiClient,
      });

      expect(result.success).toBe(true);
      expect(result.intent).toBe("inaudible");
      expect(result.replyText).toContain("porishkar shona jachhe na");
    });

    test("handles Gemini API failure gracefully with courteous error fallback", async () => {
      harness.simulateModelFailure(
        "gemini-2.0-flash",
        500,
        "Internal Server Error",
      );
      harness.simulateModelFailure(
        "gemini-1.5-flash",
        500,
        "Internal Server Error",
      );

      const result = await audioService.processIncomingAudio({
        companyId: "comp-123",
        audioSource: VALID_OGG_BUFFER,
        geminiClient,
      });

      expect(result.success).toBe(false);
      expect(result.replyText).toContain(
        "voice note ti process korte ektu somoshya hoyeche",
      );
    });

    test("transcribeAudio method produces verbatim transcript", async () => {
      harness.onPattern(
        /transcribe/i,
        JSON.stringify({
          transcription: "vai red color shirt ache?",
          language: "banglish",
        }),
      );

      const res = await audioService.transcribeAudio(VALID_OGG_BUFFER, {
        geminiClient,
        companyId: "comp-123",
      });

      expect(res.transcription).toBe("vai red color shirt ache?");
      expect(res.detectedLanguage).toBe("banglish");
      expect(res.confidence).toBeGreaterThan(0.9);
    });

    test("transcribeAudio returns empty transcription and 0.0 confidence for inaudible audio without raw JSON leakage", async () => {
      harness.onPattern(
        /transcribe/i,
        JSON.stringify({
          transcription: "",
          language: "banglish",
          intent: "inaudible",
        }),
      );

      const res = await audioService.transcribeAudio(VALID_OGG_BUFFER, {
        geminiClient,
        companyId: "comp-123",
      });

      expect(res.transcription).toBe("");
      expect(res.confidence).toBe(0.0);
      expect(res.intent).toBe("inaudible");
    });
  });

  // ==========================================================================
  // 5. AiOrchestratorService Integration
  // ==========================================================================
  describe("5. AiOrchestratorService Audio Integration", () => {
    function createMockDb(
      onMessageInsert?: (msg: Record<string, unknown>) => void,
    ) {
      // biome-ignore lint/suspicious/noExplicitAny: mock query builder chain
      const createQueryBuilder = (): any => ({
        where: () => createQueryBuilder(),
        select: () => createQueryBuilder(),
        selectAll: () => createQueryBuilder(),
        innerJoin: () => createQueryBuilder(),
        orderBy: () => createQueryBuilder(),
        limit: () => createQueryBuilder(),
        executeTakeFirst: async () => ({
          id: "conn-1",
          jid: "bot@s.whatsapp.net",
          whatsapp_connection_id: "conn-1",
          assigned_to: null,
          ai_disabled: false,
        }),
        execute: async () => [],
      });

      return {
        selectFrom: () => createQueryBuilder(),
        insertInto: (table: string) => ({
          values: (val: Record<string, unknown>) => ({
            execute: async () => {
              if (table === "messages" && onMessageInsert) onMessageInsert(val);
              return [];
            },
          }),
        }),
        transaction: () => ({
          execute: async (callback: (trx: unknown) => Promise<unknown>) => {
            const trx = {
              getExecutor: () => ({
                compileQuery: () => ({ sql: "SELECT 1", parameters: [] }),
                transformQuery: (node: unknown) => node,
                executeQuery: async () => ({ rows: [] }),
              }),
              insertInto: (table: string) => ({
                values: (val: Record<string, unknown>) => ({
                  execute: async () => {
                    if (table === "messages" && onMessageInsert)
                      onMessageInsert(val);
                    return [];
                  },
                }),
              }),
            };
            await callback(trx);
          },
        }),
      };
    }

    test("routes incoming audio WhatsApp message to AudioService and delivers reply", async () => {
      const orchestrator = new AiOrchestratorService();
      let insertedMessage: Record<string, unknown> | null = null;
      const mockDb = createMockDb((val) => {
        insertedMessage = val;
      });

      const mockAudioService = {
        processIncomingAudio: async () => ({
          success: true,
          transcription: "bhaiya delivery charge koto?",
          detectedLanguage: "banglish" as const,
          replyText:
            "Bhaiya, amader delivery charge inside Dhaka 80 Tk, outside Dhaka 150 Tk.",
        }),
      } as unknown as AudioService;

      orchestrator.setMockDb(mockDb);
      orchestrator.setGeminiClient(geminiClient);
      orchestrator.setAudioService(mockAudioService);

      await orchestrator.dispatchInboundMessage({
        companyId: "comp-123",
        connectionId: "conn-1",
        contactId: "contact-456",
        contactJid: "8801700000000@s.whatsapp.net",
        messageId: "msg-audio-1",
        content: "", // Voice notes typically have empty text content
        messageType: "audio",
        mediaUrl: `data:audio/ogg;base64,${VALID_OGG_BUFFER.toString("base64")}`,
        mediaMimeType: "audio/ogg; codecs=opus",
        isGroup: false,
      });

      expect(insertedMessage).not.toBeNull();
      expect(insertedMessage?.content).toContain(
        "delivery charge inside Dhaka 80 Tk",
      );
      expect(insertedMessage?.message_type).toBe("text");
    });

    test("handles voice note with messageType 'voice' or 'ptt'", async () => {
      const orchestrator = new AiOrchestratorService();
      let audioProcessed = false;

      const mockAudioService = {
        processIncomingAudio: async () => {
          audioProcessed = true;
          return {
            success: true,
            transcription: "Hello",
            detectedLanguage: "english" as const,
            replyText: "Hello! How can I assist you today?",
          };
        },
      } as unknown as AudioService;

      orchestrator.setAudioService(mockAudioService);
      orchestrator.setGeminiClient(geminiClient);
      orchestrator.setMockDb(createMockDb());

      await orchestrator.dispatchInboundMessage({
        companyId: "comp-123",
        connectionId: "conn-1",
        contactId: "contact-456",
        contactJid: "8801700000000@s.whatsapp.net",
        messageId: "msg-voice-1",
        content: "",
        messageType: "voice",
        mediaUrl: `data:audio/ogg;base64,${VALID_OGG_BUFFER.toString("base64")}`,
        isGroup: false,
      });

      expect(audioProcessed).toBe(true);
    });

    test("triggers human escalation if spoken voice note contains complaint slang", async () => {
      const orchestrator = new AiOrchestratorService();
      let insertedMessage: Record<string, unknown> | null = null;
      const mockDb = createMockDb((val) => {
        insertedMessage = val;
      });

      // Audio transcription contains severe complaint
      const mockAudioService = {
        processIncomingAudio: async () => ({
          success: true,
          transcription: "faltu service ekdom! taka ferot den ekhoni!",
          detectedLanguage: "banglish" as const,
          replyText: "Dukkhito bhaiya.",
        }),
      } as unknown as AudioService;

      orchestrator.setMockDb(mockDb);
      orchestrator.setGeminiClient(geminiClient);
      orchestrator.setAudioService(mockAudioService);

      await orchestrator.dispatchInboundMessage({
        companyId: "comp-123",
        connectionId: "conn-1",
        contactId: "contact-456",
        contactJid: "8801700000000@s.whatsapp.net",
        messageId: "msg-complaint-audio",
        content: "",
        messageType: "audio",
        mediaUrl: `data:audio/ogg;base64,${VALID_OGG_BUFFER.toString("base64")}`,
        isGroup: false,
      });

      // Escalation was executed, recording handoff message and halting standard reply
      expect(insertedMessage).not.toBeNull();
      expect(insertedMessage?.message_id).toContain("ai_handoff_");
      expect(insertedMessage?.content).toContain("ontorikbhabe dukhito");
    });

    test("seeds customer details (phone, address, name) into orderFlowManager when spoken in voice note", async () => {
      const orchestrator = new AiOrchestratorService();
      orchestrator.setMockDb(createMockDb());
      orchestrator.setGeminiClient(geminiClient);

      const mockAudioService = {
        processIncomingAudio: async () => ({
          success: true,
          transcription:
            "Amar name Rahim, phone 01711223344, Dhanmondi Dhaka. Ekta black shirt lagbe size XL.",
          detectedLanguage: "banglish" as const,
          replyText: "Order details received, thank you Rahim!",
        }),
      } as unknown as AudioService;

      orchestrator.setAudioService(mockAudioService);

      await orchestrator.dispatchInboundMessage({
        companyId: "comp-123",
        connectionId: "conn-1",
        contactId: "contact-order-voice-1",
        contactJid: "8801711223344@s.whatsapp.net",
        messageId: "msg-order-voice",
        content: "",
        messageType: "audio",
        mediaUrl: `data:audio/ogg;base64,${VALID_OGG_BUFFER.toString("base64")}`,
        isGroup: false,
      });

      const session = orderFlowManager.getSession("contact-order-voice-1");
      expect(session).toBeDefined();
      expect(session?.slots.customerName).toBe("Rahim");
      expect(session?.slots.phoneNumber).toBe("01711223344");
    });
  });
});
