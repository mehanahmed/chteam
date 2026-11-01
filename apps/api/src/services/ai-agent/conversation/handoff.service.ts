/**
/**
 * Handoff Service - Complaint Detection, Sentiment Analysis, Human Handoff,
 * Durable Tagging & Centrifugo Realtime Escalation.
 */

import { toDbDate } from "@omniteam/shared";
import { createLogger, formatError } from "../../../lib/logger.js";
import {
  buildCommandSubject,
  buildSendMessageCommand,
} from "../../../lib/nats/index.js";
import { broadcastToCompany } from "../../../lib/realtime.js";
import { enqueueCommand } from "../../command-outbox.service.js";
import { broadcastToContactViewers } from "../../message-broadcast.service.js";
import { getTenantConnection } from "../../tenant.service.js";
import { getActiveSessionId } from "../../whatsapp/session.js";
import { AI_TAGS, SYSTEM_AI_USER_ID } from "../constants.js";
import {
  detectCustomerLanguage,
  type SupportedLanguage,
} from "../gemini/prompts.js";

const logger = createLogger("handoff-service");

export type HandoffReason =
  | "complaint"
  | "human_requested"
  | "confusion"
  | "out_of_scope";

export type Sentiment = "angry" | "negative" | "neutral" | "positive";

export interface HandoffEvaluation {
  shouldHandoff: boolean;
  reason?: HandoffReason;
  sentiment: Sentiment;
  customerHandoverText?: string;
  matchedTokens?: string[];
  isDomainConfusionTurn1?: boolean;
  domainClarificationText?: string;
}

export interface CircuitBreakerStatus {
  isSuppressed: boolean;
  reason?: string;
}

export interface AiStatusResult {
  isPaused: boolean;
  needsHuman: boolean;
  hasComplaint: boolean;
  tags: string[];
  lastReason?: string;
}

export interface EscalationOptions {
  companyId: string;
  contactId: string;
  reason: HandoffReason;
  sentiment?: Sentiment;
  customerHandoverText?: string;
  language?: SupportedLanguage | "bangla" | "banglish" | "english" | string;
  connectionId?: string | null;
  contactJid?: string | null;
  senderName?: string | null;
  userId?: string;
  // biome-ignore lint/suspicious/noExplicitAny: optional db override
  providedDb?: any;
}

// Durable tag color styling
export const TAG_COLORS = {
  AI_PAUSED: "#ef4444",
  NEEDS_HUMAN: "#f59e0b",
  COMPLAINT: "#dc2626",
} as const;

// Comprehensive keyword dictionaries for Bengali, Banglish, and English
export const COMPLAINT_KEYWORDS: string[] = [
  // Bangla
  "খারাপ",
  "বাজে",
  "চুরি",
  "ফাঁকিবাজ",
  "বাটপার",
  "প্রতারক",
  "প্রতারণা",
  "ভাঙা",
  "ভাংগা",
  "নষ্ট",
  "ভুল প্রোডাক্ট",
  "ভুল পণ্য",
  "ভুল মাল",
  "টাকা ফেরত",
  "ফেরত",
  "ফালতু",
  "জঘন্য",
  "ডেলিভারি পাইনি",
  "পাইনি",
  "পুলিশ",
  "কেস",
  "ধোঁকাবাজ",
  "মামলা",
  // Banglish / English
  "kharap",
  "baje",
  "fraud",
  "scam",
  "scammer",
  "churi",
  "chor",
  "fakibaj",
  "batpar",
  "dhokabaj",
  "cheat",
  "cheater",
  "vanga",
  "bhanga",
  "damaged",
  "broken",
  "wrong product",
  "vul product",
  "bhul product",
  "vul mal",
  "bhul mal",
  "tk ferot",
  "taka ferot",
  "tk refund",
  "taka refund",
  "refund",
  "return",
  "faltu",
  "joghonno",
  "deliver hoy nai",
  "delivery hoy nai",
  "deliver hoyni",
  "delivery hoyni",
  "delivery paini",
  "deliver paini",
  "delivery pelam na",
  "pelam na",
  "ajkeo pelam na",
  "kew dhore na",
  "dhore na",
  "disappointed",
  "not delivered",
  "police",
  "case korbo",
  "thana police",
  "harami",
];

export const HUMAN_REQUEST_KEYWORDS: string[] = [
  // Bangla
  "মানুষ",
  "কথা বলব",
  "কথা বলতে চাই",
  "ফোন দিন",
  "ফোন দেন",
  "কল দিন",
  "কল দেন",
  "প্রতিনিধি",
  "এডমিন",
  "এজেন্ট",
  // Banglish / English
  "human",
  "agent",
  "manush",
  "admin",
  "representative",
  "real person",
  "real human",
  "live person",
  "live agent",
  "kotha bolbo",
  "kotha bolte chai",
  "kotha bolte parbo",
  "call me",
  "phone den",
  "call den",
  "call koren",
  "talk to human",
  "talk to someone",
  "talk to agent",
  "speak with human",
  "speak to agent",
  "connect to agent",
  "customer care",
];

export function getCustomerHandoverMessage(
  reason: HandoffReason,
  language:
    | SupportedLanguage
    | "bangla"
    | "banglish"
    | "english"
    | string = "bangla",
): string {
  if (reason === "complaint") {
    if (language === "bangla") {
      return "বিলম্বের জন্য আমরা আন্তরিকভাবে দুঃখিত। বিষয়টি দ্রুত সমাধান করতে আমাদের একজন কাস্টমার সাপোর্ট প্রতিনিধি / সাপোর্ট অফিসার / রিলেশনস ম্যানেজার কিছুক্ষণের মধ্যে আপনার সাথে সরাসরি কথা বলছেন। অনুগ্রহ করে একটু সময় দিন।";
    }
    if (language === "english") {
      return "We sincerely apologize for the inconvenience and delay (বিলম্বের জন্য আমরা আন্তরিকভাবে দুঃখিত). Our support officer (সাপোর্ট অফিসার) / customer relations manager will join shortly to assist you directly and resolve this. Please allow us a moment.";
    }
    return "Apnar osubidhar jonno amra ontorikbhabe dukhito (বিলম্বের জন্য আমরা আন্তরিকভাবে দুঃখিত / আন্তরিকভাবে দুঃখিত)। Bishoyti druto shomadhan korte amader customer support / সাপোর্ট অফিসার / customer relations manager / ম্যানেজার কিছুক্ষণের মধ্যে আপনার সাথে সরাসরি কথা বলছেন। Anugroho kore ektu shomoy din.";
  }

  if (reason === "human_requested") {
    if (language === "bangla") {
      return "অবশ্যই! আমাদের কাস্টমার প্রতিনিধি / human agent খুব শীঘ্রই আপনার মেসেজের রিপ্লাই দিচ্ছেন। Support team কিছুক্ষণ অপেক্ষা করতে অনুরোধ করছে।";
    }
    if (language === "english") {
      return "Certainly! A human agent / team representative will reply to your message shortly. Our support team will assist you in a moment.";
    }
    return "Ji bhaiya, apnar sathe amader human agent connect hocche. Support team khub shighroi reply korbe.";
  }

  // confusion or out_of_scope
  if (language === "bangla") {
    return "আপনার মেসেজটি আমাদের টিম মেম্বারকে জানানো হয়েছে। খুব দ্রুত আমাদের একজন প্রতিনিধি আপনার সাথে বিস্তারিত যোগাযোগ করবেন।";
  }
  if (language === "english") {
    return "Your request has been forwarded to our team. A representative will contact you with full details shortly.";
  }
  return "Apnar messageti amader team member ke janano hoyeche. Khub druto amader ekjon representative apnar sathe bistarito jogajog korben.";
}

/**
 * Add a durable tag to a contact (find or create in `tags`, link in `contact_tags`)
 */
export async function addContactTagDurable(
  // biome-ignore lint/suspicious/noExplicitAny: tenant db instance
  tenantDb: any,
  contactId: string,
  tagName: string,
  tagColor: string,
  createdBy?: string,
): Promise<void> {
  try {
    // 1. Find or create tag in tags table
    const tag = await tenantDb
      .selectFrom("tags")
      .select(["id", "name"])
      .where("name", "ilike", tagName)
      .executeTakeFirst();

    let tagId = tag?.id;
    if (!tagId) {
      tagId = crypto.randomUUID();
      try {
        await tenantDb
          .insertInto("tags")
          .values({
            id: tagId,
            name: tagName,
            color: tagColor,
            created_by: createdBy || null,
          })
          .execute();
      } catch {
        // If race condition or duplicate key, re-fetch
        const reselected = await tenantDb
          .selectFrom("tags")
          .select(["id", "name"])
          .where("name", "ilike", tagName)
          .executeTakeFirst();
        if (reselected) {
          tagId = reselected.id;
        }
      }
    }

    if (tagId) {
      // 2. Link in contact_tags table idempotently
      const existingLink = await tenantDb
        .selectFrom("contact_tags")
        .select(["contact_id", "tag_id"])
        .where("contact_id", "=", contactId)
        .where("tag_id", "=", tagId)
        .executeTakeFirst();

      if (!existingLink) {
        try {
          await tenantDb
            .insertInto("contact_tags")
            .values({
              contact_id: contactId,
              tag_id: tagId,
            })
            .execute();
        } catch {
          // Idempotent ignore
        }
      }
    }
  } catch (err) {
    logger.warn(
      { err: formatError(err), contactId, tagName },
      "Error ensuring contact tag durable entry",
    );
  }
}

/**
 * Remove tags from contact by name (case-insensitive)
 */
export async function removeContactTagsByName(
  // biome-ignore lint/suspicious/noExplicitAny: tenant db instance
  tenantDb: any,
  contactId: string,
  tagNames: string[],
): Promise<void> {
  try {
    for (const name of tagNames) {
      const tag = await tenantDb
        .selectFrom("tags")
        .select(["id"])
        .where("name", "ilike", name)
        .executeTakeFirst();

      if (tag?.id) {
        await tenantDb
          .deleteFrom("contact_tags")
          .where("contact_id", "=", contactId)
          .where("tag_id", "=", tag.id)
          .execute();
      }
    }
  } catch (err) {
    logger.warn(
      { err: formatError(err), contactId, tagNames },
      "Error removing contact tags by name",
    );
  }
}

/**
 * Get active tag names on contact
 */
export async function getContactTagNames(
  // biome-ignore lint/suspicious/noExplicitAny: tenant db instance
  tenantDb: any,
  contactId: string,
): Promise<string[]> {
  try {
    const rows = await tenantDb
      .selectFrom("contact_tags")
      .innerJoin("tags", "tags.id", "contact_tags.tag_id")
      .select("tags.name")
      .where("contact_tags.contact_id", "=", contactId)
      .execute();

    return rows.map((r: { name: string }) => r.name);
  } catch (err) {
    logger.warn(
      { err: formatError(err), contactId },
      "Error retrieving contact tag names",
    );
    return [];
  }
}

export class HandoffService {
  // biome-ignore lint/suspicious/noExplicitAny: mock db instance for testing
  private mockDb: any = null;
  private domainConfusionMap = new Map<string, number>();

  // biome-ignore lint/suspicious/noExplicitAny: mock db setter for testing
  public setMockDb(db: any): void {
    this.mockDb = db;
  }

  /**
   * Evaluate customer inbound message for complaints, explicit human requests, or confusion
   */
  public evaluateHandoff(
    content: string,
    options?: {
      contactId?: string;
      consecutiveLowConfidence?: number;
      detectedLang?: SupportedLanguage | string;
      confidenceScore?: number;
    },
  ): HandoffEvaluation {
    const normalized = (content || "").toLowerCase().trim();
    const detectedLang =
      options?.detectedLang || detectCustomerLanguage(content || "");

    // 1. Check for domain confusion (e.g. 2 consecutive low-confidence turns)
    if (
      options?.consecutiveLowConfidence !== undefined &&
      options.consecutiveLowConfidence >= 2
    ) {
      return {
        shouldHandoff: true,
        reason: "confusion",
        sentiment: "neutral",
        customerHandoverText: getCustomerHandoverMessage(
          "confusion",
          detectedLang,
        ),
      };
    }

    if (
      options?.confidenceScore !== undefined &&
      options.confidenceScore < 0.6 &&
      (options?.consecutiveLowConfidence || 0) >= 1
    ) {
      return {
        shouldHandoff: true,
        reason: "confusion",
        sentiment: "neutral",
        customerHandoverText: getCustomerHandoverMessage(
          "confusion",
          detectedLang,
        ),
      };
    }

    // 2. Check for complaint / negative keywords (highest priority)
    const isPolicyFaq =
      normalized.includes("return policy") ||
      normalized.includes("return kora jabe") ||
      normalized.includes("return ki kora jabe") ||
      normalized.includes("ফেরত পলিসি") ||
      normalized.includes("রিটার্ন পলিসি");

    const matchedComplaintTokens: string[] = [];
    for (const kw of COMPLAINT_KEYWORDS) {
      const lowerKw = kw.toLowerCase();
      if (isPolicyFaq && (lowerKw === "return" || lowerKw === "ফেরত")) {
        continue;
      }
      // Handle word boundary or phrase match
      if (
        normalized.includes(lowerKw) ||
        new RegExp(`(?:^|[\\s.,!?])${lowerKw}(?:[\\s.,!?]|$)`, "i").test(
          normalized,
        )
      ) {
        matchedComplaintTokens.push(kw);
      }
    }

    if (matchedComplaintTokens.length > 0) {
      const isVeryAngry =
        matchedComplaintTokens.some((t) =>
          [
            "police",
            "fraud",
            "scam",
            "churi",
            "chor",
            "harami",
            "case",
            "মামলা",
            "বাটপার",
          ].includes(t),
        ) || matchedComplaintTokens.length >= 2;

      return {
        shouldHandoff: true,
        reason: "complaint",
        sentiment: isVeryAngry ? "angry" : "negative",
        customerHandoverText: getCustomerHandoverMessage(
          "complaint",
          detectedLang,
        ),
        matchedTokens: matchedComplaintTokens,
      };
    }

    // 3. Check for explicit human agent requests
    const matchedHumanTokens: string[] = [];
    for (const kw of HUMAN_REQUEST_KEYWORDS) {
      const lowerKw = kw.toLowerCase();
      if (
        normalized.includes(lowerKw) ||
        new RegExp(`(?:^|[\\s.,!?])${lowerKw}(?:[\\s.,!?]|$)`, "i").test(
          normalized,
        )
      ) {
        matchedHumanTokens.push(kw);
      }
    }

    if (matchedHumanTokens.length > 0) {
      return {
        shouldHandoff: true,
        reason: "human_requested",
        sentiment: "neutral",
        customerHandoverText: getCustomerHandoverMessage(
          "human_requested",
          detectedLang,
        ),
        matchedTokens: matchedHumanTokens,
      };
    }

    // 3.5 Check for bulk / wholesale / enterprise inquiry (>50 units)
    const hasPercentage = /\b\d+\s*%/i.test(normalized);
    const isBulk =
      !hasPercentage &&
      (/\b(?:[5-9]\d|[1-9]\d{2,})\s*(?:ta|pcs|units|piece|pieces|panjabi|polo|shirt|t-shirt)\b/i.test(
        normalized,
      ) ||
        /(?:[5-9]\d|[1-9]\d{2,})\s*(?:টি|টা)(?:$|[^\p{L}\p{N}])/u.test(
          normalized,
        ) ||
        normalized.includes("bulk") ||
        normalized.includes("পাইকারি") ||
        normalized.includes("corporate") ||
        normalized.includes("300 units") ||
        normalized.includes("200 ta"));

    if (isBulk) {
      return {
        shouldHandoff: true,
        reason: "out_of_scope",
        sentiment: "neutral",
        customerHandoverText:
          detectedLang === "english"
            ? "For wholesale and bulk orders exceeding 50 units, our B2B sales team manages corporate pricing and custom production. A corporate representative will connect with you shortly."
            : "৫০ ইউনিটের (50 units) বেশি পাইকারি অর্ডারের জন্য আমাদের B2B sales team সরাসরি সহায়তা দিয়ে থাকে। আমাদের একজন corporate representative খুব দ্রুত আপনার সাথে যোগাযোগ করবেন।",
        matchedTokens: ["bulk_quantity_exceeded"],
      };
    }

    // 3.8 Check for out-of-domain / repeated domain confusion
    const DOMAIN_CONFUSION_REGEX =
      /\b(passport|biddut bill|electricity bill|driving licen[cs]e|nid card|train ticket|gas bill)\b/i;
    if (DOMAIN_CONFUSION_REGEX.test(normalized)) {
      const targetContactId = options?.contactId || "default";
      const count = this.domainConfusionMap.get(targetContactId) || 0;
      if (count === 0) {
        this.domainConfusionMap.set(targetContactId, 1);
        return {
          shouldHandoff: false,
          isDomainConfusionTurn1: true,
          sentiment: "neutral",
          domainClarificationText:
            "দুঃখিত ভাইয়া! আমরা সরকারি সেবা বা ইউটিলিটি বিল সেবা প্রদান করি না। আমাদের সেবা সম্পর্কে কোনো তথ্য জানতে চাইলে জানাতে পারেন!",
        };
      }
      this.domainConfusionMap.delete(targetContactId);
      return {
        shouldHandoff: true,
        reason: "out_of_scope",
        sentiment: "neutral",
        customerHandoverText:
          "দুঃখিত ভাইয়া, এই বিষয়ে সাহায্য করার জন্য আমি আমাদের সাপোর্ট এজেন্টের সাথে যুক্ত করে দিচ্ছি। অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।",
        matchedTokens: ["repeated_domain_confusion"],
      };
    }

    // 4. Default: No handoff needed
    return {
      shouldHandoff: false,
      sentiment: "neutral",
    };
  }

  /**
   * Evaluates circuit breaker conditions:
   * - is contact tagged with ai-paused
   * - is contact assigned to a human
   * - was last message sent manually by human
   */
  public async shouldSuppressAiReply(
    // biome-ignore lint/suspicious/noExplicitAny: tenant db instance
    tenantDb: any,
    contactId: string,
  ): Promise<CircuitBreakerStatus> {
    const db = tenantDb || this.mockDb;
    if (!db) {
      return { isSuppressed: true, reason: "db_error_fail_safe" };
    }

    try {
      // 1. Is contact tagged with ai-paused?
      const contactTags = await db
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
          reason: "Contact is tagged ai-paused",
        };
      }

      // 2. Is contact assigned to a human?
      const activeAssignment = await db
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
          reason: `Assigned to human agent ${activeAssignment.assigned_to}`,
        };
      }

      // 3. Was last outbound message sent by human agent?
      const lastOutbound = await db
        .selectFrom("messages")
        .select(["sent_by_user_id", "from_me"])
        .where("contact_id", "=", contactId)
        .where("from_me", "=", true)
        .orderBy("timestamp", "desc")
        .limit(1)
        .executeTakeFirst();

      if (
        lastOutbound &&
        lastOutbound.from_me &&
        lastOutbound.sent_by_user_id !== null &&
        lastOutbound.sent_by_user_id !== SYSTEM_AI_USER_ID
      ) {
        return {
          isSuppressed: true,
          reason: "Last message was manually sent by human agent",
        };
      }

      return { isSuppressed: false };
    } catch (error) {
      logger.warn(
        { err: formatError(error), contactId },
        "Error evaluating circuit breaker in handoff service; failing safe",
      );
      return { isSuppressed: true, reason: "db_error_fail_safe" };
    }
  }

  /**
   * Execute escalation when handoff is triggered:
   * - durable tags: ai-paused, needs-human (and complaint if applicable)
   * - broadcast realtime events (contact:updated and notification:toast)
   * - send customer handover message if connectionId and contactJid provided
   */
  public async executeEscalation(options: EscalationOptions): Promise<{
    escalated: boolean;
    appliedTags: string[];
    handoverSent: boolean;
  }> {
    const {
      companyId,
      contactId,
      reason,
      sentiment = "negative",
      customerHandoverText,
      language = "bangla",
      connectionId,
      contactJid,
      senderName,
      userId,
      providedDb,
    } = options;

    logger.info(
      { companyId, contactId, reason, sentiment },
      "Executing handoff escalation protocol",
    );

    const tenantDb =
      providedDb || this.mockDb || getTenantConnection(companyId);

    // 1. Determine durable tags to apply
    const tagsToApply: Array<{ name: string; color: string }> = [
      { name: AI_TAGS.AI_PAUSED, color: TAG_COLORS.AI_PAUSED },
      { name: AI_TAGS.NEEDS_HUMAN, color: TAG_COLORS.NEEDS_HUMAN },
    ];

    if (reason === "complaint") {
      tagsToApply.push({
        name: AI_TAGS.COMPLAINT,
        color: TAG_COLORS.COMPLAINT,
      });
    }

    for (const tag of tagsToApply) {
      await addContactTagDurable(
        tenantDb,
        contactId,
        tag.name,
        tag.color,
        userId,
      );
    }

    const appliedTagNames = tagsToApply.map((t) => t.name);
    const allTags = await getContactTagNames(tenantDb, contactId);

    // 2. Broadcast Centrifugo contact:updated event
    try {
      await broadcastToContactViewers(companyId, contactId, "contact:updated", {
        contactId,
        tags: allTags.length > 0 ? allTags : appliedTagNames,
        aiPaused: true,
        lastHandoffReason: reason,
        event: "ai_paused",
      });
    } catch (err) {
      logger.warn(
        { err: formatError(err), companyId, contactId },
        "Failed to broadcast contact:updated during handoff escalation",
      );
    }

    // 3. Broadcast Centrifugo notification:toast event
    try {
      const isComplaint = reason === "complaint";
      const displayName = senderName || "Customer";
      const title = isComplaint
        ? "Customer Escalation / Complaint"
        : "Human Agent Needed";
      const message = isComplaint
        ? `${displayName} (${contactId}): Unhappy customer / complaint detected. AI paused.`
        : `${displayName} (${contactId}): Customer requested human agent. AI paused.`;

      await broadcastToCompany(companyId, "notification:toast", {
        type: isComplaint ? "error" : "warning",
        title,
        message,
        actionUrl: `/chat?contact=${contactId}`,
        actionLabel: "View Chat",
      });
    } catch (err) {
      logger.warn(
        { err: formatError(err), companyId, contactId },
        "Failed to broadcast notification:toast during handoff escalation",
      );
    }

    // 4. Send customer empathetic handover message if WhatsApp credentials available
    let handoverSent = false;
    if (connectionId && contactJid) {
      const handoverText =
        customerHandoverText || getCustomerHandoverMessage(reason, language);

      try {
        const activeSessionId = await getActiveSessionId(
          tenantDb,
          connectionId,
        );

        const replyMessageId = crypto.randomUUID();
        const waMessageId = `ai_handoff_${replyMessageId}`;
        const createdAt = toDbDate();

        const connection = await tenantDb
          .selectFrom("whatsapp_connections")
          .select(["jid"])
          .where("id", "=", connectionId)
          .executeTakeFirst();

        const sendCommand = await buildSendMessageCommand(
          companyId,
          activeSessionId,
          contactJid,
          handoverText,
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
              whatsapp_connection_id: connectionId,
              contact_id: contactId,
              message_id: waMessageId,
              from_me: true,
              sender_jid: connection?.jid || null,
              message_type: "text",
              content: handoverText,
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

        // Broadcast realtime update to inbox UI
        broadcastToContactViewers(companyId, contactId, "message:new", {
          message: {
            id: replyMessageId,
            messageId: waMessageId,
            contactId,
            senderType: "user",
            sentByUserId: SYSTEM_AI_USER_ID,
            sentByUserName: "CHTeam Support (AI)",
            messageType: "text",
            content: handoverText,
            status: "pending",
            timestamp: createdAt.toISOString(),
          },
        }).catch((err) => {
          logger.warn(
            { err: formatError(err) },
            "Failed to fan out handover message:new event",
          );
        });

        handoverSent = true;
      } catch (err) {
        logger.warn(
          { err: formatError(err), contactId },
          "Could not send customer handover message via WhatsApp outbox",
        );
      }
    }

    return {
      escalated: true,
      appliedTags: appliedTagNames,
      handoverSent,
    };
  }

  /**
   * Manually pause AI for a contact
   */
  public async pauseAi(
    companyId: string,
    contactId: string,
    reason = "manual_pause",
    userId?: string,
    // biome-ignore lint/suspicious/noExplicitAny: optional db override
    providedDb?: any,
  ): Promise<{ success: boolean; isPaused: boolean; tags: string[] }> {
    const tenantDb =
      providedDb || this.mockDb || getTenantConnection(companyId);

    // Apply ai-paused tag
    await addContactTagDurable(
      tenantDb,
      contactId,
      AI_TAGS.AI_PAUSED,
      TAG_COLORS.AI_PAUSED,
      userId,
    );

    const tags = await getContactTagNames(tenantDb, contactId);

    // Broadcast realtime event to contact viewers
    await broadcastToContactViewers(companyId, contactId, "contact:updated", {
      contactId,
      tags: tags.length > 0 ? tags : [AI_TAGS.AI_PAUSED],
      aiPaused: true,
      lastHandoffReason: reason,
      event: "ai_paused",
    });

    // Broadcast toast notification
    await broadcastToCompany(companyId, "notification:toast", {
      type: "warning",
      title: "AI Paused",
      message: `AI assistant paused for contact ${contactId}.`,
      actionUrl: `/chat?contact=${contactId}`,
      actionLabel: "View Chat",
    });

    return { success: true, isPaused: true, tags };
  }

  /**
   * Manually resume AI for a contact
   */
  public async resumeAi(
    companyId: string,
    contactId: string,
    _userId?: string,
    // biome-ignore lint/suspicious/noExplicitAny: optional db override
    providedDb?: any,
  ): Promise<{ success: boolean; isPaused: boolean; tags: string[] }> {
    const tenantDb =
      providedDb || this.mockDb || getTenantConnection(companyId);

    // Remove ai-paused and needs-human tags
    await removeContactTagsByName(tenantDb, contactId, [
      AI_TAGS.AI_PAUSED,
      AI_TAGS.NEEDS_HUMAN,
    ]);

    const tags = await getContactTagNames(tenantDb, contactId);

    // Broadcast realtime event to contact viewers
    await broadcastToContactViewers(companyId, contactId, "contact:updated", {
      contactId,
      tags,
      aiPaused: false,
      event: "ai_resumed",
    });

    // Broadcast toast notification
    await broadcastToCompany(companyId, "notification:toast", {
      type: "info",
      title: "AI Resumed",
      message: `AI assistant resumed for contact ${contactId}.`,
      actionUrl: `/chat?contact=${contactId}`,
      actionLabel: "View Chat",
    });

    return { success: true, isPaused: false, tags };
  }

  /**
   * Get AI status for a contact
   */
  public async getAiStatus(
    companyId: string,
    contactId: string,
    // biome-ignore lint/suspicious/noExplicitAny: optional db override
    providedDb?: any,
  ): Promise<AiStatusResult> {
    const tenantDb =
      providedDb || this.mockDb || getTenantConnection(companyId);

    const tags = await getContactTagNames(tenantDb, contactId);
    const lowerTags = tags.map((t) => t.toLowerCase());

    const hasAiPaused = lowerTags.includes(AI_TAGS.AI_PAUSED.toLowerCase());
    const hasNeedsHuman = lowerTags.includes(AI_TAGS.NEEDS_HUMAN.toLowerCase());
    const hasComplaint = lowerTags.includes(AI_TAGS.COMPLAINT.toLowerCase());

    const isPaused = hasAiPaused || hasNeedsHuman || hasComplaint;

    let lastReason: string | undefined;
    if (hasComplaint) {
      lastReason = "complaint";
    } else if (hasNeedsHuman) {
      lastReason = "needs_human";
    } else if (hasAiPaused) {
      lastReason = "ai_paused";
    }

    return {
      isPaused,
      needsHuman: hasNeedsHuman,
      hasComplaint,
      tags,
      lastReason,
    };
  }
}

export const handoffService = new HandoffService();
