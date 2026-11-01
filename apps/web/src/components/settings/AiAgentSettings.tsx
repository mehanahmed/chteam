import {
  Bot,
  CheckCircle2,
  HelpCircle,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Zap,
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
  getConnectionAiOverview,
  getConnectionAiSettings,
  updateConnectionAiSettings,
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

  // Match blocks of Q: ... A: ... (or Question: ... Answer: ...)
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

  // Fallback: line-by-line parsing
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
  const [connections, setConnections] = useState<ConnectionAiOverviewItem[]>(
    [],
  );
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Form State
  const [enabled, setEnabled] = useState(true);
  const [personaName, setPersonaName] = useState("Maya");
  const [personaTone, setPersonaTone] = useState<
    "friendly" | "formal" | "enthusiastic"
  >("friendly");
  const [storeName, setStoreName] = useState("");
  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [faqText, setFaqText] = useState("");

  // Preserved delivery settings in state for seamless updates
  const [insideDhakaFee, setInsideDhakaFee] = useState<number>(80);
  const [subDhakaFee, setSubDhakaFee] = useState<number>(120);
  const [outsideDhakaFee, setOutsideDhakaFee] = useState<number>(150);
  const [outsideDhakaAdvanceRequired, setOutsideDhakaAdvanceRequired] =
    useState(true);
  const [outsideDhakaAdvanceAmount, setOutsideDhakaAdvanceAmount] =
    useState<number>(120);

  // UI Tabs
  const [activeTab, setActiveTab] = useState<"instructions" | "faqs">(
    "instructions",
  );

  // Load connection overview on mount
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    getConnectionAiOverview()
      .then((data) => {
        if (!isMounted) return;
        setConnections(data);
        if (data.length > 0) {
          setSelectedConnectionId(data[0].connectionId);
        }
      })
      .catch((err) => {
        console.error("Failed to load connection overview:", err);
        toast.error("Could not load WhatsApp connections. Please refresh.");
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
    setLoading(true);

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
        console.error("Failed to load AI settings:", err);
        toast.error("Failed to load AI settings for this connection.");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
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
                outsideDhakaAdvanceAmount:
                  Number(outsideDhakaAdvanceAmount) || 0,
                faqs: validFaqs,
              }
            : c,
        ),
      );

      setIsDirty(false);
      toast.success(
        `AI Agent settings & ${validFaqs.length} Q&A pairs saved successfully!`,
      );
    } catch (err) {
      console.error("Failed to save AI settings:", err);
      toast.error("Failed to save AI configuration. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && connections.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-[#dce3de] bg-white p-6 dark:border-dark-border dark:bg-dark-elevated">
        <Loader2 className="h-8 w-8 animate-spin text-[#0b7a55]" />
        <p className="text-sm font-medium text-[#65736d] dark:text-dark-text-secondary">
          Loading AI Agent settings...
        </p>
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#dce3de] bg-white p-12 text-center dark:border-dark-border dark:bg-dark-elevated">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-400">
          <Bot className="h-7 w-7" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-dark-text-primary">
          No WhatsApp Connection Found
        </h3>
        <p className="mt-2 max-w-md text-sm text-[#65736d] dark:text-dark-text-secondary">
          To set up AI Agent instructions and Q&A knowledge bases, you need to
          connect at least one WhatsApp number to this workspace first.
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
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header & Channel Selector Card */}
      <div className="rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-400 shadow-sm">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-dark-text-primary">
                  AI Agent & Knowledge Training
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
                  {enabled ? "AI Active" : "AI Paused"}
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
                if (isDirty) {
                  if (
                    !confirm(
                      "You have unsaved changes. Switch connection anyway?",
                    )
                  ) {
                    return;
                  }
                }
                setSelectedConnectionId(val);
              }}
            >
              <SelectTrigger className="h-9 w-[220px] text-xs">
                <SelectValue placeholder="Select connection" />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.connectionId} value={c.connectionId}>
                    <div className="flex items-center gap-2">
                      <WhatsAppMark className="h-3.5 w-3.5" />
                      <span>
                        {c.connectionName || c.phoneNumber || "WhatsApp"}
                      </span>
                      {c.phoneNumber && (
                        <span className="text-[10px] text-slate-400">
                          ({c.phoneNumber})
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Master AI Toggle & Core Identity Bar */}
        <div className="mt-6 pt-5 border-t border-[#edf1ed] dark:border-dark-border grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-6 flex items-center gap-3">
            <Checkbox
              id="ai-enabled-toggle"
              checked={enabled}
              onCheckedChange={(checked) => {
                setEnabled(Boolean(checked));
                handleFieldChange();
              }}
              className="h-5 w-5 rounded-md data-[state=checked]:bg-[#0b7a55] data-[state=checked]:border-[#0b7a55]"
            />
            <div>
              <Label
                htmlFor="ai-enabled-toggle"
                className="text-sm font-semibold text-slate-900 dark:text-dark-text-primary cursor-pointer"
              >
                Enable AI Automated Responses
              </Label>
              <p className="text-[11px] text-[#65736d] dark:text-dark-text-secondary">
                Autonomous 24/7 replies on this WhatsApp line guided by your
                prompts & Q&A training.
              </p>
            </div>
          </div>

          <div className="md:col-span-3">
            <Label className="text-xs font-semibold text-slate-700 dark:text-dark-text-secondary mb-1 block">
              Persona Tone
            </Label>
            <Select
              value={personaTone}
              onValueChange={(val: "friendly" | "formal" | "enthusiastic") => {
                setPersonaTone(val);
                handleFieldChange();
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="friendly">Friendly (বন্ধুত্বপূর্ণ)</SelectItem>
                <SelectItem value="formal">Formal (ফরমাল)</SelectItem>
                <SelectItem value="enthusiastic">
                  Enthusiastic (উৎসাহী)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-3">
            <Label className="text-xs font-semibold text-slate-700 dark:text-dark-text-secondary mb-1 block">
              Company / Brand Name
            </Label>
            <Input
              value={storeName}
              onChange={(e) => {
                setStoreName(e.target.value);
                handleFieldChange();
              }}
              placeholder="e.g. AurovixSoft"
              className="h-8 rounded-lg text-xs"
            />
          </div>
        </div>
      </div>

      {/* 2. Tabs Navigation: Instructions vs Q&A Box */}
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as typeof activeTab)}
        className="w-full"
      >
        <TabsList className="h-11 w-full justify-start rounded-xl border border-[#dce3de] bg-[#edf1ed] p-1 dark:border-dark-border dark:bg-dark-secondary">
          <TabsTrigger
            value="instructions"
            className="gap-2 rounded-lg text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-[#0b7a55] dark:data-[state=active]:bg-dark-elevated dark:data-[state=active]:text-emerald-400"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Positive & Negative Prompts
          </TabsTrigger>
          <TabsTrigger
            value="faqs"
            className="gap-2 rounded-lg text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-[#0b7a55] dark:data-[state=active]:bg-dark-elevated dark:data-[state=active]:text-emerald-400"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Q&A Training Box
            <Badge className="ml-1 h-4 border-0 bg-[#e7f7ef] text-[#0b7a55] text-[10px] px-1.5 dark:bg-emerald-500/10 dark:text-emerald-300">
              {detectedFaqs.length}{" "}
              {detectedFaqs.length === 1 ? "Pair" : "Pairs"}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Positive & Negative Prompt Instruction Boxes */}
        <TabsContent value="instructions" className="mt-4 space-y-5">
          {/* POSITIVE PROMPT BOX */}
          <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-emerald-900/40 dark:bg-dark-elevated sm:p-6 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 flex items-center justify-center shrink-0">
                  <ThumbsUp className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-dark-text-primary">
                      Positive Prompt (What AI SHOULD Do)
                    </h4>
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-0 text-[10px] font-semibold">
                      Directives
                    </Badge>
                  </div>
                  <p className="text-xs text-[#65736d] dark:text-dark-text-secondary mt-0.5">
                    Define greeting style, sales advice, order taking
                    procedures, and how the assistant proactively helps
                    customers.
                  </p>
                </div>
              </div>
            </div>

            <Textarea
              value={positivePrompt}
              onChange={(e) => {
                setPositivePrompt(e.target.value);
                handleFieldChange();
              }}
              rows={8}
              placeholder="Define custom directives for the AI: how to greet customers, sales guidance, store information, and order collection steps..."
              className="w-full rounded-xl border-emerald-200 font-mono text-xs leading-relaxed focus-visible:ring-emerald-500 dark:border-emerald-900/40 dark:bg-dark-secondary"
            />

            <div className="flex items-center justify-between text-[11px] text-[#65736d] dark:text-dark-text-secondary">
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <Zap className="h-3 w-3" />
                These directives are prioritized at the top of the AI system
                prompt.
              </span>
              <span>{positivePrompt.length} characters</span>
            </div>
          </div>

          {/* NEGATIVE PROMPT BOX */}
          <div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-rose-900/40 dark:bg-dark-elevated sm:p-6 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 flex items-center justify-center shrink-0">
                  <ThumbsDown className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-dark-text-primary">
                      Negative Prompt (What AI MUST NOT Do / Guardrails)
                    </h4>
                    <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300 border-0 text-[10px] font-semibold">
                      Strict Guardrails
                    </Badge>
                  </div>
                  <p className="text-xs text-[#65736d] dark:text-dark-text-secondary mt-0.5">
                    Prohibit unauthorized discounts, private phone numbers, rude
                    arguments, hallucinations, and competitor mentions.
                  </p>
                </div>
              </div>
            </div>

            <Textarea
              value={negativePrompt}
              onChange={(e) => {
                setNegativePrompt(e.target.value);
                handleFieldChange();
              }}
              rows={6}
              placeholder="Define strict guardrails and what the AI must NOT do (e.g. no unauthorized discounts, never invent products or prices, never share private details, never debate)..."
              className="w-full rounded-xl border-rose-200 font-mono text-xs leading-relaxed focus-visible:ring-rose-500 dark:border-rose-900/40 dark:bg-dark-secondary"
            />

            <div className="flex items-center justify-between text-[11px] text-[#65736d] dark:text-dark-text-secondary">
              <span className="flex items-center gap-1 text-rose-700 dark:text-rose-400">
                <ShieldAlert className="h-3 w-3" />
                These negative guardrails are strictly enforced against
                jailbreaks and hallucinations.
              </span>
              <span>{negativePrompt.length} characters</span>
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: Q&A Box (Q: example next line A: example) */}
        <TabsContent value="faqs" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-[#dce3de] bg-white p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-elevated sm:p-6 space-y-4">
            {/* Header & Quick Action */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-dark-text-primary flex items-center gap-1.5">
                    <HelpCircle className="h-4 w-4 text-[#0b7a55]" />
                    Q&A Knowledge & Training Box
                  </h4>
                  <Badge className="bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-300 border-0 text-[10px] font-semibold">
                    {detectedFaqs.length}{" "}
                    {detectedFaqs.length === 1
                      ? "Pair Detected"
                      : "Pairs Detected"}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-[#65736d] dark:text-dark-text-secondary">
                  Add questions and answers in plain text format:{" "}
                  <code className="px-1 py-0.5 bg-slate-100 dark:bg-dark-secondary rounded text-[11px] text-[#0b7a55] font-mono">
                    Q: [Question]
                  </code>{" "}
                  followed by{" "}
                  <code className="px-1 py-0.5 bg-slate-100 dark:bg-dark-secondary rounded text-[11px] text-[#0b7a55] font-mono">
                    A: [Answer]
                  </code>{" "}
                  on the next line.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const sample =
                      "Q: [প্রশ্ন]\nA: [উত্তর]";
                    setFaqText((prev) =>
                      prev.trim() ? `${prev.trim()}\n\n${sample}` : sample,
                    );
                    handleFieldChange();
                  }}
                  size="sm"
                  className="h-8 gap-1 rounded-lg text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" />+ Add Q&A Template
                </Button>
              </div>
            </div>

            {/* Q&A Textarea Box */}
            <Textarea
              value={faqText}
              onChange={(e) => {
                setFaqText(e.target.value);
                handleFieldChange();
              }}
              rows={16}
              placeholder={`Q: [গ্রাহকের সম্ভাব্য প্রশ্ন]
A: [আপনার সুনির্দিষ্ট এবং সঠিক উত্তর]

Q: [আরেকটি প্রশ্ন]
A: [আপনার উত্তর]`}
              className="w-full rounded-xl border-[#dce3de] font-mono text-xs leading-relaxed focus-visible:ring-[#0b7a55] dark:border-dark-border dark:bg-dark-secondary"
            />

            <div className="flex items-center justify-between text-[11px] text-[#65736d] dark:text-dark-text-secondary">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-dark-text-secondary">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                Format rule: write{" "}
                <strong className="font-semibold text-slate-800 dark:text-dark-text-primary">
                  Q:
                </strong>{" "}
                on one line, and{" "}
                <strong className="font-semibold text-slate-800 dark:text-dark-text-primary">
                  A:
                </strong>{" "}
                on the next line. Separate pairs with a blank line.
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[#0b7a55] dark:text-emerald-400 font-semibold">
                  {detectedFaqs.length} Q&A{" "}
                  {detectedFaqs.length === 1 ? "Pair" : "Pairs"} Parsed
                </span>
                <span>{faqText.length} characters</span>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* 3. Sticky Save Action Bar */}
      <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-2xl border border-[#dce3de] bg-white/95 px-5 py-3.5 shadow-lg backdrop-blur-md dark:border-dark-border dark:bg-dark-elevated/95">
        <div className="flex items-center gap-2">
          {isDirty ? (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                You have unsaved changes
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-medium text-slate-600 dark:text-dark-text-secondary">
                All changes saved
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {isDirty && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedConnectionId((prev) => prev);
                setIsDirty(false);
              }}
              className="text-xs rounded-xl"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
          )}

          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            size="sm"
            className="rounded-xl bg-[#0b7a55] hover:bg-[#096747] text-white text-xs font-semibold px-4 gap-1.5 shadow-sm"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
