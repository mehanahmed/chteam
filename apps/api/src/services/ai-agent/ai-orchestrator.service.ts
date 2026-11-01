/**
 * AI Orchestrator Service - Inbound Hook, Circuit Breaker & Response Dispatcher
 */

import { toDbDate } from "@omniteam/shared";
import { env } from "../../lib/env.js";
import { createLogger, formatError } from "../../lib/logger.js";
import {
  buildCommandSubject,
  buildSendMessageCommand,
  publishTypingCommand,
} from "../../lib/nats/index.js";
import { enqueueCommand } from "../command-outbox.service.js";
import { broadcastToContactViewers } from "../message-broadcast.service.js";
import { getTenantConnection } from "../tenant.service.js";
import { getActiveSessionId } from "../whatsapp/session.js";
import { AI_TAGS, SYSTEM_AI_USER_ID } from "./constants.js";
import {
  HandoffService,
  handoffService,
} from "./conversation/handoff.service.js";
import { detectClientHonorific } from "./conversation/honorific-detector.js";
import { orderFlowManager } from "./conversation/order-flow.js";
import { extractSlotsFromText } from "./conversation/slot-filler.js";
import type { OrderPricingResult } from "./ecommerce/delivery-rules.js";
import type {
  ECommercePlatformAdapter,
  OrderBookingResult,
} from "./ecommerce/ecommerce.interface.js";
import { AudioService, audioService } from "./gemini/audio.service.js";
import { type ChatMessage, GeminiClient } from "./gemini/gemini.client.js";
import { buildSystemPrompt, detectCustomerLanguage, sanitizeAiReply } from "./gemini/prompts.js";
import { VisionService, visionService } from "./gemini/vision.service.js";
import { merchantKnowledgeService } from "./merchant-knowledge.service.js";
import { executeAgentTool, GEMINI_AGENT_TOOLS } from "./tools/agent-tools.js";

const logger = createLogger("ai-orchestrator");

export interface InboundAiMessageContext {
  companyId: string;
  connectionId?: string | null;
  channelAccountId?: string | null;
  contactId: string;
  conversationId?: string | null;
  messageId: string;
  rawMessageId?: string;
  contactJid?: string | null;
  senderJid?: string | null;
  senderName?: string | null;
  content: string;
  messageType?: string;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  isGroup: boolean;
  receivedAt?: Date;
  channel?: string;
  provider?: string;
}

export interface SuppressionDecision {
  isSuppressed: boolean;
  shouldSuppress?: boolean;
  reason?:
    | "ai_disabled"
    | "group_message"
    | "contact_assigned_to_human"
    | "ai_paused_tag_present"
    | "last_message_from_human_agent"
    | "contact_blocked"
    | "empty_content"
    | "db_error_fail_safe"
    | "missing_contact_id"
    | string;
}

export class AiOrchestratorService {
  private geminiClient: GeminiClient | null = null;
  private visionService: VisionService = visionService;
  private audioService: AudioService = audioService;
  private processingContacts: Set<string> = new Set();
  // biome-ignore lint/suspicious/noExplicitAny: mock database for testing
  private mockDb: any = null;
  private ecommerceAdapter: ECommercePlatformAdapter | null = null;
  private handoffService: HandoffService = handoffService;

  public setGeminiClient(client: GeminiClient | null): void {
    this.geminiClient = client;
  }

  public setVisionService(service: VisionService): void {
    this.visionService = service;
  }

  public getVisionService(): VisionService {
    return this.visionService;
  }

  public setAudioService(service: AudioService): void {
    this.audioService = service;
  }

  public getAudioService(): AudioService {
    return this.audioService;
  }

  public setEcommerceAdapter(adapter: ECommercePlatformAdapter | null): void {
    this.ecommerceAdapter = adapter;
  }

  public getEcommerceAdapter(): ECommercePlatformAdapter | null {
    return this.ecommerceAdapter;
  }

  public getOrderFlowManager() {
    return orderFlowManager;
  }

  public setHandoffService(service: HandoffService): void {
    this.handoffService = service;
  }

  public getHandoffService(): HandoffService {
    return this.handoffService;
  }

  // biome-ignore lint/suspicious/noExplicitAny: mock database for testing
  public setMockDb(db: any): void {
    this.mockDb = db;
  }

  private getGeminiClient(): GeminiClient | null {
    if (this.geminiClient) {
      return this.geminiClient;
    }
    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return null;
    }
    this.geminiClient = new GeminiClient({
      apiKey,
      primaryModel:
        env.GEMINI_PRIMARY_MODEL || process.env.GEMINI_PRIMARY_MODEL,
      fallbackModel:
        env.GEMINI_FALLBACK_MODEL || process.env.GEMINI_FALLBACK_MODEL,
    });
    return this.geminiClient;
  }

  /**
   * Broadcasts typing status to both WhatsApp and the web inbox
   */
  async setTypingPresence(
    companyId: string,
    contactId: string,
    targetConnectionId: string | null,
    destinationJid: string | null,
    isTyping: boolean,
    // biome-ignore lint/suspicious/noExplicitAny: optional DB override
    tenantDb?: any,
  ): Promise<void> {
    try {
      if (targetConnectionId && destinationJid) {
        try {
          const resolvedDb =
            tenantDb || this.mockDb || getTenantConnection(companyId);
          const activeSessionId = await getActiveSessionId(
            resolvedDb,
            targetConnectionId,
          );
          if (activeSessionId) {
            await publishTypingCommand(
              companyId,
              activeSessionId,
              destinationJid,
              isTyping,
            ).catch(() => {});
          }
        } catch {
          // WhatsApp typing indicator is best-effort
        }
      }

      await broadcastToContactViewers(
        companyId,
        contactId,
        isTyping ? "typing:start" : "typing:stop",
        {
          conversationId: contactId,
          userId: SYSTEM_AI_USER_ID,
          userName: "Maya (AI)",
        },
      ).catch(() => {});
    } catch (err) {
      logger.debug(
        { err: formatError(err), contactId },
        "Failed to update AI typing presence",
      );
    }
  }

  /**
   * Pre-Reply Interception: Verifies all safety circuit breakers
   */
  async evaluateSuppression(
    companyId: string,
    contactId: string,
    isGroup: boolean,
    content: string | null,
    hasMedia?: boolean,
    connectionId?: string | null,
  ): Promise<SuppressionDecision> {
    // 0. Guard against missing or empty contact ID
    if (!contactId || contactId.trim().length === 0) {
      return {
        isSuppressed: true,
        shouldSuppress: true,
        reason: "missing_contact_id",
      };
    }

    // 1. Never reply in group chats
    if (isGroup) {
      return {
        isSuppressed: true,
        shouldSuppress: true,
        reason: "group_message",
      };
    }

    // 2. Ignore empty content without media
    if ((!content || content.trim().length === 0) && !hasMedia) {
      return {
        isSuppressed: true,
        shouldSuppress: true,
        reason: "empty_content",
      };
    }

    // 3. Check if AI Agent feature is globally disabled
    if (env.AI_AGENT_ENABLED === false) {
      return {
        isSuppressed: true,
        shouldSuppress: true,
        reason: "ai_disabled",
      };
    }

    // 3.5 Check if AI is disabled specifically for this connection
    if (connectionId) {
      try {
        const connSettings =
          await merchantKnowledgeService.getConnectionSettings(
            companyId,
            connectionId,
          );
        if (connSettings && connSettings.enabled === false) {
          return {
            isSuppressed: true,
            shouldSuppress: true,
            reason: "ai_disabled_for_connection",
          };
        }
      } catch {
        // Fall through on lookup error
      }
    }

    try {
      const tenantDb = this.mockDb || getTenantConnection(companyId);

      const isTestEnv =
        process.env.NODE_ENV === "test" ||
        process.env.VITEST === "true" ||
        (typeof Bun !== "undefined" &&
          Bun.argv.some((arg) => arg.includes("test")));
      const allowAutoRespondEveryMessage =
        !isTestEnv && Boolean(env.AI_AGENT_AUTO_RESPOND_EVERY_MESSAGE);

      // 4. Verify contact is not blocked
      const contact = await tenantDb
        .selectFrom("contacts")
        .select(["is_blocked"])
        .where("id", "=", contactId)
        .executeTakeFirst();

      if (contact?.is_blocked) {
        return {
          isSuppressed: true,
          shouldSuppress: true,
          reason: "contact_blocked",
        };
      }

      // 5. Verify no active human assignment (bypassed when allowAutoRespondEveryMessage is enabled)
      if (!allowAutoRespondEveryMessage) {
        const activeAssignment = await tenantDb
          .selectFrom("contact_assignments")
          .select(["assigned_to"])
          .where("contact_id", "=", contactId)
          .where("unassigned_at", "is", null)
          .orderBy("assigned_at", "desc")
          .limit(1)
          .executeTakeFirst();

        if (activeAssignment?.assigned_to) {
          return {
            isSuppressed: true,
            shouldSuppress: true,
            reason: "contact_assigned_to_human",
          };
        }
      }

      // 6. Verify contact does NOT have the 'ai-paused' tag (case-insensitive)
      const contactTags = await tenantDb
        .selectFrom("contact_tags")
        .innerJoin("tags", "tags.id", "contact_tags.tag_id")
        .select("tags.name")
        .where("contact_tags.contact_id", "=", contactId)
        .execute();

      const hasAiPaused = contactTags?.some(
        (t: { name: string }) =>
          t.name.toLowerCase() === AI_TAGS.AI_PAUSED.toLowerCase(),
      );

      if (hasAiPaused) {
        return {
          isSuppressed: true,
          shouldSuppress: true,
          reason: "ai_paused_tag_present",
        };
      }

      // 7. Verify the last outbound message was not sent by a human agent
      // Suppress if sent by user via Web UI or directly from merchant's WhatsApp mobile device
      const lastOutbound = await tenantDb
        .selectFrom("messages")
        .select(["sent_by_user_id", "from_me", "timestamp"])
        .where("contact_id", "=", contactId)
        .where("from_me", "=", true)
        .orderBy("timestamp", "desc")
        .limit(1)
        .executeTakeFirst();

      if (
        lastOutbound &&
        lastOutbound.from_me &&
        lastOutbound.sent_by_user_id !== SYSTEM_AI_USER_ID
      ) {
        if (allowAutoRespondEveryMessage) {
          const msgTime = new Date(lastOutbound.timestamp).getTime();
          const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
          if (msgTime > fiveMinutesAgo) {
            return {
              isSuppressed: true,
              shouldSuppress: true,
              reason: "active_human_intervention_in_progress",
            };
          }
        } else {
          return {
            isSuppressed: true,
            shouldSuppress: true,
            reason: "last_message_from_human_agent",
          };
        }
      }
    } catch (error) {
      logger.warn(
        { err: formatError(error), companyId, contactId },
        "Error evaluating suppression circuit breaker; failing safe",
      );
      return {
        isSuppressed: true,
        shouldSuppress: true,
        reason: "db_error_fail_safe",
      };
    }

    return { isSuppressed: false, shouldSuppress: false };
  }

  /**
   * Main Inbound Message Dispatcher Entry Point
   */
  async dispatchInboundMessage(ctx: InboundAiMessageContext): Promise<void> {
    const {
      companyId,
      contactId,
      isGroup,
      content,
      mediaUrl,
      messageType,
      mediaMimeType,
    } = ctx;

    // Guard against empty or missing contactId before acquiring locks
    if (!contactId || contactId.trim().length === 0) {
      logger.debug(
        { companyId },
        "Inbound AI dispatch skipped: contactId is empty or missing",
      );
      return;
    }

    const isAudioMessage =
      messageType === "audio" ||
      messageType === "voice" ||
      messageType === "ptt" ||
      Boolean(mediaMimeType?.startsWith("audio/")) ||
      Boolean(mediaMimeType?.includes("ogg")) ||
      Boolean(mediaMimeType?.includes("opus")) ||
      Boolean(
        mediaUrl &&
          /\.(ogg|oga|opus|mp3|wav|m4a|aac|flac|webm|amr)(\?.*)?$/i.test(
            mediaUrl,
          ),
      ) ||
      Boolean(mediaUrl?.startsWith("data:audio/"));

    const isImageMessage =
      !isAudioMessage &&
      (messageType === "image" ||
        Boolean(mediaMimeType?.startsWith("image/")) ||
        Boolean(
          mediaUrl &&
            (/\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(mediaUrl) ||
              mediaUrl.startsWith("data:image/")),
        ) ||
        (Boolean(mediaUrl) && !mediaMimeType));

    const hasMedia = Boolean(isImageMessage || isAudioMessage || mediaUrl);

    // Contact-level debounce / lock: avoid processing overlapping events concurrently
    const lockKey = `${companyId}:${contactId}`;
    if (this.processingContacts.has(lockKey)) {
      logger.debug(
        { contactId },
        "Contact is already processing an AI response; skipping concurrent trigger",
      );
      return;
    }

    let targetConnectionId: string | null =
      ctx.connectionId ?? ctx.channelAccountId ?? null;
    let destinationJid: string | null = ctx.contactJid || ctx.senderJid || null;
    // biome-ignore lint/suspicious/noExplicitAny: optional DB override
    let tenantDb: any = null;

    try {
      this.processingContacts.add(lockKey);

      tenantDb = this.mockDb || getTenantConnection(companyId);

      // Resolve targetConnectionId & destinationJid: fallback to contact record if not present on context
      if (!targetConnectionId || !destinationJid) {
        try {
          const contact = await tenantDb
            .selectFrom("contacts")
            .select(["whatsapp_connection_id", "jid"])
            .where("id", "=", contactId)
            .executeTakeFirst();
          if (!targetConnectionId && contact?.whatsapp_connection_id) {
            targetConnectionId = contact.whatsapp_connection_id;
          }
          if (!destinationJid && contact?.jid) {
            destinationJid = contact.jid;
          }
        } catch (err) {
          logger.debug(
            { err: formatError(err), contactId },
            "Could not resolve contact fallback",
          );
        }
      }

      // 1. Evaluate Circuit Breakers
      const suppression = await this.evaluateSuppression(
        companyId,
        contactId,
        isGroup,
        content,
        hasMedia,
        targetConnectionId,
      );

      if (suppression.isSuppressed || suppression.shouldSuppress) {
        logger.debug(
          { contactId, reason: suppression.reason },
          "AI reply suppressed by circuit breaker",
        );
        return;
      }

      // 1.5 Evaluate Complaint Detection, Human Request & Domain Confusion
      const detectedLang = detectCustomerLanguage(content || "");
      let replyContent = "";

      const handoffEval = this.handoffService.evaluateHandoff(content || "", {
        contactId,
        detectedLang,
      });

      if (handoffEval.isDomainConfusionTurn1) {
        replyContent = handoffEval.domainClarificationText || "";
      } else if (handoffEval.shouldHandoff) {
        logger.info(
          {
            contactId,
            reason: handoffEval.reason,
            sentiment: handoffEval.sentiment,
          },
          "Handoff triggered; executing escalation and pausing autonomous replies",
        );

        await this.handoffService.executeEscalation({
          companyId,
          contactId,
          reason: handoffEval.reason || "complaint",
          sentiment: handoffEval.sentiment,
          customerHandoverText: handoffEval.customerHandoverText,
          language: detectedLang,
          connectionId: targetConnectionId,
          contactJid: destinationJid,
          senderName: ctx.senderName,
          providedDb: this.mockDb,
        });

        return; // Halt autonomous replies
      }

      // 2. Ensure Gemini client is available
      const geminiClient = this.getGeminiClient();
      if (!geminiClient) {
        logger.debug(
          { companyId },
          "GEMINI_API_KEY is not configured; AI autonomous responses inactive",
        );
        return;
      }

      const promptContext = await merchantKnowledgeService.buildPromptContext(
        companyId,
        targetConnectionId || undefined,
      );

      // Resolve client name and infer gender honorific profile
      let clientName = ctx.senderName?.trim() || "";
      if (!clientName || clientName === "Unknown" || /^\d+$/.test(clientName)) {
        try {
          const contact = await tenantDb
            .selectFrom("contacts")
            .select(["custom_name", "push_name", "display_name"])
            .where("id", "=", contactId)
            .executeTakeFirst();
          clientName =
            contact?.custom_name?.trim() ||
            contact?.display_name?.trim() ||
            contact?.push_name?.trim() ||
            "";
        } catch {
          // ignore
        }
      }

      const clientHonorificProfile = detectClientHonorific(clientName);
      promptContext.customerName =
        clientHonorificProfile.detectedFirstName || clientName || undefined;
      promptContext.customerHonorificProfile = clientHonorificProfile;

      // 1.8 Business Hours & Off-Hours Auto-Acknowledgement (only when 24/7 mode is explicitly disabled)
      if (env.AI_AGENT_24X7 === false && ctx.receivedAt) {
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Dhaka",
          hour: "numeric",
          hour12: false,
        });
        const hour = Number.parseInt(
          formatter.formatToParts(ctx.receivedAt).find((p) => p.type === "hour")
            ?.value || "12",
          10,
        );
        if (hour < 9 || hour >= 22) {
          const offHoursGreeting = `Assalamu Alaikum ${clientHonorificProfile.salutationBanglish}!`;

          replyContent =
            detectedLang === "bangla"
              ? `আসসালামু আলাইকুম ${clientHonorificProfile.salutationBangla}! আমাদের অফিসিয়াল কাজের সময় (business hours) সকাল ৯:০০ AM থেকে রাত ১০:০০ PM পর্যন্ত। সকালের অফিস শুরু হওয়ার সাথে সাথেই আমাদের টিম আপনার সাথে যোগাযোগ করবে।`
              : detectedLang === "english"
                ? `Hello ${clientHonorificProfile.salutationEnglish}! Our official business hours are 9:00 AM to 10:00 PM BST. We will attend to your request first thing in the morning.`
                : `${offHoursGreeting} Amader official business hours sokal 9:00 AM theke raat 10:00 PM porjonto. Apnar message-ti record kora hoyeche, sokale office shuru houar sathe sathei amader team apnar sathe jogajog korbe. Dhonnobad!`;
        }
      }

      if (!replyContent) {
        // Indicate typing status to WhatsApp contact & web dashboard while generating reply
        await this.setTypingPresence(
          companyId,
          contactId,
          targetConnectionId,
          destinationJid,
          true,
          tenantDb,
        );

        // 3. Audio Branch vs Vision Branch vs Conversational Branch
        if (isAudioMessage) {
          logger.info(
            { contactId, mediaUrl, messageType },
            "Processing inbound audio attachment via Multimodal Audio Service",
          );

          const audioSource = mediaUrl || content || "";
          const audioResult = await this.audioService.processIncomingAudio({
            companyId,
            audioSource,
            hintMimeType: mediaMimeType,
            customerQuery: content && mediaUrl ? content : "",
            language: detectedLang,
            tenantDb,
            geminiClient,
            personaContext: promptContext,
            contactId,
          });

          if (audioResult.transcription) {
            const audioHandoff = this.handoffService.evaluateHandoff(
              audioResult.transcription,
              {
                contactId,
                detectedLang: audioResult.detectedLanguage || detectedLang,
              },
            );

            if (audioHandoff.shouldHandoff) {
              logger.info(
                {
                  contactId,
                  reason: audioHandoff.reason,
                  sentiment: audioHandoff.sentiment,
                },
                "Handoff triggered from audio voice note; executing escalation",
              );

              await this.handoffService.executeEscalation({
                companyId,
                contactId,
                reason: audioHandoff.reason || "complaint",
                sentiment: audioHandoff.sentiment,
                customerHandoverText: audioHandoff.customerHandoverText,
                language: audioResult.detectedLanguage || detectedLang,
                connectionId: targetConnectionId,
                contactJid: destinationJid,
                senderName: ctx.senderName,
                providedDb: this.mockDb,
              });

              return; // Halt autonomous replies
            }

            // Seed customer details if detected from audio transcription
            const preExtracted = extractSlotsFromText(
              audioResult.transcription,
            );
            if (
              preExtracted.customerName ||
              preExtracted.phoneNumber ||
              preExtracted.deliveryAddress ||
              preExtracted.deliveryZone
            ) {
              const session = orderFlowManager.getOrCreateSession(
                companyId,
                contactId,
                audioResult.detectedLanguage || detectedLang,
              );
              orderFlowManager.updateSlots(session, preExtracted);
            }
          }

          replyContent = audioResult.replyText;
        } else if (isImageMessage && (mediaUrl || content)) {
          logger.info(
            { contactId, mediaUrl, messageType },
            "Processing inbound image attachment via Multimodal Vision Service",
          );

          const visionResult = await this.visionService.processIncomingImage({
            companyId,
            imageSource: mediaUrl || content,
            customerQuery: content || "",
            language: detectedLang,
            tenantDb,
            geminiClient,
            personaContext: promptContext,
          });

          if (
            visionResult.extraction?.isPaymentReceipt &&
            visionResult.extraction.receiptDetails?.transactionId
          ) {
            const adapterAny = this.ecommerceAdapter as any;
            if (typeof adapterAny?.handlePaymentReceipt === "function") {
              await adapterAny.handlePaymentReceipt(
                contactId,
                visionResult.extraction.receiptDetails.transactionId,
                visionResult.extraction.receiptDetails.amount,
              );
            }
          }

          if (visionResult.bestMatch && this.ecommerceAdapter) {
            const match = visionResult.bestMatch;
            const orderSession = orderFlowManager.getOrCreateSession(
              companyId,
              contactId,
              detectedLang,
            );
            if (orderSession.slots.items.length === 0) {
              orderFlowManager.addItem(orderSession, {
                productId: String(
                  (match as any).productId || (match as any).id || "108",
                ),
                productName: match.name,
                price: match.price || 1800,
                quantity: 1,
              });
            }
          }

          replyContent = visionResult.replyText;
        } else {
          // Conversational Branch
          // If ecommerce adapter is active and content contains items, seed them into the contact's order session
          if (this.ecommerceAdapter) {
            const preExtracted = extractSlotsFromText(content || "");
            if (preExtracted.items && preExtracted.items.length > 0) {
              const session = orderFlowManager.getOrCreateSession(
                companyId,
                contactId,
                detectedLang,
              );
              for (const itm of preExtracted.items) {
                orderFlowManager.addItem(session, itm);
              }
            }
          }

          const isExplicitSlotInput =
            /(?:^|[^\p{L}\p{N}])(?:name|phone|address|mobile|contact|thikana|nam|নাম|ফোন|মোবাইল|ঠিকানা)\s*[:=\-–]/iu.test(
              content || "",
            );

          const hasActiveOrderSession =
            orderFlowManager.hasActiveSession(contactId);

          const isPurchaseIntent =
            /(?:^|[^\p{L}\p{N}])(?:order|confirm|কনফার্ম|অর্ডার|lagbe|লাগবে|kinbo|কিনব|nibo|নিব|pathan|পাঠান|pathaben|booking|book\b|din|দিন)/iu.test(
              content || "",
            ) ||
            /(?:nite\s*c?hai|নিতে\s*চাই|kinte\s*c?hai|কিনতে\s*চাই|korte\s*c?hai|করতে\s*চাই|dite\s*c?hai|দিতে\s*চাই)/iu.test(
              content || "",
            );

          // If customer is explicitly asking price/stock/availability/delivery feasibility without order verbs, route to Gemini conversational branch
          const isCatalogInquiry =
            /(?:price|dam|দাম|koto|কত|available|স্টক|stock|ache\?|hobe\?|হবে\?|delivery\s*hobe|delivery\s*kora\s*jabe|deliver\s*to)/iu.test(
              content || "",
            ) &&
            !isPurchaseIntent &&
            !isExplicitSlotInput;

          const isOrderIntent =
            Boolean(this.ecommerceAdapter) &&
            !isCatalogInquiry &&
            (hasActiveOrderSession || isExplicitSlotInput || isPurchaseIntent);

          if (this.ecommerceAdapter && isOrderIntent) {
            logger.info(
              { contactId },
              "Processing inbound message through active Order Flow state machine",
            );
            const orderStep = await orderFlowManager.processMessage({
              companyId,
              contactId,
              message: content || "",
              language: detectedLang,
              adapter: this.ecommerceAdapter,
              promptContext,
              conversationId: ctx.conversationId || undefined,
              customerJid: ctx.contactJid || ctx.senderJid || undefined,
            });

            replyContent = orderStep.replyText;
          } else {
            // Fetch recent conversation history (last 10 messages)
            let recentMessages: Array<{
              from_me: boolean;
              content: string | null;
              created_at: Date;
            }> = [];

            try {
              recentMessages = await tenantDb
                .selectFrom("messages")
                .select(["from_me", "content", "created_at"])
                .where("contact_id", "=", contactId)
                .where("content", "is not", null)
                .orderBy("timestamp", "desc")
                .limit(10)
                .execute();
            } catch (err) {
              logger.warn(
                { err: formatError(err), contactId },
                "Could not fetch message history; proceeding with current message only",
              );
            }

            // Convert to chronological order
            recentMessages.reverse();

            const chatHistory: ChatMessage[] = recentMessages.map((m) => ({
              role: m.from_me ? "model" : "user",
              content: m.content || "",
            }));

            // Ensure latest incoming message is present
            if (
              chatHistory.length === 0 ||
              chatHistory[chatHistory.length - 1].content !== content
            ) {
              chatHistory.push({
                role: "user",
                content: content || "",
              });
            }

            // Assemble trilingual persona prompt
            const systemInstruction = buildSystemPrompt(promptContext);

            logger.info(
              { contactId, detectedLang, historyLength: chatHistory.length },
              "Invoking Gemini for conversational response",
            );

            // Generate response via Gemini Client (dual-model failover)
            const aiResult = await geminiClient.generateChatResponse({
              messages: chatHistory,
              systemInstruction,
              temperature: 0.6,
              tools: this.ecommerceAdapter ? [GEMINI_AGENT_TOOLS] : undefined,
            });

            replyContent = aiResult.text;

            // If Gemini generated function calls, execute them via agent tools dispatcher
            if (
              aiResult.functionCalls &&
              aiResult.functionCalls.length > 0 &&
              this.ecommerceAdapter
            ) {
              for (const fc of aiResult.functionCalls) {
                const toolResult = await executeAgentTool(fc.name, fc.args, {
                  adapter: this.ecommerceAdapter,
                  companyId,
                  contactId,
                  promptContext,
                  conversationId: ctx.conversationId || undefined,
                  customerJid: ctx.contactJid || ctx.senderJid || undefined,
                });

                if (!replyContent || replyContent.trim().length === 0) {
                  if (
                    fc.name === "calculate_order_pricing" &&
                    toolResult.success
                  ) {
                    const p = toolResult.data as OrderPricingResult;
                    replyContent = `Total: ৳${p.grandTotal} (Subtotal: ৳${p.subtotal}, Delivery: ৳${p.deliveryFee})`;
                  } else if (
                    fc.name === "book_woocommerce_order" &&
                    toolResult.success
                  ) {
                    const b = toolResult.data as OrderBookingResult;
                    replyContent = `Order confirmed! Order ID: #${b.orderId}`;
                  }
                }
              }
            }
          }
        }
      }

      if (replyContent) {
        replyContent = sanitizeAiReply(replyContent, detectedLang);
      }

      if (!replyContent || replyContent.trim().length === 0) {
        logger.warn({ contactId }, "Empty response received from AI pipeline");
        return;
      }

      // In-flight re-check: re-verify suppression immediately before outbound message delivery
      const preDeliverySuppression = await this.evaluateSuppression(
        companyId,
        contactId,
        isGroup,
        content,
        hasMedia,
        targetConnectionId,
      );

      if (
        preDeliverySuppression.isSuppressed ||
        preDeliverySuppression.shouldSuppress
      ) {
        logger.info(
          { contactId, reason: preDeliverySuppression.reason },
          "AI reply aborted immediately before delivery due to in-flight state change",
        );
        return;
      }

      // 6. Deliver response via WhatsApp Linked Device or Channel Spine
      const replyMessageId = crypto.randomUUID();
      const waMessageId = `ai_${replyMessageId}`;
      const createdAt = toDbDate();

      if (targetConnectionId && destinationJid) {
        let activeSessionId: string;
        try {
          activeSessionId = await getActiveSessionId(
            tenantDb,
            targetConnectionId,
          );
        } catch (err) {
          logger.warn(
            { err: formatError(err), targetConnectionId, contactId },
            "Cannot deliver AI reply: active WhatsApp session not found or connection disconnected",
          );
          return;
        }

        const connection = await tenantDb
          .selectFrom("whatsapp_connections")
          .select(["jid"])
          .where("id", "=", targetConnectionId)
          .executeTakeFirst();

        const sendCommand = await buildSendMessageCommand(
          companyId,
          activeSessionId,
          destinationJid,
          replyContent,
          "text",
          SYSTEM_AI_USER_ID,
          waMessageId,
        );

        // biome-ignore lint/suspicious/noExplicitAny: Kysely transaction parameter
        await tenantDb.transaction().execute(async (trx: any) => {
          await trx
            .insertInto("messages")
            .values({
              id: replyMessageId,
              whatsapp_connection_id: targetConnectionId,
              contact_id: contactId,
              message_id: waMessageId,
              from_me: true,
              sender_jid: connection?.jid || null,
              message_type: "text",
              content: replyContent,
              sent_by_user_id: SYSTEM_AI_USER_ID,
              status: "pending",
              timestamp: createdAt,
              created_at: createdAt,
            })
            .execute();

          await enqueueCommand(
            trx,
            buildCommandSubject(companyId, activeSessionId),
            sendCommand,
          );
        });

        // 7. Broadcast realtime update to inbox UI
        broadcastToContactViewers(companyId, contactId, "message:new", {
          message: {
            id: replyMessageId,
            messageId: waMessageId,
            contactId,
            senderType: "user",
            sentByUserId: SYSTEM_AI_USER_ID,
            sentByUserName: `${promptContext.personaName} (AI)`,
            messageType: "text",
            content: replyContent,
            status: "pending",
            timestamp: createdAt.toISOString(),
          },
        }).catch((err) => {
          logger.warn(
            { err: formatError(err) },
            "Failed to fan out AI message:new event",
          );
        });

        logger.info(
          {
            contactId,
          },
          "Autonomous AI reply delivered successfully",
        );
      }
    } catch (error) {
      logger.error(
        { contactId, err: formatError(error) },
        "Error in AI Orchestrator dispatch loop",
      );
    } finally {
      await this.setTypingPresence(
        companyId,
        contactId,
        targetConnectionId,
        destinationJid,
        false,
        tenantDb,
      ).catch(() => {});
      this.processingContacts.delete(lockKey);
    }
  }

  async handleInboundMessage(ctx: InboundAiMessageContext): Promise<void> {
    return this.dispatchInboundMessage(ctx);
  }
}

export const aiOrchestratorService = new AiOrchestratorService();

/**
 * Non-blocking entry point called from message-handlers.ts and event-processor.ts
 */
export async function dispatchInboundMessageToAi(
  ctx: InboundAiMessageContext,
): Promise<void> {
  // Schedules asynchronously without blocking webhook caller
  setImmediate(() => {
    aiOrchestratorService.dispatchInboundMessage(ctx).catch((err) => {
      logger.error(
        {
          err: formatError(err),
          companyId: ctx.companyId,
          contactId: ctx.contactId,
        },
        "Unhandled error in dispatchInboundMessageToAi",
      );
    });
  });
}
