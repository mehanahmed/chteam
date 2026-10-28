/**
 * Opaque Box Harness for OmniTeam WATeamInbox E2E Testing Suite
 * Location: tests/e2e/harness/opaque-box-harness.ts
 *
 * Rewired to execute genuine backend services:
 * - AiOrchestratorService (circuit breakers, suppression, inbound pipeline)
 * - VisionService (multimodal OCR, catalog matching, grounded replies)
 * - HandoffService (complaint evaluation, escalation protocol, durable tagging)
 * - OrderFlowManager (conversational slot-filling state machine, pricing, booking)
 * - InMemoryTestDatabase (Kysely-compatible stateful transactional DB emulator)
 * - MockWooCommerceAdapter (bridges MockWooCommerceServer to ECommercePlatformAdapter)
 * - HermeticGeminiModelMock (clean @google/genai model simulation)
 */

import {
  AiOrchestratorService,
  type InboundAiMessageContext,
} from "../../../apps/api/src/services/ai-agent/ai-orchestrator.service.js";
import {
  addContactTagDurable,
  HandoffService,
  removeContactTagsByName,
} from "../../../apps/api/src/services/ai-agent/conversation/handoff.service.js";
import { orderFlowManager } from "../../../apps/api/src/services/ai-agent/conversation/order-flow.js";
import { GeminiClient } from "../../../apps/api/src/services/ai-agent/gemini/gemini.client.js";
import { VisionService } from "../../../apps/api/src/services/ai-agent/gemini/vision.service.js";
import { merchantKnowledgeService } from "../../../apps/api/src/services/ai-agent/merchant-knowledge.service.js";
import type {
  CatalogProduct,
  CustomerMessageInput,
  OutboundMessageRecord,
  RecordedWooCommerceOrder,
} from "../types.js";
import { SAMPLE_CATALOG } from "./fixtures/sample-catalog.js";
import { InMemoryTestDatabase } from "./in-memory-db.js";
import { HermeticGeminiModelMock } from "./mock-gemini.js";
import { MockWooCommerceServer } from "./mock-woocommerce.js";
import { MockWooCommerceAdapter } from "./woocommerce-adapter.js";

export class OpaqueBoxHarness {
  public geminiMock: HermeticGeminiModelMock;
  public wooMock: MockWooCommerceServer;
  public inMemoryDb: InMemoryTestDatabase;
  public wooAdapter: MockWooCommerceAdapter;
  public aiOrchestrator: AiOrchestratorService;
  public geminiClient: GeminiClient;
  public visionService: VisionService;
  public handoffService: HandoffService;

  private realtimeEvents: Array<{ type: string; payload: any }> = [];
  private isInitialized = false;

  constructor() {
    this.wooMock = new MockWooCommerceServer();
    this.wooAdapter = new MockWooCommerceAdapter(this.wooMock);
    this.geminiMock = new HermeticGeminiModelMock();
    this.geminiClient = new GeminiClient({
      apiKey: "test-e2e-api-key",
      aiInstance: this.geminiMock.asGoogleGenAI(),
    });
    this.inMemoryDb = new InMemoryTestDatabase();
    this.geminiMock.setDatabase(this.inMemoryDb);
    this.visionService = new VisionService();
    this.handoffService = new HandoffService();
    this.handoffService.setMockDb(this.inMemoryDb);

    this.aiOrchestrator = new AiOrchestratorService();
    this.aiOrchestrator.setMockDb(this.inMemoryDb);
    this.aiOrchestrator.setEcommerceAdapter(this.wooAdapter);
    this.aiOrchestrator.setGeminiClient(this.geminiClient);
    this.aiOrchestrator.setVisionService(this.visionService);
    this.aiOrchestrator.setHandoffService(this.handoffService);
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.reset();
    this.isInitialized = true;
  }

  public reset(): void {
    this.realtimeEvents = [];
    this.inMemoryDb.reset();
    this.geminiMock.reset();
    this.geminiMock.setDatabase(this.inMemoryDb);
    this.wooMock.reset();

    // Configure E2E test merchant settings
    merchantKnowledgeService.setMerchantSettings("e2e_company", {
      companyId: "e2e_company",
      enabled: true,
      storeName: "OmniTeam Fashion",
      personaName: "Maya",
      personaTone: "friendly",
      insideDhakaFee: 60,
      subDhakaFee: 100,
      outsideDhakaFee: 120,
      outsideDhakaAdvanceRequired: true,
      outsideDhakaAdvanceAmount: 120,
      paymentMethods: ["Cash on Delivery (COD)", "bKash Merchant", "Nagad"],
    });

    // Clear leftover order flow sessions to guarantee test isolation
    orderFlowManager.clearAllSessions();

    // Populate catalog_products table from SAMPLE_CATALOG
    for (const p of SAMPLE_CATALOG) {
      let desc = p.description || "";
      const sizeAttr = p.attributes?.find(
        (a) => a.name.toLowerCase() === "size",
      );
      if (sizeAttr && sizeAttr.options?.length) {
        desc = `${desc} Available Sizes: ${sizeAttr.options.join(", ")}.`;
      }
      const colorAttr = p.attributes?.find(
        (a) => a.name.toLowerCase() === "color",
      );
      if (colorAttr && colorAttr.options?.length) {
        desc = `${desc} Available Colors: ${colorAttr.options.join(", ")}.`;
      }

      this.inMemoryDb.catalogProducts.set(String(p.id), {
        id: String(p.id),
        product_id: String(p.id),
        catalog_id: "e2e_catalog",
        name: p.name,
        description: desc || null,
        price: p.price,
        currency: "BDT",
        image_urls: p.images || [],
        sku: p.sku,
        category: p.categories?.join(", ") || null,
        availability:
          p.stock_status === "instock" ? "in stock" : "out of stock",
        visibility: "visible",
      });
    }
  }

  public async shutdown(): Promise<void> {
    this.reset();
    this.isInitialized = false;
  }

  // --- External Ingress Simulation (Genuine Execution) ---
  public async sendCustomerWhatsAppMessage(
    input: CustomerMessageInput,
  ): Promise<void> {
    await this.initialize();
    const cleanPhone = input.senderPhone.replace(/[^0-9]/g, "");

    // 1. Ensure contact exists in database emulator
    if (!this.inMemoryDb.contacts.has(cleanPhone)) {
      this.inMemoryDb.contacts.set(cleanPhone, {
        id: cleanPhone,
        is_blocked: false,
      });
    }

    // 2. Ingest customer message into database
    const customerMsgId = crypto.randomUUID();
    const msgDate = input.timestamp ? new Date(input.timestamp) : new Date();
    this.inMemoryDb.messages.push({
      id: customerMsgId,
      whatsapp_connection_id: "conn-e2e-1",
      contact_id: cleanPhone,
      message_id: `wa_cust_${customerMsgId}`,
      from_me: false,
      sender_jid: `${cleanPhone}@s.whatsapp.net`,
      message_type: input.media ? "image" : "text",
      content: input.text || "",
      sent_by_user_id: null,
      status: "received",
      timestamp: msgDate,
      created_at: msgDate,
    });

    // 3. Set active media on model mock for Multimodal Vision inspection
    this.geminiMock.setActiveMedia(input.media);

    // 4. Construct production InboundAiMessageContext
    const ctx: InboundAiMessageContext = {
      companyId: "e2e_company",
      connectionId: "conn-e2e-1",
      contactId: cleanPhone,
      contactJid: `${cleanPhone}@s.whatsapp.net`,
      senderJid: `${cleanPhone}@s.whatsapp.net`,
      senderName: input.senderName,
      messageId: `msg_${customerMsgId}`,
      content: input.text || "",
      mediaUrl: input.media?.base64Data,
      mediaMimeType: input.media?.mimeType,
      messageType: input.media ? "image" : "text",
      isGroup: false,
      receivedAt: input.timestamp ? msgDate : undefined,
    };

    // 5. Execute genuine AiOrchestratorService pipeline
    await this.aiOrchestrator.dispatchInboundMessage(ctx);
  }

  // --- Human Agent Action Simulation in OmniTeam Web Inbox ---
  public async assignContactToHuman(
    phone: string,
    agentUserId: string,
  ): Promise<void> {
    await this.initialize();
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    this.inMemoryDb.contactAssignments.push({
      contact_id: cleanPhone,
      assigned_to: agentUserId,
      assigned_at: new Date(),
      unassigned_at: null,
    });

    await addContactTagDurable(
      this.inMemoryDb,
      cleanPhone,
      "ai-paused",
      "#F59E0B",
      agentUserId,
    );

    this.realtimeEvents.push({
      type: "contact:assigned",
      payload: { phone: cleanPhone, assignedTo: agentUserId },
    });
  }

  public async sendAgentManualReply(
    phone: string,
    agentUserId: string,
    text: string,
  ): Promise<void> {
    await this.initialize();
    const cleanPhone = phone.replace(/[^0-9]/g, "");

    await addContactTagDurable(
      this.inMemoryDb,
      cleanPhone,
      "ai-paused",
      "#F59E0B",
      agentUserId,
    );

    const msgId = crypto.randomUUID();
    const now = new Date();
    this.inMemoryDb.messages.push({
      id: msgId,
      whatsapp_connection_id: "conn-e2e-1",
      contact_id: cleanPhone,
      message_id: `wa_${msgId}`,
      from_me: true,
      sender_jid: "store@s.whatsapp.net",
      message_type: "text",
      content: text,
      sent_by_user_id: agentUserId,
      status: "sent",
      timestamp: now,
      created_at: now,
    });

    this.realtimeEvents.push({
      type: "message:created",
      payload: { phone: cleanPhone, sentByUserId: agentUserId, text },
    });
  }

  public async setAiPauseState(phone: string, paused: boolean): Promise<void> {
    await this.initialize();
    const cleanPhone = phone.replace(/[^0-9]/g, "");

    if (paused) {
      await addContactTagDurable(
        this.inMemoryDb,
        cleanPhone,
        "ai-paused",
        "#F59E0B",
      );
    } else {
      await removeContactTagsByName(this.inMemoryDb, cleanPhone, [
        "ai-paused",
        "needs-human",
        "complaint",
      ]);

      // Terminate any active assignment
      for (const a of this.inMemoryDb.contactAssignments) {
        if (a.contact_id === cleanPhone && !a.unassigned_at) {
          a.unassigned_at = new Date();
        }
      }
    }

    this.realtimeEvents.push({
      type: "contact:updated",
      payload: { phone: cleanPhone, aiPaused: paused },
    });
  }

  // --- External Observable Invariants (Read Directly from Emulator DB) ---
  public getOutboundReplies(phone: string): OutboundMessageRecord[] {
    const cleanTarget = phone.replace(/[^0-9]/g, "");
    return this.inMemoryDb.messages
      .filter((m) => m.contact_id === cleanTarget && m.from_me)
      .map((m) => ({
        recipientJid: phone,
        text: m.content || "",
        timestamp: m.timestamp,
      }));
  }

  public getLastOutboundReply(phone: string): OutboundMessageRecord | null {
    const replies = this.getOutboundReplies(phone);
    return replies.length > 0 ? replies[replies.length - 1] : null;
  }

  public getContactTags(phone: string): string[] {
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    const tagIds = this.inMemoryDb.contactTags
      .filter((ct) => ct.contact_id === cleanPhone)
      .map((ct) => ct.tag_id);

    return tagIds
      .map((id) => this.inMemoryDb.tags.get(id)?.name)
      .filter((name): name is string => Boolean(name));
  }

  public getCreatedOrders(): RecordedWooCommerceOrder[] {
    return this.wooMock.getOrders();
  }

  public getLastCreatedOrder(): RecordedWooCommerceOrder | null {
    return this.wooMock.getLastOrder();
  }

  public getBroadcastEvents(): Array<{ type: string; payload: any }> {
    return [...this.realtimeEvents];
  }

  // --- Mock Catalog & Store Controls ---
  public setStoreCatalog(products: CatalogProduct[]): void {
    this.wooMock.setCatalog(products);
    this.inMemoryDb.catalogProducts.clear();
    for (const p of products) {
      let desc = p.description || "";
      const sizeAttr = p.attributes?.find(
        (a) => a.name.toLowerCase() === "size",
      );
      if (sizeAttr && sizeAttr.options?.length) {
        desc = `${desc} Available Sizes: ${sizeAttr.options.join(", ")}.`;
      }
      const colorAttr = p.attributes?.find(
        (a) => a.name.toLowerCase() === "color",
      );
      if (colorAttr && colorAttr.options?.length) {
        desc = `${desc} Available Colors: ${colorAttr.options.join(", ")}.`;
      }

      this.inMemoryDb.catalogProducts.set(String(p.id), {
        id: String(p.id),
        product_id: String(p.id),
        catalog_id: "e2e_catalog",
        name: p.name,
        description: desc || null,
        price: p.price,
        currency: "BDT",
        image_urls: p.images || [],
        sku: p.sku,
        category: p.categories?.join(", ") || null,
        availability:
          p.stock_status === "instock" ? "in stock" : "out of stock",
        visibility: "visible",
      });
    }
  }

  public setProductStock(
    productId: number,
    variationId: number | null,
    quantity: number,
    status: "instock" | "outofstock" | "onbackorder" = "instock",
  ): void {
    this.wooMock.updateProductStock(productId, variationId, quantity, status);
    const prod = this.inMemoryDb.catalogProducts.get(String(productId));
    if (prod) {
      prod.availability = status === "instock" ? "in stock" : "out of stock";
    }
  }

  public setProductPrice(productId: number, price: number): void {
    this.wooMock.updateProductPrice(productId, price);
    const prod = this.inMemoryDb.catalogProducts.get(String(productId));
    if (prod) {
      prod.price = price;
    }
  }
}
