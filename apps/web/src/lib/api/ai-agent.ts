/**
 * AI Agent Client API
 * Manage per-connection AI instructions, persona, and settings
 */

import { fetchWithAuth } from "./client.js";

export interface ConnectionAiFaq {
  question: string;
  answer: string;
}

export interface ConnectionAiSettings {
  companyId: string;
  connectionId: string;
  connectionName?: string | null;
  phoneNumber?: string | null;
  jid?: string | null;
  status?: string;
  enabled: boolean;
  personaName: string;
  personaTone: "friendly" | "formal" | "enthusiastic";
  storeName: string;
  customInstructions: string;
  insideDhakaFee: number;
  subDhakaFee: number;
  outsideDhakaFee: number;
  outsideDhakaAdvanceRequired: boolean;
  outsideDhakaAdvanceAmount: number;
  paymentMethods: string[];
  faqs: ConnectionAiFaq[];
  updatedAt?: string | null;
}

export interface ConnectionAiOverviewItem {
  connectionId: string;
  connectionName: string | null;
  phoneNumber: string | null;
  jid: string | null;
  status: string;
  enabled: boolean;
  personaName: string;
  personaTone: "friendly" | "formal" | "enthusiastic";
  storeName: string;
  customInstructions: string;
  insideDhakaFee: number;
  subDhakaFee: number;
  outsideDhakaFee: number;
  outsideDhakaAdvanceRequired: boolean;
  outsideDhakaAdvanceAmount: number;
  faqs: ConnectionAiFaq[];
  updatedAt: string | null;
}

/**
 * Fetch AI settings and instructions for a specific WhatsApp number/connection
 */
export async function getConnectionAiSettings(
  connectionId: string,
): Promise<ConnectionAiSettings> {
  return fetchWithAuth<ConnectionAiSettings>(
    `/ai-agent/connections/${connectionId}/settings`,
  );
}

/**
 * Update AI settings and instructions for a specific WhatsApp number/connection
 */
export async function updateConnectionAiSettings(
  connectionId: string,
  settings: Partial<ConnectionAiSettings>,
): Promise<ConnectionAiSettings> {
  return fetchWithAuth<ConnectionAiSettings>(
    `/ai-agent/connections/${connectionId}/settings`,
    {
      method: "PUT",
      body: JSON.stringify(settings),
    },
  );
}

/**
 * List all WhatsApp connections with their AI configuration status
 */
export async function getConnectionAiOverview(): Promise<
  ConnectionAiOverviewItem[]
> {
  return fetchWithAuth<ConnectionAiOverviewItem[]>(
    "/ai-agent/connections/overview",
  );
}

export interface AiSimulationResult {
  replyText: string;
  detectedLang: "bangla" | "banglish" | "english" | "mixed";
  personaName: string;
  storeName: string;
  modelUsed?: string;
  latencyMs?: number;
  simulated?: boolean;
}

/**
 * Simulate an inbound customer message to test a specific WhatsApp number's AI instructions
 */
export async function simulateConnectionAiResponse(
  connectionId: string,
  message: string,
  history?: Array<{ role: "user" | "model"; content: string }>,
): Promise<AiSimulationResult> {
  return fetchWithAuth<AiSimulationResult>(
    `/ai-agent/connections/${connectionId}/test-simulate`,
    {
      method: "POST",
      body: JSON.stringify({ message, history }),
    },
  );
}
