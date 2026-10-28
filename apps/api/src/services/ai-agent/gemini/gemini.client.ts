/**
 * Unified Google Gemini GenAI Client with Dual-Model Failover
 * Primary: gemini-2.0-flash
 * Fallback: gemini-1.5-flash
 */

import { type GenerateContentConfig, GoogleGenAI } from "@google/genai";
import { createLogger, formatError } from "../../../lib/logger.js";
import {
  DEFAULT_FALLBACK_GEMINI_MODEL,
  DEFAULT_PRIMARY_GEMINI_MODEL,
} from "../constants.js";

const logger = createLogger("gemini-client");

export interface GeminiClientConfig {
  apiKey: string;
  primaryModel?: string;
  fallbackModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  aiInstance?: any;
}

export type GeminiServiceConfig = GeminiClientConfig;

export interface ChatMessagePart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // Base64 encoded
  };
}

export interface ChatMessage {
  role: "user" | "model" | "system";
  content: string;
  media?: {
    mimeType: string;
    base64Data: string;
  };
}

export type GeminiChatMessage = ChatMessage;

export interface GenerateChatResponseOptions {
  messages: ChatMessage[];
  systemInstruction?: string;
  temperature?: number;
  tools?: unknown[];
  responseMimeType?: string;
  responseSchema?: unknown;
  responseJsonSchema?: unknown;
  forcedModel?: string;
}

export type GeminiGenerateOptions = GenerateChatResponseOptions;

export interface GeminiGenerateResult {
  text: string;
  functionCalls?: Array<{
    id?: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  modelUsed: string;
  isFallback: boolean;
  usage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

export class GeminiServiceError extends Error {
  public readonly modelAttempted: string;
  public readonly statusCode?: number;
  public readonly originalError?: unknown;

  constructor(
    message: string,
    modelAttempted: string,
    options?: { statusCode?: number; originalError?: unknown },
  ) {
    super(message);
    this.name = "GeminiServiceError";
    this.modelAttempted = modelAttempted;
    this.statusCode = options?.statusCode;
    this.originalError = options?.originalError;
  }
}

export class GeminiClient {
  private ai: GoogleGenAI;
  private primaryModel: string;
  private fallbackModel: string;
  private timeoutMs: number;

  constructor(config: GeminiClientConfig) {
    if (!config?.apiKey || config.apiKey.trim().length === 0) {
      throw new Error("Gemini API key is required");
    }
    this.ai = config.aiInstance || new GoogleGenAI({ apiKey: config.apiKey });
    this.primaryModel = config.primaryModel || DEFAULT_PRIMARY_GEMINI_MODEL;
    this.fallbackModel = config.fallbackModel || DEFAULT_FALLBACK_GEMINI_MODEL;
    this.timeoutMs = config.timeoutMs || 15_000;
  }

  public setAiInstance(ai: any): void {
    this.ai = ai;
  }

  /**
   * Transforms internal chat message representations into Google GenAI Content objects
   */
  private formatContents(messages: ChatMessage[]) {
    return messages
      .filter((m) => m.role === "user" || m.role === "model")
      .map((msg) => {
        const parts: ChatMessagePart[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.media) {
          parts.push({
            inlineData: {
              mimeType: msg.media.mimeType,
              data: msg.media.base64Data,
            },
          });
        }
        return {
          role: msg.role as "user" | "model",
          parts,
        };
      });
  }

  /**
   * Generates response with automatic fallback from primary to secondary model
   */
  async generateChatResponse(
    options: GenerateChatResponseOptions,
  ): Promise<GeminiGenerateResult> {
    const startTime = Date.now();
    const contents = this.formatContents(options.messages);

    const config: GenerateContentConfig = {
      temperature: options.temperature ?? 0.6,
      systemInstruction: options.systemInstruction,
    };

    if (options.tools && options.tools.length > 0) {
      config.tools = options.tools as GenerateContentConfig["tools"];
    }

    if (options.responseMimeType) {
      config.responseMimeType = options.responseMimeType;
    }

    const jsonSchema = options.responseJsonSchema || options.responseSchema;
    if (jsonSchema) {
      config.responseJsonSchema = jsonSchema;
    }

    // Determine target model sequence
    const modelSequence = options.forcedModel
      ? [options.forcedModel]
      : [this.primaryModel, this.fallbackModel];

    let lastError: unknown = null;
    let lastModelAttempted = modelSequence[0];

    for (let i = 0; i < modelSequence.length; i++) {
      const currentModel = modelSequence[i];
      const isFallback = i > 0;
      lastModelAttempted = currentModel;

      try {
        logger.debug(
          { model: currentModel, isFallback, messageCount: contents.length },
          "Executing Gemini generateContent",
        );

        // Execute API call with configured timeout
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            const err = Object.assign(
              new Error(
                `Gemini request timed out after ${this.timeoutMs}ms on model ${currentModel}`,
              ),
              { status: 504 },
            );
            reject(err);
          }, this.timeoutMs);
          if (typeof timeoutId.unref === "function") {
            timeoutId.unref();
          }
        });

        const generatePromise = this.ai.models.generateContent({
          model: currentModel,
          contents,
          config,
        });

        let response: Awaited<typeof generatePromise>;
        try {
          response = await Promise.race([generatePromise, timeoutPromise]);
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
        const latencyMs = Date.now() - startTime;

        const text = response.text || "";
        const functionCalls = response.functionCalls?.map((fc) => ({
          id: (fc as { id?: string }).id || `call_${Date.now()}`,
          name: fc.name || "",
          args: (fc.args as Record<string, unknown>) || {},
        }));

        const usage = {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          candidatesTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        };

        logger.info(
          {
            model: currentModel,
            isFallback,
            latencyMs,
            tokens: usage.totalTokens,
          },
          "Gemini response generated successfully",
        );

        return {
          text,
          functionCalls,
          modelUsed: currentModel,
          isFallback,
          usage,
          latencyMs,
        };
      } catch (error: unknown) {
        lastError = error;
        const errorMessage = formatError(error);
        logger.warn(
          {
            model: currentModel,
            isFallback,
            error: errorMessage,
            hasMoreFallbacks: i < modelSequence.length - 1,
          },
          "Gemini model request failed",
        );

        // If another model is available in the sequence, continue to next iteration
        if (i < modelSequence.length - 1) {
          logger.info(
            { fromModel: currentModel, toModel: modelSequence[i + 1] },
            "Switching to fallback model",
          );
          continue;
        }
      }
    }

    const errorStatus =
      typeof lastError === "object" && lastError !== null
        ? (lastError as { status?: number; statusCode?: number }).status ||
          (lastError as { status?: number; statusCode?: number }).statusCode
        : undefined;

    throw new GeminiServiceError(
      `Gemini service unavailable after attempting fallback (${modelSequence.join(" -> ")}). Last error: ${formatError(lastError).message}`,
      lastModelAttempted,
      {
        statusCode: errorStatus,
        originalError: lastError,
      },
    );
  }
}
