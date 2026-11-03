import {
  AlertCircle,
  Bot,
  Check,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { WhatsAppMark } from "@/components/connections/channel-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type ConnectionAiOverviewItem,
  type GeminiModelOption,
  type WorkspaceAiSettings,
  getAvailableGeminiModels,
  getConnectionAiOverview,
  getConnectionAiSettings,
  getWorkspaceAiSettings,
  testGeminiApiKey,
  toggleWorkspaceAiMute,
  updateConnectionAiSettings,
  updateWorkspaceAiSettings,
} from "@/lib/api/ai-agent";
import { cn } from "@/lib/utils";

function parseCustomInstructions(raw: string): {
  positive: string;
  negative: string;
} {
  if (!raw) return { positive: "", negative: "" };

  const negativeMarkerRegex =
    /###\s*(?:NEGATIVE GUARDRAILS|STRICT AVOID LIST|DO NOT DO|WHAT NOT TO DO)[^\n]*\n([\s\S]*)/i;
  const positiveMarkerRegex =
    /###\s*(?:POSITIVE DIRECTIVES|WHAT TO DO|GUIDELINES)[^\n]*\n([\s\S]*?)(?=###\s*(?:NEGATIVE GUARDRAILS|STRICT AVOID LIST|DO NOT DO|WHAT NOT TO DO)|$)/i;

  const negativeMatch = raw.match(negativeMarkerRegex);
  const positiveMatch = raw.match(positiveMarkerRegex);

  if (positiveMatch || negativeMatch) {
    return {
      positive: (positiveMatch
        ? positiveMatch[1]
        : raw.replace(negativeMarkerRegex, "")
      ).trim(),
      negative: (negativeMatch ? negativeMatch[1] : "").trim(),
    };
  }

  return { positive: raw.trim(), negative: "" };
}

function serializeCustomInstructions(
  positive: string,
  negative: string,
): string {
  const parts: string[] = [];
  if (positive.trim()) {
    parts.push(
      `### POSITIVE DIRECTIVES (What AI MUST do):\n${positive.trim()}`,
    );
  }
  if (negative.trim()) {
    parts.push(
      `### NEGATIVE GUARDRAILS (What AI MUST NOT do / Strict Avoid List):\n${negative.trim()}`,
    );
  }
  return parts.join("\n\n");
}

function formatFaqsToText(
  faqs: Array<{ question: string; answer: string }>,
): string {
  if (!faqs || faqs.length === 0) return "";
  return faqs
    .map((f) => `Q: ${f.question.trim()}\nA: ${f.answer.trim()}`)
    .join("\n\n");
}

function parseTextToFaqs(
  raw: string,
): Array<{ question: string; answer: string }> {
  if (!raw || !raw.trim()) return [];

  const result: Array<{ question: string; answer: string }> = [];

  const regex =
    /(?:^|\n)\s*(?:Q|Question)\s*:\s*([^\n]+(?:\n(?!\s*(?:A|Answer|Q|Question)\s*:)[^\n]+)*)\s*\n\s*(?:A|Answer)\s*:\s*([^\n]+(?:\n(?!\s*(?:Q|Question)\s*:)[^\n]+)*)/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const q = match[1].trim();
    const a = match[2].trim();
    if (q && a) {
      result.push({ question: q, answer: a });
    }
  }

  if (result.length > 0) {
    return result;
  }

  const lines = raw.split("\n");
  let currentQ = "";
  let currentA = "";
  let mode: "q" | "a" | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^(?:Q|Question)\s*:/i.test(line)) {
      if (currentQ && currentA) {
        result.push({ question: currentQ.trim(), answer: currentA.trim() });
        currentQ = "";
        currentA = "";
      }
      currentQ = line.replace(/^(?:Q|Question)\s*:/i, "").trim();
      mode = "q";
    } else if (/^(?:A|Answer)\s*:/i.test(line) && currentQ) {
      currentA = line.replace(/^(?:A|Answer)\s*:/i, "").trim();
      mode = "a";
    } else if (line) {
      if (mode === "a") {
        currentA += `\n${line}`;
      } else if (mode === "q") {
        currentQ += ` ${line}`;
      }
    }
  }

  if (currentQ && currentA) {
    result.push({ question: currentQ.trim(), answer: currentA.trim() });
  }

  return result;
}

export function AiAgentSettings() {
  const [connections, setConnections] = useState<ConnectionAiOverviewItem[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Workspace-level AI Settings
  const [workspaceSettings, setWorkspaceSettings] =
    useState<WorkspaceAiSettings | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [primaryModel, setPrimaryModel] = useState("gemini-2.0-flash");
  const [fallbackModel, setFallbackModel] = useState("gemini-1.5-flash");
  const [availableModels, setAvailableModels] = useState<GeminiModelOption[]>([
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      description: "Next-generation speed and multimodal capabilities",
      isRecommended: true,
    },
    {
      id: "gemini-1.5-flash",
      name: "Gemini 1.5 Flash",
      description: "Fast and versatile standard model with high rate limits",
      isRecommended: false,
    },
    {
      id: "gemini-1.5-pro",
      name: "Gemini 1.5 Pro",
      description: "Advanced reasoning and large context understanding",
      isRecommended: false,
    },
    {
      id: "gemini-2.0-flash-lite",
      name: "Gemini 2.0 Flash Lite",
      description: "Lightweight and cost-effective model optimized for high throughput",
      isRecommended: false,
    },
  ]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testKeyResult, setTestKeyResult] = useState<{
    valid?: boolean;
    message?: string;
    error?: string;
    latencyMs?: number;
  } | null>(null);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isTogglingMute, setIsTogglingMute] = useState(false);

  // Line Form State
  const [enabled, setEnabled] = useState(true);
  const [personaName, setPersonaName] = useState("Maya");
  const [personaTone, setPersonaTone] = useState<
    "friendly" | "formal" | "enthusiastic"
  >("friendly");
  const [storeName, setStoreName] = useState("");
  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [faqText, setFaqText] = useState("");

  const [insideDhakaFee, setInsideDhakaFee] = useState<number>(80);
  const [subDhakaFee, setSubDhakaFee] = useState<number>(120);
  const [outsideDhakaFee, setOutsideDhakaFee] = useState<number>(150);
  const [outsideDhakaAdvanceRequired, setOutsideDhakaAdvanceRequired] =
    useState(true);
  const [outsideDhakaAdvanceAmount, setOutsideDhakaAdvanceAmount] =
    useState<number>(120);

  const [activeTab, setActiveTab] = useState<"instructions" | "faqs">(
    "instructions",
  );

  // Load workspace AI settings & connection overview on mount
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    Promise.all([
      getWorkspaceAiSettings().catch(() => null),
      getConnectionAiOverview().catch(() => []),
      getAvailableGeminiModels().catch(() => null),
    ])
      .then(([wsSettings, connList, modelsRes]) => {
        if (!isMounted) return;
        if (modelsRes?.models && modelsRes.models.length > 0) {
          setAvailableModels(modelsRes.models);
        }
        if (wsSettings) {
          setWorkspaceSettings(wsSettings);
          setIsMuted(wsSettings.isMuted);
          setPrimaryModel(wsSettings.primaryModel || "gemini-2.0-flash");
          setFallbackModel(wsSettings.fallbackModel || "gemini-1.5-flash");
          if (wsSettings.hasCustomApiKey) {
            setApiKeyInput(wsSettings.geminiApiKeyMasked);
          }
        }
        if (connList && connList.length > 0) {
          setConnections(connList);
          setSelectedConnectionId(connList[0].connectionId);
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Load selected connection settings
  useEffect(() => {
    if (!selectedConnectionId) return;

    let isMounted = true;
    getConnectionAiSettings(selectedConnectionId)
      .then((settings) => {
        if (!isMounted) return;
        setEnabled(settings.enabled ?? true);
        setPersonaName(settings.personaName || "Maya");
        setPersonaTone(settings.personaTone || "friendly");
        setStoreName(settings.storeName || "");

        const { positive, negative } = parseCustomInstructions(
          settings.customInstructions || "",
        );
        setPositivePrompt(positive);
        setNegativePrompt(negative);

        setInsideDhakaFee(settings.insideDhakaFee ?? 80);
        setSubDhakaFee(settings.subDhakaFee ?? 120);
        setOutsideDhakaFee(settings.outsideDhakaFee ?? 150);
        setOutsideDhakaAdvanceRequired(
          settings.outsideDhakaAdvanceRequired ?? true,
        );
        setOutsideDhakaAdvanceAmount(settings.outsideDhakaAdvanceAmount ?? 120);

        setFaqText(formatFaqsToText(settings.faqs || []));
        setIsDirty(false);
      })
      .catch((err) => {
        console.error("Failed to load line AI settings:", err);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedConnectionId]);

  const handleFieldChange = () => {
    setIsDirty(true);
  };

  const detectedFaqs = useMemo(() => {
    return parseTextToFaqs(faqText);
  }, [faqText]);

  // Master Mute / Unmute
  const handleToggleMute = async () => {
    setIsTogglingMute(true);
    const nextMuted = !isMuted;
    try {
      await toggleWorkspaceAiMute(nextMuted);
      setIsMuted(nextMuted);
      setWorkspaceSettings((prev) =>
        prev ? { ...prev, isMuted: nextMuted } : null,
      );
      toast.success(
        nextMuted
          ? "AI is now MUTED for all chats in this workspace."
          : "AI is now UNMUTED and active for this workspace.",
      );
    } catch (err) {
      console.error("Failed to toggle AI mute:", err);
      toast.error("Failed to update AI mute status.");
    } finally {
      setIsTogglingMute(false);
    }
  };

  // Refresh or load dynamic models from Gemini
  const handleRefreshModels = async (customKey?: string) => {
    setIsLoadingModels(true);
    try {
      const key =
        customKey ??
        (apiKeyInput.includes("...") ? undefined : apiKeyInput.trim());
      const res = await getAvailableGeminiModels(key || undefined);
      if (res.models && res.models.length > 0) {
        setAvailableModels(res.models);
        toast.success(`Loaded ${res.models.length} Gemini models!`);
      }
    } catch (err) {
      console.error("Failed to load Gemini models:", err);
      toast.error("Could not load dynamic models, using standard list.");
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Test API Key
  const handleTestApiKey = async () => {
    const keyToTest = apiKeyInput.trim();
    if (!keyToTest || keyToTest.includes("...")) {
      toast.error("Please enter a new or complete Gemini API key to test.");
      return;
    }
    setIsTestingKey(true);
    setTestKeyResult(null);
    try {
      const res = await testGeminiApiKey(keyToTest, primaryModel);
      setTestKeyResult(res);
      if (res.valid) {
        toast.success(res.message || "Gemini API key is verified and working!");
        if (res.models && res.models.length > 0) {
          setAvailableModels(res.models);
        }
        if (res.modelUsed && res.modelUsed !== primaryModel) {
          setPrimaryModel(res.modelUsed);
        }
      } else {
        toast.error(res.error || "Gemini API key validation failed.");
        if (res.models && res.models.length > 0) {
          setAvailableModels(res.models);
        }
      }
    } catch (err: any) {
      setTestKeyResult({ valid: false, error: err.message || "Network test error" });
      toast.error("Failed to reach Gemini API. Please check your key.");
    } finally {
      setIsTestingKey(false);
    }
  };

  // Save API Key
  const handleSaveApiKey = async () => {
    setIsSavingKey(true);
    try {
      const keyToSave = apiKeyInput.trim();
      const updated = await updateWorkspaceAiSettings({
        geminiApiKey: keyToSave.includes("...") ? undefined : keyToSave || null,
        primaryModel,
        fallbackModel,
      });
      setWorkspaceSettings(updated);
      setApiKeyInput(updated.geminiApiKeyMasked || "");
      setTestKeyResult(null);
      toast.success("AI API key and model configuration saved!");
    } catch (err) {
      console.error("Failed to save AI API key:", err);
      toast.error("Failed to save AI configuration.");
    } finally {
      setIsSavingKey(false);
    }
  };

  // Clear Custom API Key
  const handleClearApiKey = async () => {
    setIsSavingKey(true);
    try {
      const updated = await updateWorkspaceAiSettings({
        geminiApiKey: null,
      });
      setWorkspaceSettings(updated);
      setApiKeyInput("");
      setTestKeyResult(null);
      toast.success("Custom API key removed. Reverted to system environment key.");
    } catch (err) {
      console.error("Failed to remove custom API key:", err);
      toast.error("Failed to remove API key.");
    } finally {
      setIsSavingKey(false);
    }
  };

  // Save Line-specific Instructions & FAQs
  const handleSave = async () => {
    if (!selectedConnectionId) return;

    const validFaqs = parseTextToFaqs(faqText);
    const combinedInstructions = serializeCustomInstructions(
      positivePrompt,
      negativePrompt,
    );

    setSaving(true);
    try {
      await updateConnectionAiSettings(selectedConnectionId, {
        enabled,
        personaName: personaName.trim() || "Maya",
        personaTone,
        storeName: storeName.trim(),
        customInstructions: combinedInstructions,
        insideDhakaFee: Number(insideDhakaFee) || 0,
        subDhakaFee: Number(subDhakaFee) || 0,
        outsideDhakaFee: Number(outsideDhakaFee) || 0,
        outsideDhakaAdvanceRequired,
        outsideDhakaAdvanceAmount: Number(outsideDhakaAdvanceAmount) || 0,
        faqs: validFaqs,
      });

      setConnections((prev) =>
        prev.map((c) =>
          c.connectionId === selectedConnectionId
            ? {
                ...c,
                enabled,
                personaName: personaName.trim() || "Maya",
                personaTone,
                storeName: storeName.trim(),
                customInstructions: combinedInstructions,
                insideDhakaFee: Number(insideDhakaFee) || 0,
                subDhakaFee: Number(subDhakaFee) || 0,
                outsideDhakaFee: Number(outsideDhakaFee) || 0,
                outsideDhakaAdvanceRequired,
                outsideDhakaAdvanceAmount: Number(outsideDhakaAdvanceAmount) || 0,
                faqs: validFaqs,
              }
            : c,
        ),
      );

      setIsDirty(false);
      toast.success(
        `Line instructions & ${validFaqs.length} Q&A pairs saved successfully!`,
      );
    } catch (err) {
      console.error("Failed to save line settings:", err);
      toast.error("Failed to save line configuration. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !workspaceSettings) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-[#dce3de] bg-white p-6 dark:border-dark-border dark:bg-dark-elevated">
        <Loader2 className="h-8 w-8 animate-spin text-[#0b7a55]" />
        <p className="text-sm font-medium text-[#65736d] dark:text-dark-text-secondary">
          Loading AI Agent settings...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Master Workspace AI Mute / Unmute Control */}
      <div
        className={cn(
          "rounded-2xl border p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] sm:p-6 transition-colors",
          isMuted
            ? "border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20"
            : "border-[#dce3de] bg-white dark:border-dark-border dark:bg-dark-elevated",
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm",
                isMuted
                  ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-400",
              )}
            >
              {isMuted ? (
                <VolumeX className="h-6 w-6" />
              ) : (
                <Volume2 className="h-6 w-6" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-dark-text-primary">
                  Master AI Assistant Status
                </h3>
                <Badge
                  variant="outline"
                  className={cn(
                    "border-0 px-2.5 py-0.5 text-xs font-semibold",
                    isMuted
                      ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                  )}
                >
                  {isMuted
                    ? "🔴 All AI Replies Muted"
                    : "🟢 AI Active & Responding"}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-[#65736d] dark:text-dark-text-secondary">
                {isMuted
                  ? "AI autonomous messages are currently muted across all WhatsApp lines in this workspace. Human agents handle all conversations."
                  : "AI is autonomous and active. It automatically answers customer questions and collects orders according to line rules."}
              </p>
            </div>
          </div>

          <Button
            type="button"
            disabled={isTogglingMute}
            onClick={handleToggleMute}
            className={cn(
              "rounded-xl shadow-sm text-white font-medium shrink-0",
              isMuted
                ? "bg-[#0b7a55] hover:bg-[#096747]"
                : "bg-red-600 hover:bg-red-700",
            )}
          >
            {isTogglingMute ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : isMuted ? (
              <Volume2 className="mr-2 h-4 w-4" />
            ) : (
              <VolumeX className="mr-2 h-4 w-4" />
            )}
            {isMuted ? "Unmute AI Assistant" : "Mute AI Assistant"}
          </Button>
        </div>
      </div>

      {/* 2. Google Gemini API Key & Model Configuration */}
      <div className="rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-base font-semibold text-slate-900 dark:text-dark-text-primary">
                  Google Gemini AI API Key
                </h4>
                <Badge
                  variant="outline"
                  className={cn(
                    "border-0 px-2 py-0.5 text-[11px] font-semibold",
                    workspaceSettings?.hasCustomApiKey
                      ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                      : workspaceSettings?.systemHasApiKey
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
                  )}
                >
                  {workspaceSettings?.hasCustomApiKey
                    ? "Custom Workspace Key Active"
                    : workspaceSettings?.systemHasApiKey
                      ? "System Environment Key Active"
                      : "No API Key"}
                </Badge>
              </div>
              <p className="text-xs text-[#65736d] dark:text-dark-text-secondary">
                Enter your Google Gemini API key to power AI customer chat,
                product vision OCR, and voice message transcription.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700 dark:text-dark-text-primary">
              Gemini API Key
            </Label>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder="Paste Gemini API Key (e.g. AIzaSy...)"
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setTestKeyResult(null);
                }}
                className="pr-10 font-mono text-xs rounded-xl"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-slate-700 dark:text-dark-text-primary">
                Primary Model
              </Label>
              <button
                type="button"
                onClick={() => handleRefreshModels()}
                disabled={isLoadingModels}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("h-3 w-3", isLoadingModels && "animate-spin")}
                />
                {isLoadingModels ? "Loading..." : "Load from Gemini"}
              </button>
            </div>
            <Select
              value={primaryModel}
              onValueChange={(val) => setPrimaryModel(val)}
            >
              <SelectTrigger className="rounded-xl text-xs">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {availableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <div className="flex items-center gap-2 py-0.5">
                      <span className="font-medium text-xs text-slate-800 dark:text-slate-100">
                        {m.name}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({m.id})
                      </span>
                      {m.isRecommended && (
                        <span className="text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 px-1.5 py-0.2 rounded-full font-semibold">
                          Recommended
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
                {!availableModels.some((m) => m.id === primaryModel) && (
                  <SelectItem value={primaryModel}>
                    <span className="font-medium text-xs">{primaryModel}</span>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {testKeyResult && (
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-xl p-3 text-xs",
              testKeyResult.valid
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50"
                : "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300 border border-red-200 dark:border-red-800/50",
            )}
          >
            {testKeyResult.valid ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {testKeyResult.valid
                  ? "API Key Verified Successfully!"
                  : "API Key Validation Failed"}
              </p>
              <p className="mt-0.5 opacity-90">
                {testKeyResult.valid
                  ? `${testKeyResult.message || "Model responded normally"} (${testKeyResult.latencyMs}ms)`
                  : testKeyResult.error}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#f0f3f1] dark:border-dark-border">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                isTestingKey ||
                !apiKeyInput.trim() ||
                apiKeyInput.includes("...")
              }
              onClick={handleTestApiKey}
              className="rounded-xl text-xs gap-1.5"
            >
              {isTestingKey ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-purple-600" />
              )}
              Test Key
            </Button>
            {workspaceSettings?.hasCustomApiKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSavingKey}
                onClick={handleClearApiKey}
                className="rounded-xl text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Revert to System Key
              </Button>
            )}
          </div>

          <Button
            type="button"
            size="sm"
            disabled={isSavingKey}
            onClick={handleSaveApiKey}
            className="rounded-xl bg-[#0b7a55] hover:bg-[#096747] text-white text-xs gap-1.5 shadow-sm"
          >
            {isSavingKey ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save Key & Model
          </Button>
        </div>
      </div>

      {/* 3. Per-Connection Instructions & Q&A Training */}
      {connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#dce3de] bg-white p-12 text-center dark:border-dark-border dark:bg-dark-elevated">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-400">
            <Bot className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-dark-text-primary">
            No WhatsApp Connection Found
          </h3>
          <p className="mt-2 max-w-md text-sm text-[#65736d] dark:text-dark-text-secondary">
            To set up AI Agent instructions and Q&A knowledge bases for specific
            numbers, please connect at least one WhatsApp number to this workspace.
          </p>
          <div className="mt-6">
            <Button
              asChild
              className="rounded-xl bg-[#0b7a55] hover:bg-[#096747] text-white shadow-sm"
            >
              <a href="connections">Go to WhatsApp Connections</a>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-400 shadow-sm">
                  <Bot className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-dark-text-primary">
                      Line Persona & Q&A Knowledge Training
                    </h3>
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-0 px-2.5 py-0.5 text-xs font-semibold",
                        enabled
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
                      )}
                    >
                      {enabled ? "Line Active" : "Line Paused"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-[#65736d] dark:text-dark-text-secondary">
                    Configure positive directives, strict negative guardrails, and
                    train verified Q&A responses for your WhatsApp business line.
                  </p>
                </div>
              </div>

              {/* Connection Dropdown */}
              <div className="flex items-center gap-2 sm:self-auto self-start">
                <span className="text-xs font-semibold text-[#65736d] dark:text-dark-text-secondary">
                  WhatsApp Line:
                </span>
                <Select
                  value={selectedConnectionId}
                  onValueChange={(val) => {
                    setSelectedConnectionId(val);
                  }}
                >
                  <SelectTrigger className="w-[220px] rounded-xl border-[#dce3de] bg-white text-xs font-medium dark:border-dark-border dark:bg-dark-elevated">
                    <SelectValue placeholder="Select connection" />
                  </SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.connectionId} value={c.connectionId}>
                        <div className="flex items-center gap-2">
                          <WhatsAppMark className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="truncate">
                            {c.connectionName || c.phoneNumber || "Unnamed Line"}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Quick Line Controls */}
            <div className="mt-5 grid gap-4 border-t border-[#f0f3f1] pt-5 dark:border-dark-border sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 dark:text-dark-text-primary">
                  Store Display Name
                </Label>
                <Input
                  value={storeName}
                  onChange={(e) => {
                    setStoreName(e.target.value);
                    handleFieldChange();
                  }}
                  placeholder="e.g. Color Hut BD"
                  className="rounded-xl text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 dark:text-dark-text-primary">
                  Assistant Persona Name
                </Label>
                <Input
                  value={personaName}
                  onChange={(e) => {
                    setPersonaName(e.target.value);
                    handleFieldChange();
                  }}
                  placeholder="e.g. Maya"
                  className="rounded-xl text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 dark:text-dark-text-primary">
                  Persona Tone
                </Label>
                <Select
                  value={personaTone}
                  onValueChange={(val: any) => {
                    setPersonaTone(val);
                    handleFieldChange();
                  }}
                >
                  <SelectTrigger className="rounded-xl text-xs">
                    <SelectValue placeholder="Select tone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">Friendly & Polished</SelectItem>
                    <SelectItem value="formal">Formal & Corporate</SelectItem>
                    <SelectItem value="enthusiastic">
                      Enthusiastic & Sales-Driven
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col justify-end space-y-1.5">
                <div className="flex items-center space-x-2 pt-2">
                  <Checkbox
                    id="line-enabled"
                    checked={enabled}
                    onCheckedChange={(checked) => {
                      setEnabled(Boolean(checked));
                      handleFieldChange();
                    }}
                  />
                  <label
                    htmlFor="line-enabled"
                    className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    Enable AI on this line
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Tabs: Instructions vs Q&A Knowledge */}
          <div className="rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-6">
            <Tabs
              value={activeTab}
              onValueChange={(val: any) => setActiveTab(val)}
              className="space-y-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#f0f3f1] pb-4 dark:border-dark-border">
                <TabsList className="bg-[#f0f4f1] p-1 dark:bg-dark-tertiary">
                  <TabsTrigger
                    value="instructions"
                    className="rounded-lg text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-[#0b7a55] dark:data-[state=active]:bg-dark-elevated dark:data-[state=active]:text-emerald-400"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Directives &
                    Guardrails
                  </TabsTrigger>
                  <TabsTrigger
                    value="faqs"
                    className="rounded-lg text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-[#0b7a55] dark:data-[state=active]:bg-dark-elevated dark:data-[state=active]:text-emerald-400"
                  >
                    <HelpCircle className="mr-1.5 h-3.5 w-3.5" /> Q&A Knowledge
                    Base
                    {detectedFaqs.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-[#0b7a55]/10 px-1.5 py-0.2 text-[10px] text-[#0b7a55] dark:bg-emerald-500/20 dark:text-emerald-400">
                        {detectedFaqs.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={saving || !isDirty}
                    className="rounded-xl bg-[#0b7a55] hover:bg-[#096747] text-white shadow-sm text-xs font-medium"
                  >
                    {saving ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Save Line Settings
                  </Button>
                </div>
              </div>

              {/* Tab 1: Positive Guidelines & Strict Avoid List */}
              <TabsContent value="instructions" className="space-y-5 m-0">
                <div className="grid gap-5 md:grid-cols-2">
                  {/* Positive Guidelines */}
                  <div className="space-y-2 rounded-xl border border-emerald-100 bg-[#f7fcf9] p-4 dark:border-emerald-950/40 dark:bg-emerald-950/10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#075c41] dark:text-emerald-300">
                        <ThumbsUp className="h-4 w-4" />
                        <span>POSITIVE DIRECTIVES (What AI MUST do)</span>
                      </div>
                      <span className="text-[10px] text-[#65736d] dark:text-dark-text-secondary">
                        Sales flow, tone, greetings
                      </span>
                    </div>
                    <Textarea
                      rows={10}
                      value={positivePrompt}
                      onChange={(e) => {
                        setPositivePrompt(e.target.value);
                        handleFieldChange();
                      }}
                      placeholder={`Example guidelines:
- Always greet warmly in friendly polite tone ("জি ভাইয়া/আপু").
- Emphasize that all our products are 100% authentic with fast home delivery.
- If customer asks about fabric, mention premium 100% combed cotton.
- Ask for their delivery address and active phone number to confirm the order.`}
                      className="font-mono text-xs leading-relaxed bg-white dark:bg-dark-elevated rounded-xl border-[#dce3de] dark:border-dark-border"
                    />
                  </div>

                  {/* Negative Avoid List */}
                  <div className="space-y-2 rounded-xl border border-red-100 bg-[#fffbfc] p-4 dark:border-red-950/40 dark:bg-red-950/10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-300">
                        <ThumbsDown className="h-4 w-4" />
                        <span>NEGATIVE GUARDRAILS (Strict Avoid List)</span>
                      </div>
                      <span className="text-[10px] text-[#65736d] dark:text-dark-text-secondary">
                        Rules, limits & strict bans
                      </span>
                    </div>
                    <Textarea
                      rows={10}
                      value={negativePrompt}
                      onChange={(e) => {
                        setNegativePrompt(e.target.value);
                        handleFieldChange();
                      }}
                      placeholder={`Strict prohibitions for AI:
- NEVER offer discounts or promo codes that are not publicly active.
- NEVER promise same-day delivery outside Dhaka.
- NEVER share internal admin contact numbers or developer credentials.
- NEVER confirm an order without full name, phone number, and delivery district.`}
                      className="font-mono text-xs leading-relaxed bg-white dark:bg-dark-elevated rounded-xl border-[#dce3de] dark:border-dark-border"
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Tab 2: Q&A Knowledge Training */}
              <TabsContent value="faqs" className="space-y-4 m-0">
                <div className="rounded-xl border border-[#dce3de] bg-[#f8faf8] p-4 dark:border-dark-border dark:bg-dark-tertiary/40">
                  <div className="flex items-start gap-2.5">
                    <HelpCircle className="mt-0.5 h-4 w-4 text-[#0b7a55] dark:text-emerald-400 shrink-0" />
                    <div className="text-xs text-[#65736d] dark:text-dark-text-secondary space-y-1">
                      <p className="font-semibold text-slate-800 dark:text-dark-text-primary">
                        How to train verified Q&A knowledge:
                      </p>
                      <p>
                        Write or paste customer questions followed by your sales
                        team's exact answers using standard{" "}
                        <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10">
                          Q: ... A: ...
                        </code>{" "}
                        format. The AI will strictly follow these answers when
                        responding to similar questions.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-700 dark:text-dark-text-primary">
                      Knowledge Q&A Training Content
                    </Label>
                    <span className="text-[11px] font-medium text-[#0b7a55] dark:text-emerald-400">
                      {detectedFaqs.length} verified Q&A pair(s) detected
                    </span>
                  </div>
                  <Textarea
                    rows={14}
                    value={faqText}
                    onChange={(e) => {
                      setFaqText(e.target.value);
                      handleFieldChange();
                    }}
                    placeholder={`Q: ডেলিভারি চার্জ কত?
A: ঢাকা সিটির ভিতরে ডেলিভারি চার্জ ৮০ টাকা, এবং ঢাকার বাইরে ১৫০ টাকা।

Q: ঢাকার বাইরে কি কোনো অগ্রিম টাকা দেওয়া লাগে?
A: জি, ঢাকার বাইরের অর্ডারের ক্ষেত্রে ডেলিভারি চার্জ ১৫০ টাকা অগ্রিম বিকাশ বা নগদে প্রদান করে অর্ডার কনফার্ম করতে হয়। বাকি টাকা প্রোডাক্ট হাতে পেয়ে ক্যাশ অন ডেলিভারিতে দিতে পারবেন।

Q: প্রোডাক্টের ফেব্রিক কেমন?
A: আমাদের প্রতিটি টি-শার্ট ১০০% প্রিমিয়াম কম্বড কটন ফেব্রিক দিয়ে তৈরি, যা অত্যন্ত আরামদায়ক এবং দীর্ঘস্থায়ী।

Q: সাইজ এক্সচেঞ্জ করার সুযোগ আছে কি?
A: জি অবশ্যই! সাইজে কোনো সমস্যা হলে ডেলিভারি পাওয়ার ৩ দিনের মধ্যে আমাদের জানালে সাইজ এক্সচেঞ্জ করে দেওয়া হবে।`}
                    className="font-mono text-xs leading-relaxed bg-white dark:bg-dark-elevated rounded-xl border-[#dce3de] dark:border-dark-border"
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}
    </div>
  );
}
export default AiAgentSettings;
