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

export interface WorkspaceAiSettings {
  companyId: string;
  isMuted: boolean;
  hasCustomApiKey: boolean;
  geminiApiKeyMasked: string;
  systemHasApiKey: boolean;
  primaryModel: string;
  fallbackModel: string;
  updatedAt: string | null;
}

export interface UpdateWorkspaceAiSettingsInput {
  isMuted?: boolean;
  geminiApiKey?: string | null;
  primaryModel?: string;
  fallbackModel?: string;
}

export interface TestApiKeyResult {
  valid: boolean;
  message?: string;
  error?: string;
  modelUsed?: string;
  latencyMs?: number;
}

/**
 * Fetch workspace-level AI settings (mute status, custom API key, models)
 */
export async function getWorkspaceAiSettings(): Promise<WorkspaceAiSettings> {
  return fetchWithAuth<WorkspaceAiSettings>("/ai-agent/settings");
}

/**
 * Update workspace-level AI settings (mute status, custom API key, models)
 */
export async function updateWorkspaceAiSettings(
  input: UpdateWorkspaceAiSettingsInput,
): Promise<WorkspaceAiSettings> {
  return fetchWithAuth<WorkspaceAiSettings>("/ai-agent/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/**
 * Instantly toggle or set workspace AI mute
 */
export async function toggleWorkspaceAiMute(
  isMuted: boolean,
): Promise<{ success: boolean; isMuted: boolean }> {
  return fetchWithAuth<{ success: boolean; isMuted: boolean }>(
    "/ai-agent/toggle-mute",
    {
      method: "POST",
      body: JSON.stringify({ isMuted }),
    },
  );
}

export interface GeminiModelOption {
  id: string;
  name: string;
  description: string;
  isRecommended: boolean;
}

/**
 * Fetch available models from Gemini
 */
export async function getAvailableGeminiModels(
  apiKey?: string,
): Promise<{ models: GeminiModelOption[] }> {
  return fetchWithAuth<{ models: GeminiModelOption[] }>("/ai-agent/models", {
    method: "POST",
    body: JSON.stringify({ apiKey: apiKey?.trim() || undefined }),
  });
}

/**
 * Test a Gemini API key
 */
export async function testGeminiApiKey(
  apiKey: string,
  model?: string,
): Promise<TestApiKeyResult> {
  return fetchWithAuth<TestApiKeyResult>("/ai-agent/test-api-key", {
    method: "POST",
    body: JSON.stringify({ apiKey, model }),
  });
}

/**
 * Pause AI autonomous replies for a specific contact
 */
export async function pauseContactAi(
  contactId: string,
  reason?: string,
): Promise<{ success: boolean; isPaused: boolean; tags: string[] }> {
  return fetchWithAuth<{ success: boolean; isPaused: boolean; tags: string[] }>(
    `/ai-agent/contacts/${contactId}/pause`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}

/**
 * Resume AI autonomous replies for a specific contact
 */
export async function resumeContactAi(
  contactId: string,
): Promise<{ success: boolean; isPaused: boolean; tags: string[] }> {
  return fetchWithAuth<{ success: boolean; isPaused: boolean; tags: string[] }>(
    `/ai-agent/contacts/${contactId}/resume`,
    {
      method: "POST",
    },
  );
}

/**
 * Get AI status for a specific contact
 */
export async function getContactAiStatus(contactId: string): Promise<{
  isPaused: boolean;
  tags: string[];
  reason?: string;
}> {
  return fetchWithAuth<{
    isPaused: boolean;
    tags: string[];
    reason?: string;
  }>(`/ai-agent/contacts/${contactId}/status`);
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
  clientName?: string,
): Promise<AiSimulationResult> {
  return fetchWithAuth<AiSimulationResult>(
    `/ai-agent/connections/${connectionId}/test-simulate`,
    {
      method: "POST",
      body: JSON.stringify({ message, history, clientName }),
    },
  );
}
