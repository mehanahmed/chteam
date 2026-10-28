# OmniTeam AI Sales Agent: E2E Testing Infrastructure (TEST_INFRA)

## 1. Overview & Testing Philosophy

The OmniTeam AI Sales & Customer Support Agent (WATeamInbox) requires an enterprise-grade, independent **End-to-End (E2E) Testing Track** built on the **Project Pattern**. 

The testing philosophy is anchored on three foundational principles:
1. **Opaque-Box (Black-Box) Testing**: Tests validate the system strictly through its external ingress and egress interfaces. The test suite simulates incoming customer WhatsApp/Web messages and human agent UI actions, and asserts strictly on observable system outcomes: outbound customer replies, applied contact tags, created WooCommerce orders, and realtime dashboard event broadcasts.
2. **Dual-Mode Execution Architecture**:
   - **Hermetic Mock Mode (Default)**: Zero external network calls. Utilizes in-memory deterministic mocks for Google Gemini (`@google/genai`), WooCommerce REST API (v3), and NATS/WhatsApp transport. Runs in seconds on local developer machines (even when Docker is stopped) and in CI/CD pipelines.
   - **Live Staging Mode (`RUN_LIVE_E2E=1`)**: Connects to live PostgreSQL database, active NATS JetStream, staging WooCommerce store, and real Google Gemini API key to validate production environment wiring.
3. **Multi-Tier Quality Pyramid**:
   - **Tier 1: Feature Coverage**: >=5 tests per core feature (R1 to R5) verifying baseline functional correctness.
   - **Tier 2: Boundary & Corner Cases**: Edge cases (zero inventory, invalid 11-digit BD mobile numbers, ambiguous addresses, concurrent stock races).
   - **Tier 3: Cross-Feature Combinations**: Pairwise and combinatorial flows (e.g. Vision + Banglish + Outside Dhaka Advance + Out-of-Stock alternative).
   - **Tier 4: Real-World Workloads**: Full multi-turn customer purchasing sessions and transcripts.
   - **Tier 5: Adversarial Hardening (M6)**: White-box edge-case bug hunting and jailbreak/safety verification.

---

## 2. Directory Layout & Structure

The E2E test suite lives in an isolated top-level directory `tests/e2e/`, completely separated from internal service unit tests:

```
tests/e2e/
├── runner.ts                              # CLI runner & test orchestrator
├── types.ts                               # Scenario contracts, assertion types, interfaces
├── harness/
│   ├── opaque-box-harness.ts              # Unified black-box test facade
│   ├── mock-gemini.ts                     # Deterministic Gemini GenAI mock & recorder
│   ├── mock-woocommerce.ts                # In-memory WooCommerce v3 REST API simulator
│   ├── mock-channel-ingress.ts            # WhatsApp webhook & NATS message injector
│   ├── mock-database.ts                   # In-memory tenant DB state / Kysely mock
│   └── fixtures/                          # Reusable test catalog, images, customer fixtures
│       ├── sample-catalog.ts              # Test products (Polo, Panjabi, Kurti, Saree)
│       └── sample-receipts.ts             # Base64 test images (bKash receipt, product screenshot)
├── tier1-feature-coverage/                # Tier 1 (>=5 tests per feature R1-R5)
│   ├── r1-multilingual-persona.test.ts    # R1: Bangla, Banglish, English, Persona FAQ
│   ├── r2-multimodal-vision.test.ts       # R2: Screenshots, catalog matching, receipt OCR
│   ├── r3-ecommerce-sync.test.ts          # R3: Stock checks, variations, Shopify adapter
│   ├── r4-order-booking.test.ts           # R4: Slot filling, delivery zones, order booking
│   └── r5-handoff-safety.test.ts          # R5: Complaint detection, tags, UI pause/resume
├── tier2-boundary-corner/                 # Tier 2: Boundaries & edge cases
├── tier3-pairwise-combinations/           # Tier 3: Pairwise cross-feature interactions
├── tier4-real-world-workloads/            # Tier 4: Multi-turn realistic chat transcripts
└── reports/                               # Generated run summaries & TEST_READY.md artifacts
```

---

## 3. Test Runner & Execution Scripts

### 3.1 Execution Commands

The E2E suite supports both native Bun testing and a custom CLI runner with rich formatting:

| Command | Description |
|---------|-------------|
| `bun test tests/e2e` | Run all E2E test tiers via Bun native runner |
| `bun test tests/e2e/tier1-feature-coverage` | Run only Tier 1 feature coverage tests |
| `bun run tests/e2e/runner.ts` | Run tests via custom CLI runner with tabular summary |
| `bun run tests/e2e/runner.ts --tier=1` | Filter execution to Tier 1 |
| `bun run tests/e2e/runner.ts --feature=R1` | Filter execution to Feature R1 |
| `bun run tests/e2e/runner.ts --report` | Generate `TEST_READY.md` and JSON execution report |
| `RUN_LIVE_E2E=1 bun test tests/e2e` | Run tests in Live Staging Mode against live services |

### 3.2 Root `package.json` Integration

Add the following npm scripts to root `package.json`:
```json
{
  "scripts": {
    "test:e2e": "bun test tests/e2e",
    "test:e2e:tier1": "bun test tests/e2e/tier1-feature-coverage",
    "test:e2e:tier2": "bun test tests/e2e/tier2-boundary-corner",
    "test:e2e:tier3": "bun test tests/e2e/tier3-pairwise-combinations",
    "test:e2e:tier4": "bun test tests/e2e/tier4-real-world-workloads",
    "test:e2e:runner": "bun run tests/e2e/runner.ts"
  }
}
```

---

## 4. Opaque-Box Testing Interface Contract

The testing suite interacts with the system strictly through `OpaqueBoxHarness`:

```typescript
// tests/e2e/types.ts

export interface CustomerMessageInput {
  senderPhone: string; // e.g. "8801711223344"
  senderName?: string;
  text?: string;
  media?: {
    mimeType: string;
    base64Data: string;
    fileName?: string;
  };
  timestamp?: number;
}

export interface OutboundMessageRecord {
  recipientJid: string;
  text: string;
  mediaUrl?: string;
  timestamp: Date;
}

export interface RecordedWooCommerceOrder {
  id: number;
  paymentMethod: string;
  billing: {
    first_name: string;
    phone: string;
    address_1: string;
    city: string;
  };
  shipping: {
    first_name: string;
    phone: string;
    address_1: string;
    city: string;
  };
  line_items: Array<{
    product_id: number;
    variation_id?: number;
    quantity: number;
  }>;
  shipping_lines: Array<{
    method_id: string;
    method_title: string;
    total: string;
  }>;
  customer_note?: string;
  status: string;
  total: string;
  meta_data: Array<{ key: string; value: string }>;
}

export interface OpaqueBoxHarness {
  // Lifecycle
  initialize(): Promise<void>;
  reset(): Promise<void>;
  shutdown(): Promise<void>;

  // Customer Ingress Simulation
  sendCustomerWhatsAppMessage(input: CustomerMessageInput): Promise<void>;

  // Human Agent Actions in OmniTeam Web Inbox
  assignContactToHuman(phone: string, agentUserId: string): Promise<void>;
  sendAgentManualReply(phone: string, agentUserId: string, text: string): Promise<void>;
  setAiPauseState(phone: string, paused: boolean): Promise<void>;

  // Observable External Outcomes & Assertions
  getOutboundReplies(phone: string): Promise<OutboundMessageRecord[]>;
  getLastOutboundReply(phone: string): Promise<OutboundMessageRecord | null>;
  getContactTags(phone: string): Promise<string[]>;
  getCreatedOrders(): Promise<RecordedWooCommerceOrder[]>;
  getLastCreatedOrder(): Promise<RecordedWooCommerceOrder | null>;
  getBroadcastEvents(): Promise<Array<{ type: string; payload: any }>>;

  // In-Memory Catalog & Mock Controls
  setStoreCatalog(products: any[]): void;
  setProductStock(productId: number, variationId: number | null, quantity: number, status: string): void;
}
```

---

## 5. Declarative Test Case Format

Each test scenario is structured as a declarative, self-documenting object:

```typescript
export interface E2ETestCase {
  id: string; // e.g. "T1-R1-01"
  name: string;
  tier: 1 | 2 | 3 | 4 | 5;
  feature: "R1" | "R2" | "R3" | "R4" | "R5" | "CROSS";
  description: string;
  steps: Array<{
    step: number;
    description: string;
    customerAction?: CustomerMessageInput;
    agentAction?: {
      type: "manual_send" | "assign" | "pause" | "resume";
      agentId: string;
      text?: string;
    };
    expectations: {
      agentShouldReply: boolean;
      replyMustContain?: string[];
      replyPattern?: RegExp;
      languageDetected?: "bangla" | "banglish" | "english" | "code_mixed";
      tagsExpected?: {
        mustInclude?: string[];
        mustNotInclude?: string[];
      };
      orderExpected?: {
        created: boolean;
        deliveryZone?: "inside_dhaka" | "sub_dhaka" | "outside_dhaka";
        deliveryFee?: number;
        total?: number;
        status?: string;
      };
      realtimeEventExpected?: {
        type: string;
        payloadCheck?: (payload: any) => boolean;
      };
    };
  }>;
}
```

---

## 6. Tier 1: Feature Coverage Specifications (R1 - R5)

Tier 1 contains **25 comprehensive test scenarios** (5 tests per requirement R1 to R5):

### Feature R1: Multilingual Conversational Engine & Persona
- **T1-R1-01: Banglish In-Stock Product & Price Inquiry**
  - *Input*: `"bhai black polo shirt er price koto? size L hobe?"`
  - *Expected Reply*: Polite Banglish mirroring (`"Ji bhaiya, black polo shirt ache..."`), states price `৳850`, confirms Size L availability.
  - *Tag Invariants*: No complaint or paused tags.
- **T1-R1-02: Bengali Script Store Greeting & Business Hours**
  - *Input*: `"আসসালামু আলাইকুম, আপনাদের দোকান কি এখন খোলা আছে? শোরুম কোথায়?"`
  - *Expected Reply*: Bengali script reply (`"ওয়ালাইকুম আসসালাম..."`), lists store hours (10:00 AM - 10:00 PM) and Banani outlet address.
- **T1-R1-03: English Delivery Fee & SLA Inquiry**
  - *Input*: `"Hello! How much is the delivery charge for Dhanmondi, Dhaka? How long will it take?"`
  - *Expected Reply*: English reply, identifies Inside Dhaka `৳60`, SLA 24-48 hours.
- **T1-R1-04: Code-Mixed Banglish/English Return Policy & Fabric FAQ**
  - *Input*: `"Eta ki 100% cotton fabric? Ar delivery pawar por return kora jabe?"`
  - *Expected Reply*: Code-mixed response confirming 100% combed cotton and 7-day hassle-free return policy.
- **T1-R1-05: Dynamic Language Mirroring Transition**
  - *Step 1*: Customer speaks Banglish (`"hi bhaiya"`). Agent mirrors in Banglish.
  - *Step 2*: Customer switches to Bengali script (`"আপনাদের ক্যাশ অন ডেলিভারি আছে?"`).
  - *Expected Reply*: Agent smoothly switches response to Bengali script confirming COD availability.

### Feature R2: Multimodal Vision & Image Recognition
- **T1-R2-01: Merchant Post Screenshot with Text Overlay & Price**
  - *Input*: Screenshot of Facebook post showing "Premium Black Panjabi - ৳1800".
  - *Expected*: OCR extracts title & price; matches catalog SKU `PANJ-BLK-01`; replies with sizes (40, 42, 44) and stock status.
- **T1-R2-02: Garment Photo without Text (Visual Catalog Match)**
  - *Input*: Raw photo of maroon floral kurti without captions.
  - *Expected*: Visual feature extraction identifies category "Women / Kurti", color "Maroon / Floral"; retrieves catalog match; asks customer for desired size.
- **T1-R2-03: bKash Mobile Transfer Receipt OCR Extraction**
  - *Input*: Screenshot of bKash payment confirmation (TrxID: `9K87LM54`, Amount: `৳120`, Sender: `01711...`).
  - *Expected*: Flags `is_payment_receipt: true`; extracts TrxID `9K87LM54`, amount 120 BDT; confirms advance payment receipt in chat.
- **T1-R2-04: Non-Catalog Product Image Rejection**
  - *Input*: Photo of an electronic smartwatch sent to apparel store.
  - *Expected*: Detects item is not in catalog; politely informs customer that electronics are not carried; offers link to current fashion catalog.
- **T1-R2-05: Low-Resolution / Blurry Image Disambiguation**
  - *Input*: Highly pixelated / blurry image where product confidence is < 0.50.
  - *Expected*: System recognizes visual uncertainty; asks customer politely for a clearer photo or product name.

### Feature R3: WooCommerce-First E-Commerce Sync
- **T1-R3-01: Live In-Stock Verification Before Ordering**
  - *Input*: Customer chooses Variation #105 (`stock_quantity: 4`, `instock`).
  - *Expected*: Queries WooCommerce `GET /products/:id/variations/105`; confirms item is purchasable.
- **T1-R3-02: Out-of-Stock Prevention & Alternative Suggestion**
  - *Input*: Customer requests Variation #106 (`stock_quantity: 0`, `outofstock`).
  - *Expected*: Intercepts out-of-stock condition; refuses order placement; suggests available in-stock sizes/colors.
- **T1-R3-03: Incremental Catalog Sync & Stale Cache Invalidation**
  - *Setup*: WooCommerce product price updated from `৳1200` to `৳999`. Sync hook triggered.
  - *Expected*: Customer query immediately returns `৳999`, proving cache invalidation.
- **T1-R3-04: Variable Product Multi-Attribute Resolution**
  - *Input*: Customer specifies "Blue color size XL".
  - *Expected*: Matches attribute matrix `Color=Blue` and `Size=XL` to exact variation ID; retrieves variation-specific price.
- **T1-R3-05: Unified Platform Adapter Conformance (Shopify Roadmap)**
  - *Action*: Execute conformance test against `ECommercePlatformAdapter` implementation.
  - *Expected*: Verifies Shopify adapter conforms to `syncProducts`, `checkStock`, and `createOrder` contracts.

### Feature R4: In-Chat Order Collection & Placement
- **T1-R4-01: Inside Dhaka COD Order Booking Complete Path**
  - *Input*: Name: "Tanvir Ahmed", Phone: "01711223344", Address: "House 12, Road 4, Dhanmondi, Dhaka", Item: 1x Black Panjabi (৳1800).
  - *Expected*: Detects `inside_dhaka` (৳60 delivery); Subtotal ৳1800 + Delivery ৳60 = ৳1860; calls WooCommerce `POST /orders`; receives Order #9842; returns confirmation summary with Order ID to customer.
- **T1-R4-02: Conversational Slot Filling for Missing Phone and Address**
  - *Step 1*: Customer sends name and item.
  - *Step 2*: AI prompts conversationally for 11-digit phone number and delivery address.
  - *Step 3*: Customer provides details; AI validates 11-digit format before creating order.
- **T1-R4-03: Sub-Dhaka Zone Detection (Gazipur/Savar/Narayanganj)**
  - *Input*: Shipping address in "Savar Bazar, Savar".
  - *Expected*: Classifies zone as `sub_dhaka`; applies `৳100` delivery charge; WooCommerce order shipping line shows `Sub-Dhaka Delivery` total `100.00`.
- **T1-R4-04: Outside Dhaka Advance Payment Guard (RTO Loss Prevention)**
  - *Input*: Shipping address in "Chittagong GEC Circle" (`outside_dhaka`).
  - *Expected*: Applies `৳120` delivery fee; notifies customer that ৳120 courier advance via bKash/Nagad is required; creates order in `pending` / `on-hold` status with private note.
- **T1-R4-05: Coupon Code Calculation Engine**
  - *Input*: Customer applies coupon `"WELCOME10"` (10% off) on ৳2000 subtotal in Dhaka.
  - *Expected*: Subtotal: ৳2000, Discount: ৳200, Delivery: ৳60, Grand Total: ৳1860; order payload contains coupon lines.

### Feature R5: Complaint Detection & Smooth Human Handoff
- **T1-R5-01: Dissatisfaction & Damage Complaint Detection**
  - *Input*: `"Product vanga asche, ekdom baje quality, tk ferot den!"`
  - *Expected*: Sentiment engine flags complaint; adds tags `ai-paused`, `needs-human`, and `complaint`; emits Centrifugo alert; sends empathetic apology message; AI falls silent.
- **T1-R5-02: Explicit Human Agent Request Detection**
  - *Input*: `"Bhai kono manush er sathe kotha bolte chai, agent k daken"`
  - *Expected*: Flags explicit human request; tags `ai-paused` and `needs-human`; sends reassurance message that human agent is taking over.
- **T1-R5-03: Agent Assignment Circuit Breaker (Pre-Reply Interception)**
  - *Setup*: Human agent claims contact in OmniTeam (`contact_assignments`). Customer sends message `"Bhaiya stock ache?"`.
  - *Expected*: `shouldSuppressAiReply` returns `true`; AI generates no reply; customer remains exclusively with assigned human agent.
- **T1-R5-04: Manual Agent Send Interception**
  - *Setup*: Customer chats with AI. Human agent types manual reply from web inbox.
  - *Expected*: Interceptor detects manual send (`sent_by_user_id IS NOT NULL`); automatically attaches `ai-paused`; subsequent customer queries are suppressed.
- **T1-R5-05: Chat Header UI Pause & Resume Lifecycle**
  - *Step 1*: Human agent triggers Pause AI via web UI (`PATCH /api/ai-agent/contacts/:id`). Tag `ai-paused` added; AI ceases responding.
  - *Step 2*: Human agent clicks Resume AI. Tags `ai-paused` and `needs-human` removed; Centrifugo event broadcasted; AI resumes autonomous replies on subsequent inbound messages.

---

## 7. Flake Prevention & Determinism Invariants

To guarantee 100% test reproducibility across all environments:
1. **Zero External Network Dependencies**: Hermetic mode intercepts all HTTP requests. Any unmocked external network call throws an immediate assertion error.
2. **Deterministic Time**: The harness pins the clock using Bun's mock time (`setSystemTime`) or explicit ISO timestamps.
3. **No Arbitrary `sleep()`**: All asynchronous event assertions use bounded polling (`waitForCondition({ timeoutMs: 2000, intervalMs: 20 })`).
4. **Isolated Tenant State**: Each test execution creates a clean, ephemeral tenant workspace identifier (`test_tenant_<uuid>`) to prevent state leakage between runs.
5. **Idempotent Order Creation**: WooCommerce order bookings include deterministic idempotency keys.

---

## 8. Gate Integration & `TEST_READY.md` Publication Protocol

When all test tiers pass:
1. The test runner executes:
   ```bash
   bun run tests/e2e/runner.ts --report
   ```
2. The runner writes test metrics and execution logs to `tests/e2e/reports/summary.json`.
3. If pass rate = 100% and Tier 1-4 coverage requirements are satisfied, the runner writes `TEST_READY.md` to the project root, signaling to the orchestrator that the test infrastructure is validated and ready for Milestone 6 final gate acceptance.
