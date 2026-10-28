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
  buildSystemPrompt,
  detectCustomerLanguage,
} from "../services/ai-agent/gemini/prompts.js";
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
    const { message, history } = c.req.valid("json");

    const promptContext = await merchantKnowledgeService.buildPromptContext(
      companyId,
      connectionId,
    );
    const detectedLang = detectCustomerLanguage(message);
    const systemInstruction = buildSystemPrompt(promptContext);

    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const sampleReply =
        detectedLang === "bangla"
          ? `জি ভাইয়া, আমাদের ${promptContext.storeName} এ আপনাকে স্বাগতম! আপনার মেসেজটি পেয়েছি। ঢাকার মধ্যে ডেলিভারি চার্জ ৳${promptContext.insideDhakaFee} এবং ঢাকার বাইরে ৳${promptContext.outsideDhakaFee}। ${promptContext.customInstructions ? `(বিশেষ নির্দেশিকা কার্যকর: ${promptContext.customInstructions})` : ""}`
          : detectedLang === "english"
            ? `Hello! Welcome to ${promptContext.storeName}. Delivery fee is ৳${promptContext.insideDhakaFee} inside Dhaka and ৳${promptContext.outsideDhakaFee} outside Dhaka. How can I help you today?`
            : `Ji bhaiya! ${promptContext.storeName} e apnake shagotom. Delivery charge Dhaka-te ৳${promptContext.insideDhakaFee} and outside Dhaka ৳${promptContext.outsideDhakaFee}. Apnar kon product ta lagbe bolun?`;

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
          env.GEMINI_PRIMARY_MODEL || process.env.GEMINI_PRIMARY_MODEL,
        fallbackModel:
          env.GEMINI_FALLBACK_MODEL || process.env.GEMINI_FALLBACK_MODEL,
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
