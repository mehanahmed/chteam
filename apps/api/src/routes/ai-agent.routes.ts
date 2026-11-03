/**
 * AI Agent Routes
 *
 * Provides endpoints for controlling and monitoring the AI assistant:
 * - POST /contacts/:id/pause - Pause AI replies for a contact
 * - POST /contacts/:id/resume - Resume AI replies for a contact
 * - GET /contacts/:id/status - Get current AI status and tags for a contact
 * - GET /connections/overview - Get list of all WhatsApp connections with AI configuration
 * - GET /connections/:connectionId/settings - Get AI settings and custom instructions for a WhatsApp connection
 * - PUT /connections/:connectionId/settings - Save AI settings and custom instructions for a WhatsApp connection
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { notFound } from "../lib/errors.js";
import { successData } from "../lib/response.js";
import { env } from "../lib/env.js";
import { GeminiClient } from "../services/ai-agent/gemini/gemini.client.js";
import {
  DEFAULT_FALLBACK_GEMINI_MODEL,
  DEFAULT_PRIMARY_GEMINI_MODEL,
} from "../services/ai-agent/constants.js";
import {
  buildSystemPrompt,
  detectCustomerLanguage,
} from "../services/ai-agent/gemini/prompts.js";
import { detectClientHonorific } from "../services/ai-agent/conversation/honorific-detector.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { requireContactVisibility } from "../middleware/resource-visibility.js";
import { requirePermission, tenantMiddleware } from "../middleware/tenant.js";
import { handoffService } from "../services/ai-agent/conversation/handoff.service.js";
import { merchantKnowledgeService } from "../services/ai-agent/merchant-knowledge.service.js";
import { PERMISSIONS } from "../services/permission.service.js";

export const aiAgentRoutes = new Hono();

// All AI agent routes require authentication and tenant context
aiAgentRoutes.use("/*", authMiddleware);
aiAgentRoutes.use("/*", tenantMiddleware());

// Visibility checks for contact-specific operations
aiAgentRoutes.use("/contacts/:id/*", requireContactVisibility());
aiAgentRoutes.use("/contacts/:id", requireContactVisibility());

function maskApiKey(key: string | null | undefined): string {
  if (!key || key.trim().length === 0) return "";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

const updateCompanyAiSettingsSchema = z.object({
  isMuted: z.boolean().optional(),
  geminiApiKey: z.string().max(255).optional().nullable(),
  primaryModel: z.string().max(100).optional(),
  fallbackModel: z.string().max(100).optional(),
});

const toggleMuteSchema = z.object({
  isMuted: z.boolean(),
});

const testApiKeySchema = z.object({
  apiKey: z.string().min(10).max(255),
  model: z.string().max(100).optional(),
});

/**
 * GET /settings
 * Retrieve workspace AI settings (mute status, custom API key, models)
 */
aiAgentRoutes.get(
  "/settings",
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    const { companyId } = getRouteContext(c);
    const settings =
      await merchantKnowledgeService.getCompanyAiSettings(companyId);
    const systemHasKey = Boolean(
      env.GEMINI_API_KEY || process.env.GEMINI_API_KEY,
    );

    return successData(c, {
      companyId,
      isMuted: settings.isMuted,
      hasCustomApiKey: Boolean(settings.geminiApiKey?.trim()),
      geminiApiKeyMasked: maskApiKey(settings.geminiApiKey),
      systemHasApiKey: systemHasKey,
      primaryModel: settings.primaryModel,
      fallbackModel: settings.fallbackModel,
      updatedAt: settings.updatedAt?.toISOString() || null,
    });
  },
);

/**
 * PUT /settings
 * Save workspace AI settings (mute status, custom API key, models)
 */
aiAgentRoutes.put(
  "/settings",
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  zValidator("json", updateCompanyAiSettingsSchema),
  async (c) => {
    const { companyId, user } = getRouteContext(c);
    const body = c.req.valid("json");

    let apiKeyToSave: string | null | undefined = undefined;
    if (body.geminiApiKey !== undefined) {
      if (body.geminiApiKey === null || body.geminiApiKey.trim() === "") {
        apiKeyToSave = null;
      } else if (!body.geminiApiKey.includes("...")) {
        apiKeyToSave = body.geminiApiKey.trim();
      }
    }

    const saved = await merchantKnowledgeService.saveCompanyAiSettings(
      companyId,
      {
        isMuted: body.isMuted,
        geminiApiKey: apiKeyToSave,
        primaryModel: body.primaryModel,
        fallbackModel: body.fallbackModel,
      },
      user.id,
    );

    const systemHasKey = Boolean(
      env.GEMINI_API_KEY || process.env.GEMINI_API_KEY,
    );

    return successData(c, {
      companyId,
      isMuted: saved.isMuted,
      hasCustomApiKey: Boolean(saved.geminiApiKey?.trim()),
      geminiApiKeyMasked: maskApiKey(saved.geminiApiKey),
      systemHasApiKey: systemHasKey,
      primaryModel: saved.primaryModel,
      fallbackModel: saved.fallbackModel,
      updatedAt: saved.updatedAt?.toISOString() || null,
    });
  },
);

/**
 * POST /toggle-mute
 * Instantly mute or unmute AI autonomous responses for this workspace
 */
aiAgentRoutes.post(
  "/toggle-mute",
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  zValidator("json", toggleMuteSchema),
  async (c) => {
    const { companyId, user } = getRouteContext(c);
    const { isMuted } = c.req.valid("json");

    const saved = await merchantKnowledgeService.saveCompanyAiSettings(
      companyId,
      { isMuted },
      user.id,
    );

    return successData(c, {
      success: true,
      isMuted: saved.isMuted,
    });
  },
);

/**
 * POST /test-api-key
 * Test and validate a Gemini API key against Google's API before saving
 */
aiAgentRoutes.post(
  "/test-api-key",
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  zValidator("json", testApiKeySchema),
  async (c) => {
    const { apiKey, model } = c.req.valid("json");
    const targetModel = model || DEFAULT_PRIMARY_GEMINI_MODEL;
    const fallbackModel =
      targetModel === DEFAULT_FALLBACK_GEMINI_MODEL
        ? DEFAULT_PRIMARY_GEMINI_MODEL
        : DEFAULT_FALLBACK_GEMINI_MODEL;

    try {
      const client = new GeminiClient({
        apiKey: apiKey.trim(),
        primaryModel: targetModel,
        fallbackModel,
      });

      const res = await client.generateChatResponse({
        messages: [
          { role: "user", content: "Reply with 'OK' if you can read this." },
        ],
        temperature: 0.1,
        maxOutputTokens: 20,
      });

      return successData(c, {
        valid: true,
        message: "Gemini API key is verified and operational!",
        modelUsed: res.modelUsed,
        latencyMs: res.latencyMs,
      });
    } catch (err: any) {
      return successData(c, {
        valid: false,
        error: err.message || "Failed to validate Gemini API key",
      });
    }
  },
);

/**
 * Validation schema for updating per-connection AI instructions and settings
 */
const updateConnectionAiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  personaName: z.string().min(1).max(100).optional(),
  personaTone: z.enum(["friendly", "formal", "enthusiastic"]).optional(),
  storeName: z.string().max(200).optional(),
  customInstructions: z.string().max(10000).optional(),
  insideDhakaFee: z.number().min(0).max(10000).optional(),
  subDhakaFee: z.number().min(0).max(10000).optional(),
  outsideDhakaFee: z.number().min(0).max(10000).optional(),
  outsideDhakaAdvanceRequired: z.boolean().optional(),
  outsideDhakaAdvanceAmount: z.number().min(0).max(10000).optional(),
  faqs: z
    .array(
      z.object({
        question: z.string().min(1).max(500),
        answer: z.string().min(1).max(2000),
      }),
    )
    .optional(),
});

/**
 * GET /connections/overview
 * List all WhatsApp numbers with their AI configuration status
 */
aiAgentRoutes.get(
  "/connections/overview",
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    const { companyId } = getRouteContext(c);
    const overview =
      await merchantKnowledgeService.listAllConnectionSettings(companyId);
    return successData(c, overview);
  },
);

/**
 * GET /connections/:connectionId/settings
 * Retrieve AI instructions and settings for a specific WhatsApp connection
 */
aiAgentRoutes.get(
  "/connections/:connectionId/settings",
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  async (c) => {
    const { tenantDb, companyId } = getRouteContext(c);
    const connectionId = c.req.param("connectionId");
    if (!connectionId) {
      return notFound(c, "WhatsApp connection");
    }

    // Verify WhatsApp connection exists in this tenant
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "name", "phone_number", "jid", "status"])
      .where("id", "=", connectionId)
      .where("archived_at", "is", null)
      .executeTakeFirst();

    if (!connection) {
      return notFound(c, "WhatsApp connection");
    }

    const settings = await merchantKnowledgeService.getConnectionSettings(
      companyId,
      connectionId,
    );

    return successData(c, {
      ...settings,
      connectionName: connection.name,
      phoneNumber: connection.phone_number,
      jid: connection.jid,
      status: connection.status,
    });
  },
);

/**
 * PUT /connections/:connectionId/settings
 * Save AI instructions and settings for a specific WhatsApp connection
 */
aiAgentRoutes.put(
  "/connections/:connectionId/settings",
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  zValidator("json", updateConnectionAiSettingsSchema),
  async (c) => {
    const { tenantDb, companyId } = getRouteContext(c);
    const connectionId = c.req.param("connectionId");
    if (!connectionId) {
      return notFound(c, "WhatsApp connection");
    }
    const body = c.req.valid("json");

    // Verify WhatsApp connection exists in this tenant
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "name", "phone_number", "jid", "status"])
      .where("id", "=", connectionId)
      .where("archived_at", "is", null)
      .executeTakeFirst();

    if (!connection) {
      return notFound(c, "WhatsApp connection");
    }

    const saved = await merchantKnowledgeService.saveConnectionSettings(
      companyId,
      connectionId,
      body,
    );

    return successData(c, {
      ...saved,
      connectionName: connection.name,
      phoneNumber: connection.phone_number,
      jid: connection.jid,
      status: connection.status,
    });
  },
);

/**
 * POST /connections/:connectionId/test-simulate
 * Simulate a customer message and get AI response using this connection's instructions
 */
aiAgentRoutes.post(
  "/connections/:connectionId/test-simulate",
  requirePermission(PERMISSIONS.CAN_MANAGE_CONNECTIONS),
  zValidator(
    "json",
    z.object({
      message: z.string().min(1).max(1000),
      clientName: z.string().optional(),
      history: z
        .array(
          z.object({
            role: z.enum(["user", "model"]),
            content: z.string(),
          }),
        )
        .optional(),
    }),
  ),
  async (c) => {
    const { companyId } = getRouteContext(c);
    const connectionId = c.req.param("connectionId");
    if (!connectionId) {
      return notFound(c, "WhatsApp connection");
    }
    const { message, clientName, history } = c.req.valid("json");

    const promptContext = await merchantKnowledgeService.buildPromptContext(
      companyId,
      connectionId,
    );
    const honorificProfile = detectClientHonorific(clientName);
    promptContext.customerName = honorificProfile.detectedFirstName || clientName;
    promptContext.customerHonorificProfile = honorificProfile;

    const detectedLang = detectCustomerLanguage(message);
    const systemInstruction = buildSystemPrompt(promptContext);

    const companySettings =
      await merchantKnowledgeService.getCompanyAiSettings(companyId);
    const apiKey =
      companySettings.geminiApiKey ||
      env.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const sampleReply =
        detectedLang === "bangla"
          ? `জি ${honorificProfile.salutationBangla}, ${promptContext.storeName}-এ আপনাকে স্বাগতম! কীভাবে সাহায্য করতে পারি বলুন?`
          : detectedLang === "english"
            ? `Hello ${honorificProfile.salutationEnglish}! Welcome to ${promptContext.storeName}. How can I assist you today?`
            : `Ji ${honorificProfile.salutationBanglish}, ${promptContext.storeName}-e apnake shagotom. Apnake kivabe sahajjo korte pari bolun?`;

      return successData(c, {
        replyText: sampleReply,
        detectedLang,
        personaName: promptContext.personaName,
        storeName: promptContext.storeName,
        simulated: true,
      });
    }

    try {
      const geminiClient = new GeminiClient({
        apiKey,
        primaryModel:
          companySettings.primaryModel ||
          env.GEMINI_PRIMARY_MODEL ||
          process.env.GEMINI_PRIMARY_MODEL,
        fallbackModel:
          companySettings.fallbackModel ||
          env.GEMINI_FALLBACK_MODEL ||
          process.env.GEMINI_FALLBACK_MODEL,
      });

      const messages = [
        ...(history || []).map((h) => ({
          role: h.role,
          content: h.content,
        })),
        { role: "user" as const, content: message },
      ];

      const res = await geminiClient.generateChatResponse({
        messages,
        systemInstruction,
        temperature: 0.6,
      });

      return successData(c, {
        replyText: res.text,
        detectedLang,
        personaName: promptContext.personaName,
        storeName: promptContext.storeName,
        modelUsed: res.modelUsed,
        latencyMs: res.latencyMs,
        simulated: false,
      });
    } catch (err: any) {
      return successData(c, {
        replyText: `[Simulator Fallback - API error: ${err.message}] Ji bhaiya, ami ${promptContext.personaName}! Apnar proshner uttor amader policy onushare deya hocche.`,
        detectedLang,
        personaName: promptContext.personaName,
        storeName: promptContext.storeName,
        simulated: true,
      });
    }
  },
);

/**
 * POST /contacts/:id/pause
 * Pause AI autonomous replies for a contact
 */
aiAgentRoutes.post("/contacts/:id/pause", async (c) => {
  const { tenantDb, companyId, user } = getRouteContext(c);
  const contactId = c.req.param("id");

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  let reason = "manual_pause";
  try {
    const body = await c.req.json();
    if (body?.reason) {
      reason = String(body.reason);
    }
  } catch {
    // Empty body is allowed
  }

  const result = await handoffService.pauseAi(
    companyId,
    contactId,
    reason,
    user.id,
    tenantDb,
  );

  return successData(c, {
    success: true,
    isPaused: result.isPaused,
    tags: result.tags,
    reason,
  });
});

/**
 * POST /contacts/:id/resume
 * Resume AI autonomous replies for a contact
 */
aiAgentRoutes.post("/contacts/:id/resume", async (c) => {
  const { tenantDb, companyId, user } = getRouteContext(c);
  const contactId = c.req.param("id");

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  const result = await handoffService.resumeAi(
    companyId,
    contactId,
    user.id,
    tenantDb,
  );

  return successData(c, {
    success: true,
    isPaused: result.isPaused,
    tags: result.tags,
  });
});

/**
 * GET /contacts/:id/status
 * Get current AI status, tags, and suppression reason for a contact
 */
aiAgentRoutes.get("/contacts/:id/status", async (c) => {
  const { tenantDb, companyId } = getRouteContext(c);
  const contactId = c.req.param("id");

  // Verify contact exists
  const contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("id", "=", contactId)
    .executeTakeFirst();

  if (!contact) {
    return notFound(c, "Contact");
  }

  const status = await handoffService.getAiStatus(
    companyId,
    contactId,
    tenantDb,
  );

  return successData(c, status);
});
