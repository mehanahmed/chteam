/**
 * Merchant Persona, Business Hours, and FAQ Knowledge Service
 * Supports global company settings and granular per-WhatsApp-connection settings.
 */

import { db } from "@omniteam/database";
import type { SlaPolicy } from "@omniteam/shared";
import { sql } from "kysely";
import { isWithinBusinessHours } from "../sla-policy/calendar.js";
import { getCurrentSlaPolicy } from "../sla-policy/policy.service.js";
import { getTenantConnection } from "../tenant.service.js";
import {
  DEFAULT_DELIVERY_FEES,
  DEFAULT_OUTSIDE_DHAKA_ADVANCE_AMOUNT,
} from "./constants.js";
import type { MerchantPromptContext } from "./gemini/prompts.js";

export interface MerchantAiSettings {
  companyId: string;
  connectionId?: string;
  enabled: boolean;
  storeName: string;
  personaName: string;
  personaTone: "friendly" | "formal" | "enthusiastic";
  insideDhakaFee: number;
  subDhakaFee: number;
  outsideDhakaFee: number;
  outsideDhakaAdvanceRequired: boolean;
  outsideDhakaAdvanceAmount: number;
  paymentMethods: string[];
  customInstructions?: string;
  faqs?: MerchantFaq[];
}

export interface MerchantFaq {
  question: string;
  answer: string;
}

export class MerchantKnowledgeService {
  private customSettings = new Map<string, Partial<MerchantAiSettings>>();

  public setMerchantSettings(
    companyId: string,
    settings: Partial<MerchantAiSettings>,
  ): void {
    this.customSettings.set(companyId, settings);
  }

  public setConnectionSettings(
    companyId: string,
    connectionId: string,
    settings: Partial<MerchantAiSettings>,
  ): void {
    this.customSettings.set(`${companyId}:${connectionId}`, settings);
  }

  private mergeWithDefaults(
    companyId: string,
    connectionId?: string,
    custom?: Partial<MerchantAiSettings>,
  ): MerchantAiSettings {
    const defaultInsideDhaka = DEFAULT_DELIVERY_FEES.INSIDE_DHAKA;
    const defaultSubDhaka = DEFAULT_DELIVERY_FEES.SUB_DHAKA;
    const defaultOutsideDhaka = DEFAULT_DELIVERY_FEES.OUTSIDE_DHAKA;

    return {
      companyId,
      connectionId,
      enabled: custom?.enabled ?? true,
      storeName: custom?.storeName ?? "OmniTeam Store",
      personaName: custom?.personaName ?? "Maya",
      personaTone: custom?.personaTone ?? "friendly",
      insideDhakaFee: custom?.insideDhakaFee ?? defaultInsideDhaka,
      subDhakaFee: custom?.subDhakaFee ?? defaultSubDhaka,
      outsideDhakaFee: custom?.outsideDhakaFee ?? defaultOutsideDhaka,
      outsideDhakaAdvanceRequired: custom?.outsideDhakaAdvanceRequired ?? true,
      outsideDhakaAdvanceAmount:
        custom?.outsideDhakaAdvanceAmount ??
        DEFAULT_OUTSIDE_DHAKA_ADVANCE_AMOUNT,
      paymentMethods: custom?.paymentMethods ?? [
        "Cash on Delivery (COD)",
        "bKash Merchant",
        "Nagad",
      ],
      customInstructions: custom?.customInstructions,
      faqs: custom?.faqs,
    };
  }

  /**
   * Retrieves merchant AI configuration from database or defaults for the company
   */
  async getMerchantSettings(companyId: string): Promise<MerchantAiSettings> {
    const custom = this.customSettings.get(companyId);

    let storeName = "OmniTeam Store";

    try {
      const tenantDb = getTenantConnection(companyId);
      const company = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["name"])
        .where("archived_at", "is", null)
        .limit(1)
        .executeTakeFirst();

      if (company?.name) {
        storeName = company.name;
      }
    } catch {
      // Fall back to default if tenant DB or connection query fails
    }

    return this.mergeWithDefaults(companyId, undefined, {
      storeName,
      ...custom,
    });
  }

  /**
   * Retrieves AI configuration for a specific WhatsApp connection.
   */
  async getConnectionSettings(
    companyId: string,
    connectionId: string,
  ): Promise<MerchantAiSettings> {
    const customKey = `${companyId}:${connectionId}`;
    const inMemory = this.customSettings.get(customKey);
    if (inMemory) {
      return this.mergeWithDefaults(companyId, connectionId, inMemory);
    }

    try {
      const row = await db
        .selectFrom("connection_ai_settings")
        .selectAll()
        .where("company_id", "=", companyId)
        .where("connection_id", "=", connectionId)
        .executeTakeFirst();

      if (row) {
        return {
          companyId,
          connectionId,
          enabled: row.enabled,
          storeName: row.store_name || "OmniTeam Store",
          personaName: row.persona_name || "Maya",
          personaTone:
            (row.persona_tone as "friendly" | "formal" | "enthusiastic") ||
            "friendly",
          insideDhakaFee: Number(
            row.inside_dhaka_fee ?? DEFAULT_DELIVERY_FEES.INSIDE_DHAKA,
          ),
          subDhakaFee: Number(
            row.sub_dhaka_fee ?? DEFAULT_DELIVERY_FEES.SUB_DHAKA,
          ),
          outsideDhakaFee: Number(
            row.outside_dhaka_fee ?? DEFAULT_DELIVERY_FEES.OUTSIDE_DHAKA,
          ),
          outsideDhakaAdvanceRequired:
            row.outside_dhaka_advance_required ?? true,
          outsideDhakaAdvanceAmount: Number(
            row.outside_dhaka_advance_amount ??
              DEFAULT_OUTSIDE_DHAKA_ADVANCE_AMOUNT,
          ),
          paymentMethods: [
            "Cash on Delivery (COD)",
            "bKash Merchant",
            "Nagad",
          ],
          customInstructions: row.custom_instructions || undefined,
          faqs:
            Array.isArray(row.faqs) && row.faqs.length > 0
              ? (row.faqs as MerchantFaq[])
              : undefined,
        };
      }
    } catch {
      // Fall back to connection metadata lookup
    }

    let storeName = "OmniTeam Store";
    try {
      const tenantDb = getTenantConnection(companyId);
      const conn = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["name"])
        .where("id", "=", connectionId)
        .executeTakeFirst();
      if (conn?.name) {
        storeName = conn.name;
      }
    } catch {
      // Ignore
    }

    return this.mergeWithDefaults(companyId, connectionId, { storeName });
  }

  /**
   * Persists AI configuration for a specific WhatsApp connection.
   */
  async saveConnectionSettings(
    companyId: string,
    connectionId: string,
    settings: Partial<MerchantAiSettings>,
  ): Promise<MerchantAiSettings> {
    const current = await this.getConnectionSettings(companyId, connectionId);
    const updated: MerchantAiSettings = {
      ...current,
      ...settings,
      companyId,
      connectionId,
    };

    const faqsJson = JSON.stringify(updated.faqs || []);

    await sql`
      INSERT INTO public.connection_ai_settings (
        company_id,
        connection_id,
        enabled,
        persona_name,
        persona_tone,
        store_name,
        custom_instructions,
        inside_dhaka_fee,
        sub_dhaka_fee,
        outside_dhaka_fee,
        outside_dhaka_advance_required,
        outside_dhaka_advance_amount,
        faqs,
        updated_at
      ) VALUES (
        ${companyId}::uuid,
        ${connectionId}::uuid,
        ${updated.enabled},
        ${updated.personaName},
        ${updated.personaTone},
        ${updated.storeName},
        ${updated.customInstructions || null},
        ${updated.insideDhakaFee},
        ${updated.subDhakaFee},
        ${updated.outsideDhakaFee},
        ${updated.outsideDhakaAdvanceRequired},
        ${updated.outsideDhakaAdvanceAmount},
        ${faqsJson}::jsonb,
        now()
      )
      ON CONFLICT (company_id, connection_id)
      DO UPDATE SET
        enabled = EXCLUDED.enabled,
        persona_name = EXCLUDED.persona_name,
        persona_tone = EXCLUDED.persona_tone,
        store_name = EXCLUDED.store_name,
        custom_instructions = EXCLUDED.custom_instructions,
        inside_dhaka_fee = EXCLUDED.inside_dhaka_fee,
        sub_dhaka_fee = EXCLUDED.sub_dhaka_fee,
        outside_dhaka_fee = EXCLUDED.outside_dhaka_fee,
        outside_dhaka_advance_required = EXCLUDED.outside_dhaka_advance_required,
        outside_dhaka_advance_amount = EXCLUDED.outside_dhaka_advance_amount,
        faqs = EXCLUDED.faqs,
        updated_at = now()
    `.execute(db);

    this.customSettings.set(`${companyId}:${connectionId}`, updated);
    return updated;
  }

  /**
   * Lists all WhatsApp connections in the workspace alongside their AI configuration.
   */
  async listAllConnectionSettings(companyId: string) {
    let connections: Array<{
      id: string;
      name: string | null;
      phone_number: string | null;
      jid: string | null;
      status: string;
    }> = [];

    try {
      const tenantDb = getTenantConnection(companyId);
      connections = await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "name", "phone_number", "jid", "status"])
        .where("archived_at", "is", null)
        .execute();
    } catch {
      // Return empty if tenant error
    }

    let settingsRows: any[] = [];
    try {
      settingsRows = await db
        .selectFrom("connection_ai_settings")
        .selectAll()
        .where("company_id", "=", companyId)
        .execute();
    } catch {
      // Ignore
    }

    const settingsMap = new Map<string, any>();
    for (const row of settingsRows) {
      settingsMap.set(row.connection_id, row);
    }

    return connections.map((conn) => {
      const row = settingsMap.get(conn.id);
      return {
        connectionId: conn.id,
        connectionName: conn.name,
        phoneNumber: conn.phone_number,
        jid: conn.jid,
        status: conn.status,
        enabled: row ? row.enabled : true,
        personaName: row?.persona_name || "Maya",
        personaTone: row?.persona_tone || "friendly",
        storeName: row?.store_name || conn.name || "OmniTeam Store",
        customInstructions: row?.custom_instructions || "",
        insideDhakaFee: row
          ? Number(row.inside_dhaka_fee)
          : DEFAULT_DELIVERY_FEES.INSIDE_DHAKA,
        subDhakaFee: row
          ? Number(row.sub_dhaka_fee)
          : DEFAULT_DELIVERY_FEES.SUB_DHAKA,
        outsideDhakaFee: row
          ? Number(row.outside_dhaka_fee)
          : DEFAULT_DELIVERY_FEES.OUTSIDE_DHAKA,
        outsideDhakaAdvanceRequired: row
          ? row.outside_dhaka_advance_required
          : true,
        outsideDhakaAdvanceAmount: row
          ? Number(row.outside_dhaka_advance_amount)
          : DEFAULT_OUTSIDE_DHAKA_ADVANCE_AMOUNT,
        faqs: Array.isArray(row?.faqs) ? row.faqs : [],
        updatedAt: row?.updated_at || null,
      };
    });
  }

  /**
   * Checks company operational business hours via SLA policy calendar
   */
  async getBusinessHoursStatus(
    companyId: string,
    timestamp: Date = new Date(),
  ): Promise<{
    isWithin: boolean;
    description: string;
    timezone: string;
  }> {
    try {
      const policy: SlaPolicy = await getCurrentSlaPolicy(companyId);
      const isWithin = isWithinBusinessHours(policy, timestamp);

      return {
        isWithin,
        description:
          "Saturday to Thursday, 10:00 AM - 8:00 PM BST (Friday Closed)",
        timezone: policy.timezone || "Asia/Dhaka",
      };
    } catch {
      // If company has no SLA policy, check default BST schedule (Sat-Thu 10am-8pm)
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Dhaka",
        hour: "numeric",
        hour12: false,
        weekday: "short",
      });
      const parts = formatter.formatToParts(timestamp);
      const weekday = parts.find((p) => p.type === "weekday")?.value || "";
      const hour = Number.parseInt(
        parts.find((p) => p.type === "hour")?.value || "0",
        10,
      );

      // Friday closed (Fri); Sat-Thu open 10:00 to 20:00
      const isFriday = weekday.startsWith("Fri");
      const isWithin = !isFriday && hour >= 10 && hour < 20;

      return {
        isWithin,
        description:
          "Saturday to Thursday, 10:00 AM - 8:00 PM BST (Friday Closed)",
        timezone: "Asia/Dhaka",
      };
    }
  }

  /**
   * Default authentic Bangladeshi social commerce retail FAQs
   */
  async getStoreFaqs(_companyId: string): Promise<MerchantFaq[]> {
    return [
      {
        question: "Delivery charge koto pore? (What are delivery charges?)",
        answer: "Inside Dhaka ৳80, Dhaka Suburbs ৳120, and Outside Dhaka ৳150.",
      },
      {
        question: "Koto dine delivery pabo? (How long does delivery take?)",
        answer:
          "Inside Dhaka within 24-48 hours. Dhaka Suburbs within 2-3 days. Outside Dhaka 3-5 business days via courier.",
      },
      {
        question: "Cash on delivery ache ki? (Is Cash on Delivery available?)",
        answer:
          "Ji bhaiya, Cash on Delivery available ache. Outside Dhaka orders-er jonno delivery charge ৳120 advance korte hoy, remaining product price Cash on Delivery-te dite parben.",
      },
      {
        question:
          "Product size fit na hole exchange kora jabe? (Can I exchange if size doesn't fit?)",
        answer:
          "Ji oboshshoi, parcel receive korar 7 diner moddhe unwashed and intact tag-shoho exchange facility paben.",
      },
      {
        question:
          "bKash / Nagad payment number koto? (What is the payment number?)",
        answer:
          "Amader official bKash Merchant number 01XXXXXXXXX (Make Payment option). Reference-e apnar phone number use korben.",
      },
    ];
  }

  /**
   * Assembles full MerchantPromptContext for prompt generator.
   * If a connectionId is provided, uses that connection's specific AI instructions & settings.
   */
  async buildPromptContext(
    companyId: string,
    connectionId?: string,
  ): Promise<MerchantPromptContext> {
    const settings = connectionId
      ? await this.getConnectionSettings(companyId, connectionId)
      : await this.getMerchantSettings(companyId);

    const hours = await this.getBusinessHoursStatus(companyId);
    const faqs =
      settings.faqs && settings.faqs.length > 0
        ? settings.faqs
        : await this.getStoreFaqs(companyId);

    return {
      storeName: settings.storeName,
      personaName: settings.personaName,
      personaTone: settings.personaTone,
      businessHoursText: hours.description,
      isWithinBusinessHours: hours.isWithin,
      insideDhakaFee: settings.insideDhakaFee,
      subDhakaFee: settings.subDhakaFee,
      outsideDhakaFee: settings.outsideDhakaFee,
      outsideDhakaAdvanceRequired: settings.outsideDhakaAdvanceRequired,
      outsideDhakaAdvanceAmount: settings.outsideDhakaAdvanceAmount,
      paymentMethods: settings.paymentMethods,
      faqs,
      customInstructions: settings.customInstructions,
    };
  }
}

export const merchantKnowledgeService = new MerchantKnowledgeService();
