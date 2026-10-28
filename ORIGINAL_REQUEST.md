# Original User Request

## 2026-10-26T05:43:06Z

Build an enterprise-grade AI Sales & Customer Support Agent for OmniTeam (WATeamInbox), modeled after LazyChat.io, powered by **Google Gemini 1.5/2.0 Flash**. The agent will provide 24/7 autonomous selling, product screenshot recognition, Banglish/Bangla/English conversational intelligence, WooCommerce-first real-time inventory sync (with Shopify support), automated in-chat order booking, and seamless human agent handoff.

Working directory: c:/Transfer/wateaminbox
Integrity mode: development

## Requirements

### R1. Multilingual Conversational Engine & Persona (Bangla / Banglish / English)
- Use Google Gemini (1.5/2.0 Flash) to understand and reply fluently to customer queries in English, Bangla, and Banglish (e.g. "bhai red color ta hobe?", "delivery charge koto?", "order confirm koren").
- Configurable merchant persona, greeting messages, business hours, FAQ knowledge base, and tone of voice.

### R2. Product Screenshot & Image Recognition (Multimodal Vision)
- Process incoming product images sent by customers across WhatsApp, Telegram, or Facebook/Instagram.
- Pass customer photos to Gemini Vision alongside the merchant catalog to identify the product, price, variant (size/color), and availability.

### R3. WooCommerce-First E-Commerce Sync (with Shopify Roadmap)
- Two-way sync with WooCommerce REST API (and Shopify Admin API) for products, variations, categories, and inventory.
- Real-time stock verification to prevent recommending or taking orders for out-of-stock items.

### R4. Automated In-Chat Order Collection & Placement
- Conversational flow to collect recipient name, phone number, full shipping address, and delivery zone (inside/outside Dhaka or city).
- Calculate totals (item price + delivery charge - discounts) and create live orders directly in WooCommerce.

### R5. Complaint Detection & Smooth Human Handoff
- Sentiment and intent analysis to detect unhappy customers, return/refund requests, or inquiries outside agent scope.
- Automatically flag conversations with labels/tags (`ai-paused`, `needs-human`, `complaint`), stop AI autoreplies, and alert human agents in OmniTeam inbox.

## Acceptance Criteria

### Language & Intent Precision
- [ ] Correctly parses Banglish and Bangla product queries with high accuracy.
- [ ] Distinguishes between inquiries, price checks, complaints, and purchase intentions.

### Vision & Catalog Matching
- [ ] When a customer sends a product screenshot, accurately identifies the item from the merchant's catalog.
- [ ] Returns exact pricing, active variant options, and stock status.

### Order Processing
- [ ] Successfully collects full recipient details and creates order in WooCommerce with customer info, line items, and delivery fees.
- [ ] Sends customer an order confirmation summary with order ID in chat.

### Inbox Collaboration & Safety
- [ ] AI stops responding immediately when an agent assigns the chat or sends a manual message.
- [ ] Human agents can resume or pause AI at any time from the chat header.
