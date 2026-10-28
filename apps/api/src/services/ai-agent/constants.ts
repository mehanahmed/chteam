/**
 * Shared constants for the OmniTeam AI Agent
 */

// Well-known system user UUID representing the autonomous AI Agent in audit logs and sent_by_user_id
export const SYSTEM_AI_USER_ID = "00000000-0000-0000-0000-0000000000a1";

// Default Gemini Models
export const DEFAULT_PRIMARY_GEMINI_MODEL = "gemini-2.0-flash";
export const DEFAULT_FALLBACK_GEMINI_MODEL = "gemini-1.5-flash";

// Default Delivery Zones & Pricing (BDT)
export const DEFAULT_DELIVERY_FEES = {
  INSIDE_DHAKA: 80,
  SUB_DHAKA: 120,
  OUTSIDE_DHAKA: 150,
} as const;

export const DEFAULT_OUTSIDE_DHAKA_ADVANCE_AMOUNT = 120;

// Tag Names for Circuit Breakers and Collaboration
export const AI_TAGS = {
  AI_PAUSED: "ai-paused",
  NEEDS_HUMAN: "needs-human",
  COMPLAINT: "complaint",
  ORDER_CONFIRMED: "order-confirmed",
} as const;
