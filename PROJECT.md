# Project: OmniTeam Enterprise AI Sales & Customer Support Agent (WATeamInbox)

## Architecture
OmniTeam AI Sales & Customer Support Agent is modeled after LazyChat.io and built on top of the OmniTeam monorepo (Bun 1.4+, Hono, React 19/Vite, Kysely PostgreSQL, NATS, and Centrifugo). It provides 24/7 autonomous social-commerce sales, trilingual dialog understanding, multimodal product matching, real-time WooCommerce inventory sync, automated in-chat order booking, and robust human agent collaboration.

### Core Architecture & Data Flow:
```
[Channel Ingress: WhatsApp / Telegram / Web]
               │
               ▼
[Inbound Handlers: apps/api/src/services/handlers/message-handlers.ts]
               │
               ▼
[AI Orchestrator Interceptor: apps/api/src/services/ai-agent/ai-orchestrator.service.ts]
   ├── Check Suppression (ai-paused tag, human assignment, manual agent send)
   ├── Check Sentiment / Complaint -> Trigger Handoff & Tagging if needed
   │
   ├── Multimodal Branch (if media attachment present):
   │     └── Vision Service: S3 Image -> Gemini 2.0 Flash OCR/Vision -> 2-Stage Catalog Search
   │
   ├── Conversational Branch:
   │     └── Gemini Client: Trilingual Prompt (Bangla/Banglish/English) + Language Mirroring
   │
   ├── E-Commerce & Order Booking Branch:
   │     ├── Inventory Service: Real-time stock verification (WooCommerce REST API v3)
   │     ├── Delivery Engine: Zone detection (Inside Dhaka ৳60, Suburbs ৳100, Outside Dhaka ৳120)
   │     └── Order Flow State Machine: Slot filling -> Calculation -> POST /orders -> Confirmation
   │
   ▼
[Outbound Message Sender] -> Customer WhatsApp/Telegram
               │
[Centrifugo Realtime Broadcast] -> OmniTeam Web Dashboard (MessageHeader.tsx UI Controls)
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Gemini GenAI Client & Model Routing | Unified `@google/genai` TypeScript client with `gemini-2.0-flash` primary and `gemini-1.5-flash` fallback | M1 | Survey |
| 2 | Trilingual Conversational Engine | Language Mirroring protocol supporting Banglish, Bengali script, and English with code-mixing | M1 | ORIGINAL_REQUEST R1 |
| 3 | Merchant Persona & FAQ Knowledge Base | Authentic Bangladeshi retail persona ("bhaiya/apu", "apni", "Assalamu Alaikum", business hours, policies) | M1 | ORIGINAL_REQUEST R1 |
| 4 | Inbound AI Orchestrator Dispatcher | Asynchronous processing hook listening to inbound messages from WhatsApp and Channel Spines | M1 | Survey |
| 5 | Multimodal Image Ingestion & S3 Buffer Reader | Read customer photos/screenshots directly from S3 bucket with resizing and Base64 inlineData encoding | M2 | Survey |
| 6 | Gemini Multimodal Vision Feature & OCR Extraction | Extract overlay text, SKU, price, colors, garment category, or bKash/Nagad receipt data from images | M2 | ORIGINAL_REQUEST R2 |
| 7 | 2-Stage Hybrid Visual Catalog Matcher | Fast Meilisearch & catalog DB search using OCR tokens and visual features to identify exact products | M2 | ORIGINAL_REQUEST R2 |
| 8 | Payment Receipt OCR & Extraction | Visual extraction of transaction ID, payment provider (bKash/Nagad), and amount for order advances | M2 | Survey |
| 9 | Unified E-Commerce Platform Adapter | Multi-platform abstraction interface for products, stock queries, and order creation | M3 | ORIGINAL_REQUEST R3 |
| 10 | WooCommerce REST API v3 Sync Client | Basic Auth client syncing `/wp-json/wc/v3/products` and `/products/:id/variations` with pagination | M3 | ORIGINAL_REQUEST R3 |
| 11 | Real-Time Stock & Variant Verification | Live stock status check (`instock`, `outofstock`, `stock_quantity`, backorders) preventing stockout sales | M3 | ORIGINAL_REQUEST R3 |
| 12 | Shopify Admin API Roadmap Adapter | GraphQL Admin API adapter mapping products, variant inventory, and draft/live orders | M3 | ORIGINAL_REQUEST R3 |
| 13 | Delivery Zone Classifier Engine | Trilingual regex parser classifying addresses into Inside Dhaka, Sub-Dhaka, or Outside Dhaka | M4 | Survey |
| 14 | Mathematical Order Pricing Calculator | Formula computing subtotal, percentage/fixed coupons, delivery charge, and grand total | M4 | ORIGINAL_REQUEST R4 |
| 15 | Outside Dhaka Advance Payment Guard | Policy requiring ৳120 delivery charge advance via bKash/Nagad for courier RTO loss prevention | M4 | Survey |
| 16 | Conversational Slot Filling & 11-digit Phone Validation | Structured extraction and interactive prompting for recipient name, 11-digit BD mobile, address, and zone | M4 | ORIGINAL_REQUEST R4 |
| 17 | Automated WooCommerce Order Booking | Programmatic `POST /wp-json/wc/v3/orders` creating COD order with billing, shipping, line items, and fees | M4 | ORIGINAL_REQUEST R4 |
| 18 | Chat Order Confirmation Summary | Friendly chat summary with Order ID, items, delivery fee, and grand total sent to customer | M4 | ORIGINAL_REQUEST R4 |
| 19 | Sentiment & Complaint Detection | Sentiment analysis identifying abusive language, complaints ("tk ferot", "vul product", "kharap"), or returns | M5 | ORIGINAL_REQUEST R5 |
| 20 | Explicit Agent Request & Confusion Detection | Detect customer requests for human assistance ("human", "manush") or repeated domain confusion | M5 | ORIGINAL_REQUEST R5 |
| 21 | OmniTeam Durable Tagging & Realtime Escalation | Automatic tagging with `ai-paused`, `needs-human`, `complaint` and Centrifugo broadcast | M5 | ORIGINAL_REQUEST R5 |
| 22 | Pre-Reply Interception & Circuit Breakers | Suppress AI reply if contact is assigned to human, tagged `ai-paused`, or last message is from human agent | M5 | ORIGINAL_REQUEST R5 |
| 23 | Chat Header UI Controls (Pause & Resume AI) | Status badge (AI Active / AI Paused) and one-click Pause/Resume button in `MessageHeader.tsx` | M5 | ORIGINAL_REQUEST R5 |
| 24 | Contextual Customer Handover Messages | Empathetic bilingual reassurance messages delivered to customer before AI falls silent | M5 | Survey |
| 25 | E2E Testing Suite (Tiers 1-4) | Comprehensive opaque-box test suite for features, boundaries, pairwise combinations, and real workloads | E2E Track | Project Pattern |
| 26 | Final Integration & Tier 5 Adversarial Coverage Hardening | White-box adversarial testing, edge-case bug fixing, and final acceptance verification | M6 | Project Pattern |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core AI Engine & Persona | Features 1, 2, 3, 4: `@google/genai` client, Gemini 2.0/1.5 Flash, trilingual persona & Language Mirroring, message hook | none | DONE |
| M2 | Multimodal Vision & Recognition | Features 5, 6, 7, 8: S3 buffer ingestion, Gemini Vision OCR, 2-stage visual catalog matcher, payment receipt OCR | M1 | DONE |
| M3 | E-Commerce Sync (WooCommerce + Shopify) | Features 9, 10, 11, 12: Unified adapter, WooCommerce v3 REST API client (products, variations, live stock), Shopify roadmap | none | DONE |
| M4 | In-Chat Order Collection & Placement | Features 13, 14, 15, 16, 17, 18: Slot filling, 11-digit phone check, zone detector, price calculator, order placement | M1, M3 | DONE |
| M5 | Inbox Collaboration, Safety & UI Controls | Features 19, 20, 21, 22, 23, 24: Complaint detector, tagging, pre-reply interceptor, Centrifugo events, web UI controls | M1 | DONE |
| M6 | Final Integration & E2E Acceptance Pass | Feature 26: 100% pass of E2E test suite (Tiers 1-4) + Tier 5 Adversarial Coverage Hardening | M1-M5, E2E | IN_PROGRESS |
| E2E | E2E Testing Track | Feature 25: Test infra, test cases (Tiers 1-4), validation runner, and `TEST_READY.md` publication | none | DONE |

## Interface Contracts

### 1. `apps/api/src/services/ai-agent/gemini/gemini.client.ts` ↔ Agent Modules
```typescript
export interface GeminiServiceConfig {
  apiKey: string;
  primaryModel: string;   // "gemini-2.0-flash"
  fallbackModel: string;  // "gemini-1.5-flash"
}

export interface ChatMessage {
  role: "user" | "model" | "system";
  content: string;
  media?: {
    mimeType: string;
    base64Data: string;
  };
}

export interface GenerateChatResponseOptions {
  messages: ChatMessage[];
  systemInstruction?: string;
  temperature?: number;
  tools?: any[];
  responseSchema?: any;
}
```

### 2. `apps/api/src/services/ai-agent/ecommerce/ecommerce.interface.ts` ↔ In-Chat Order Engine
```typescript
export interface UnifiedProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  regularPrice: number;
  salePrice?: number;
  description: string;
  images: string[];
  inStock: boolean;
  stockQuantity: number | null;
  attributes: Array<{ name: string; options: string[] }>;
  variations: Array<{
    id: string;
    sku: string;
    price: number;
    inStock: boolean;
    stockQuantity: number | null;
    attributes: Record<string, string>; // e.g. { "Size": "XL", "Color": "Black" }
  }>;
}

export interface StockCheckResult {
  available: boolean;
  availableQuantity: number | null;
  unitPrice: number;
  errorReason?: string;
}

export interface OrderBookingPayload {
  customerName: string;
  phoneNumber: string;       // 11 digits BD
  deliveryAddress: string;
  deliveryZone: "inside_dhaka" | "sub_dhaka" | "outside_dhaka";
  items: Array<{
    productId: string;
    variationId?: string;
    quantity: number;
    unitPrice: number;
  }>;
  deliveryFee: number;
  discountAmount?: number;
  paymentMethod: "cod" | "bkash" | "nagad";
  notes?: string;
}

export interface OrderBookingResult {
  success: boolean;
  orderId: string;
  orderTotal: number;
  status: string;
  error?: string;
}
```

### 3. `apps/api/src/services/ai-agent/conversation/handoff.service.ts` ↔ OmniTeam Inbox & Realtime
```typescript
export interface HandoffEvaluation {
  shouldHandoff: boolean;
  reason?: "complaint" | "human_requested" | "confusion" | "out_of_scope";
  sentiment: "angry" | "negative" | "neutral" | "positive";
  customerHandoverText?: string;
}

export interface CircuitBreakerStatus {
  isSuppressed: boolean;
  reason?: string;
}
```

## Code Layout
```
apps/api/src/services/ai-agent/
├── ai-orchestrator.service.ts          # Main ingestion pipeline & dispatch
├── gemini/
│   ├── gemini.client.ts                # Unified @google/genai wrapper
│   ├── prompts.ts                      # Trilingual system prompts, personas, Language Mirroring
│   └── vision.service.ts               # S3 image buffer fetch, Gemini Vision OCR, catalog matcher
├── ecommerce/
│   ├── ecommerce.interface.ts          # Unified multi-platform adapter contract
│   ├── woocommerce.client.ts           # WooCommerce REST API v3 client
│   ├── shopify.client.ts               # Shopify Admin API adapter (roadmap)
│   ├── inventory.service.ts            # Live stock validation & caching
│   └── delivery-rules.ts               # Zone detection (Inside/Sub/Outside Dhaka) & pricing math
├── conversation/
│   ├── slot-filler.ts                  # Deterministic entity extraction (name, phone, address, zone)
│   ├── order-flow.ts                   # In-chat order booking state machine
│   └── handoff.service.ts              # Complaint & human request detection, tagging & Centrifugo alerts
├── tools/
│   └── agent-tools.ts                  # Gemini function-calling declarations
└── routes/
    └── ai-agent.routes.ts              # Settings CRUD, manual sync, pause/resume endpoints

apps/web/src/components/chat/
├── MessageHeader.tsx                   # Augmented with AI Active/Paused badge and toggle button
└── ...

tests/e2e/                              # Independent E2E Testing Suite (Tiers 1-4)
├── test-runner.ts                      # Opaque-box test runner
├── tier1-feature-coverage/             # >=5 tests per feature
├── tier2-boundary-corner/              # Boundaries (zero stock, edge phone numbers, extreme addresses)
├── tier3-pairwise-combinations/        # Combinations (Vision + Banglish + Outside Dhaka COD, etc.)
└── tier4-real-world-workloads/         # Full realistic customer chat transcripts & order sessions
```
