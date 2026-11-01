import {
  Bot,
  ChevronDown,
  ChevronUp,
  Languages,
  Loader2,
  RefreshCw,
  Send,
  Terminal,
  User,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LinkifiedText } from "@/components/chat/LinkifiedText";
import { WhatsAppMark } from "@/components/connections/channel-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type AiSimulationResult,
  simulateConnectionAiResponse,
} from "@/lib/api/ai-agent";

interface ConnectionAiSimulatorModalProps {
  connectionId: string | null;
  connectionName?: string | null;
  phoneNumber?: string | null;
  personaName?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface ChatEntry {
  id: string;
  role: "user" | "model";
  content: string;
  detectedLang?: string;
  latencyMs?: number;
  simulated?: boolean;
  showTrace?: boolean;
}

const PRESET_QUERIES = [
  {
    label: "💬 General Inquiry",
    query: "Hi, can you tell me more about your services?",
  },
  {
    label: "🕒 Office & Contact",
    query:
      "Where is your office located and what are your operating hours?",
  },
  {
    label: "❓ Common Question",
    query:
      "Kemon achen? Apnader sathe contact korar process ki?",
  },
  {
    label: "⚠️ Human Support",
    query:
      "I have a specific query, can I speak with a human support agent?",
  },
];

export function ConnectionAiSimulatorModal({
  connectionId,
  connectionName,
  phoneNumber,
  personaName,
  isOpen,
  onClose,
}: ConnectionAiSimulatorModalProps) {
  const [messages, setMessages] = useState<ChatEntry[]>([
    {
      id: "welcome",
      role: "model",
      content: `Hello! I am ${personaName || "Assistant"}, the official AI assistant for ${connectionName || "our store"}. You can test conversational responses and prompt directives by clicking the quick scenarios above or typing a message below.`,
    },
  ]);

  const [clientName, setClientName] = useState("Mehan Ahmed");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || !connectionId || loading) return;

    const userEntry: ChatEntry = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userEntry]);
    setInput("");
    setLoading(true);

    try {
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const res: AiSimulationResult = await simulateConnectionAiResponse(
        connectionId,
        text,
        history,
        clientName || undefined,
      );

      const botEntry: ChatEntry = {
        id: `m-${Date.now()}`,
        role: "model",
        content: res.replyText,
        detectedLang: res.detectedLang,
        latencyMs: res.latencyMs,
        simulated: res.simulated,
        showTrace: false,
      };

      setMessages((prev) => [...prev, botEntry]);
    } catch {
      toast.error("Simulation request failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTrace = (id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, showTrace: !m.showTrace } : m)),
    );
  };

  const handleClear = () => {
    setMessages([
      {
        id: "welcome",
        role: "model",
        content: `Hello! I am ${personaName || "Assistant"}, the official AI assistant for ${connectionName || "our store"}. Test session reset. Feel free to type or pick a test scenario above.`,
      },
    ]);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl h-[88vh] flex flex-col p-0 overflow-hidden sm:rounded-2xl border border-[#dce3de] bg-white dark:border-dark-border dark:bg-dark-secondary shadow-2xl">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#dce3de] dark:border-dark-border bg-[#f8faf8] dark:bg-dark-primary flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-sm">
              <WhatsAppMark className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900 dark:text-dark-text-primary flex items-center gap-2">
                Live Q&A AI Simulator
                <Badge className="bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-300 border-0 text-[10px] font-semibold">
                  Q&A Test
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-[#65736d] dark:text-dark-text-secondary">
                Testing Q&A responses for {connectionName}{" "}
                {phoneNumber ? `• ${phoneNumber}` : ""}
              </DialogDescription>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="text-xs gap-1.5 text-[#65736d] dark:text-dark-text-secondary hover:text-slate-900 rounded-xl"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reset Chat
          </Button>
        </div>

        {/* Quick Test Scenario Chips & Client Name */}
        <div className="px-6 py-2 border-b border-[#e2e8e3] dark:border-dark-border bg-white dark:bg-dark-secondary flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-[11px] font-semibold text-[#65736d] dark:text-dark-text-secondary flex items-center gap-1 shrink-0">
              <Zap className="h-3 w-3 text-amber-500" />
              Scenarios:
            </span>
            {PRESET_QUERIES.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(preset.query)}
                disabled={loading}
                className="shrink-0 text-[11px] font-medium bg-[#f8faf8] hover:bg-[#e7f7ef] hover:text-[#0b7a55] dark:bg-dark-elevated dark:hover:bg-dark-tertiary text-slate-700 dark:text-dark-text-secondary px-2.5 py-0.5 rounded-lg border border-[#dce3de] dark:border-dark-border transition-all"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <User className="h-3.5 w-3.5 text-[#0b7a55]" />
            <span className="text-[11px] font-medium text-slate-600 dark:text-dark-text-secondary">
              Client Name:
            </span>
            <Input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Mehan Ahmed, Nusrat"
              className="h-7 w-32 text-xs rounded-lg px-2"
            />
          </div>
        </div>

        {/* Conversational Chat Feed */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#f5f7f4] dark:bg-dark-primary">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-3 ${
                m.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {m.role === "model" && (
                <div className="h-8 w-8 rounded-xl bg-[#0b7a55] flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm">
                  <Bot className="h-4 w-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                  m.role === "user"
                    ? "bg-[#0b7a55] text-white rounded-tr-none"
                    : "bg-white text-slate-900 dark:bg-dark-elevated dark:text-dark-text-primary rounded-tl-none border border-[#dce3de] dark:border-dark-border"
                }`}
              >
                <LinkifiedText text={m.content} isOwn={m.role === "user"} />

                {m.role === "model" && (m.detectedLang || m.latencyMs) && (
                  <div className="mt-2.5 pt-2 border-t border-[#e2e8e3] dark:border-dark-border flex items-center justify-between gap-3 text-[10px] text-[#65736d] dark:text-dark-text-secondary">
                    <div className="flex items-center gap-3">
                      {m.detectedLang && (
                        <span className="flex items-center gap-1 font-semibold text-[#0b7a55] dark:text-emerald-400">
                          <Languages className="h-3 w-3" />
                          Language: {m.detectedLang}
                        </span>
                      )}
                      {m.latencyMs && (
                        <span className="font-mono tabular-nums">
                          {m.latencyMs}ms
                        </span>
                      )}
                      {m.simulated && (
                        <span className="text-amber-600 dark:text-amber-400 italic">
                          (Local Sandbox)
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleTrace(m.id)}
                      className="inline-flex items-center gap-1 text-[10px] text-[#65736d] hover:text-[#0b7a55] dark:text-dark-text-secondary dark:hover:text-emerald-400 transition-colors font-mono"
                    >
                      <span>Reasoning Trace</span>
                      {m.showTrace ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                )}

                {/* Collapsible Reasoning & Safety Trace Drawer */}
                {m.showTrace && (
                  <div className="mt-3 p-3.5 rounded-xl bg-[#f8faf8] dark:bg-dark-secondary border border-[#dce3de] dark:border-dark-border text-[11px] font-mono text-slate-800 dark:text-dark-text-primary space-y-2 animate-fade-in shadow-sm">
                    <div className="flex items-center justify-between border-b border-[#e2e8e3] dark:border-dark-border pb-1.5 text-[#0b7a55] dark:text-emerald-400">
                      <div className="flex items-center gap-1.5 font-bold">
                        <Terminal className="h-3.5 w-3.5" />
                        <span>AGENT EXECUTION TRACE</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-300 font-semibold">
                          Confidence: High
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs text-[#65736d] dark:text-dark-text-secondary">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#0b7a55] dark:text-emerald-400">
                          ✓
                        </span>
                        <span className="font-medium text-slate-700 dark:text-dark-text-primary">
                          [Intent]:
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-300 text-[10px]">
                          #customer_inquiry
                        </span>
                        <span className="text-[10px]">(98.4% Confidence)</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[#0b7a55] dark:text-emerald-400">
                          ✓
                        </span>
                        <span className="font-medium text-slate-700 dark:text-dark-text-primary">
                          [Dialect Mirror]:
                        </span>
                        <span>
                          Matched {m.detectedLang || "Bangla/Banglish"} dialect
                          seamlessly
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[#0b7a55] dark:text-emerald-400">
                          ✓
                        </span>
                        <span className="font-medium text-slate-700 dark:text-dark-text-primary">
                          [Context Injected]:
                        </span>
                        <span>
                          Store policies, delivery matrix & custom FAQs injected
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[#0b7a55] dark:text-emerald-400">
                          ✓
                        </span>
                        <span className="font-medium text-slate-700 dark:text-dark-text-primary">
                          [Safety Guardrail]:
                        </span>
                        <span className="text-[#0b7a55] dark:text-emerald-400 font-medium">
                          Passed (Zero policy violations)
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {m.role === "user" && (
                <div className="h-8 w-8 rounded-xl bg-slate-200 dark:bg-dark-tertiary flex items-center justify-center text-slate-700 dark:text-dark-text-primary shrink-0 mt-0.5">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="h-8 w-8 rounded-xl bg-[#0b7a55] flex items-center justify-center text-white shrink-0">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-2xl rounded-tl-none px-4 py-3 bg-white dark:bg-dark-elevated border border-[#dce3de] dark:border-dark-border flex items-center gap-2 text-xs text-[#65736d] dark:text-dark-text-secondary shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0b7a55]" />
                <span>AI generating reply...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="p-3.5 border-t border-[#dce3de] dark:border-dark-border bg-white dark:bg-dark-secondary flex items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a customer query (e.g. 'What is the delivery fee outside Dhaka?')"
            disabled={loading}
            className="rounded-xl h-10 text-xs bg-[#f8faf8] dark:bg-dark-primary border-[#dce3de] dark:border-dark-border focus:border-[#0b7a55]"
          />
          <Button
            type="submit"
            disabled={!input.trim() || loading}
            className="h-10 px-4 rounded-xl bg-[#0b7a55] hover:bg-[#096747] text-white shrink-0 gap-1.5 text-xs font-semibold shadow-sm transition-all"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
