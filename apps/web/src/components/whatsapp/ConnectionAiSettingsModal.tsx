import {
  BookOpen,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { WhatsAppMark } from "@/components/connections/channel-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type ConnectionAiFaq,
  type ConnectionAiSettings,
  getConnectionAiSettings,
  updateConnectionAiSettings,
} from "@/lib/api/ai-agent";

interface ConnectionAiSettingsModalProps {
  connectionId: string | null;
  connectionName?: string | null;
  phoneNumber?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface EditableFaq extends ConnectionAiFaq {
  id: string;
}

export function ConnectionAiSettingsModal({
  connectionId,
  connectionName,
  phoneNumber,
  isOpen,
  onClose,
  onSuccess,
}: ConnectionAiSettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [enabled, setEnabled] = useState(true);
  const [faqs, setFaqs] = useState<EditableFaq[]>([]);
  const [rawSettings, setRawSettings] = useState<ConnectionAiSettings | null>(null);

  useEffect(() => {
    if (!isOpen || !connectionId) return;

    let isMounted = true;
    setLoading(true);
    setSearchQuery("");

    getConnectionAiSettings(connectionId)
      .then((data) => {
        if (!isMounted) return;
        setRawSettings(data);
        setEnabled(data.enabled ?? true);
        const initialFaqs = Array.isArray(data.faqs)
          ? data.faqs.map((f, i) => ({
              id: `faq-${Date.now()}-${i}`,
              question: f.question,
              answer: f.answer,
            }))
          : [];
        setFaqs(initialFaqs);
      })
      .catch((err) => {
        console.error("Failed to load Q&A settings:", err);
        toast.error("Could not load Q&A list. Please try again.");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, connectionId]);

  const handleAddFaq = (template?: {
    label?: string;
    question: string;
    answer: string;
  }) => {
    const newEntry: EditableFaq = {
      id: `faq-${Date.now()}-${Math.random()}`,
      question: template?.question || "",
      answer: template?.answer || "",
    };
    setFaqs((prev) => [newEntry, ...prev]);
    if (template) {
      toast.success(`Template "${template.label || "Q&A"}" added`);
    }
  };

  const handleUpdateFaq = (id: string, field: "question" | "answer", value: string) => {
    setFaqs((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const handleDeleteFaq = (id: string) => {
    setFaqs((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSave = async () => {
    if (!connectionId) return;

    // Filter out completely blank Q&A
    const validFaqs = faqs
      .filter((f) => f.question.trim().length > 0 && f.answer.trim().length > 0)
      .map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() }));

    setSaving(true);
    try {
      await updateConnectionAiSettings(connectionId, {
        ...(rawSettings || {}),
        enabled,
        faqs: validFaqs,
      });

      toast.success(
        `Successfully saved ${validFaqs.length} Q&A pairs for ${connectionName || "WhatsApp"}!`,
      );
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error("Failed to save Q&A:", err);
      toast.error("Failed to save Q&A. Please check your inputs and try again.");
    } finally {
      setSaving(false);
    }
  };

  const filteredFaqs = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return faqs;
    return faqs.filter(
      (f) =>
        f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q),
    );
  }, [faqs, searchQuery]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl h-[88vh] flex flex-col p-0 overflow-hidden sm:rounded-2xl border border-[#dce3de] bg-white dark:border-dark-border dark:bg-dark-secondary shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#dce3de] dark:border-dark-border bg-[#f8faf8] dark:bg-dark-primary shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-sm">
                <WhatsAppMark className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-semibold text-slate-900 dark:text-dark-text-primary flex items-center gap-2">
                  Q&A Knowledge & Sales Conversation Base
                  <Badge className="bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-300 border-0 text-[10px] font-semibold px-2 py-0.5">
                    {faqs.length} {faqs.length === 1 ? "Pair" : "Pairs"}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-[#65736d] dark:text-dark-text-secondary mt-0.5">
                  Configure real sales conversation examples (Customer Q & Sales Team A) for{" "}
                  <span className="font-semibold text-slate-900 dark:text-dark-text-primary">
                    {connectionName || "WhatsApp"} {phoneNumber ? `(${phoneNumber})` : ""}
                  </span>
                  . The AI adopts both the knowledge and your team's communication style.
                </DialogDescription>
              </div>
            </div>

            <Button
              type="button"
              onClick={() => handleAddFaq()}
              size="sm"
              className="gap-1.5 text-xs font-semibold rounded-xl bg-[#0b7a55] hover:bg-[#096747] text-white shadow-sm shrink-0"
            >
              <Plus className="h-4 w-4" />
              Add New Q&A
            </Button>
          </div>
        </div>

        {/* Top Controls: Switch */}
        <div className="px-6 py-3 border-b border-[#e2e8e3] dark:border-dark-border bg-white dark:bg-dark-elevated shrink-0">
          {/* Activation Checkbox */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Checkbox
                id="ai-channel-toggle"
                checked={enabled}
                onCheckedChange={(checked) => setEnabled(Boolean(checked))}
                className="h-4 w-4 rounded data-[state=checked]:bg-[#0b7a55] data-[state=checked]:border-[#0b7a55]"
              />
              <Label
                htmlFor="ai-channel-toggle"
                className="text-xs font-medium text-slate-800 dark:text-dark-text-primary cursor-pointer select-none"
              >
                Enable AI Auto-Reply using these Q&A answers on this WhatsApp number
              </Label>
            </div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {enabled ? (
                <span className="text-[#0b7a55] dark:text-emerald-400 font-semibold">Active</span>
              ) : (
                <span className="text-slate-400">Paused</span>
              )}
            </span>
          </div>
        </div>

        {/* Q&A List Feed */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#f8faf8] dark:bg-dark-primary">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#65736d]">
              <Loader2 className="h-8 w-8 animate-spin text-[#0b7a55]" />
              <p className="text-xs font-medium">Loading Q&A list...</p>
            </div>
          ) : faqs.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-[#d6dfd9] bg-white dark:border-dark-border dark:bg-dark-secondary">
              <BookOpen className="h-10 w-10 mx-auto mb-3 text-[#829089] dark:text-dark-text-tertiary" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-dark-text-primary">
                No Sales Conversations or Q&As Added Yet
              </h3>
              <p className="text-xs text-[#65736d] dark:text-dark-text-secondary max-w-md mx-auto mt-1 mb-5 leading-relaxed">
                Add real examples of how your sales team talks with customers (Customer Question & Sales Team Answer). The AI will learn your team's tone, wording, and exact knowledge to talk with customers in that exact same way.
              </p>
              <Button
                type="button"
                onClick={() => handleAddFaq()}
                className="gap-1.5 text-xs rounded-xl bg-[#0b7a55] hover:bg-[#096747] text-white font-semibold shadow-sm"
              >
                <Plus className="h-4 w-4" />
                Add First Q&A Conversation
              </Button>
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredFaqs.map((faq, index) => (
                <div
                  key={faq.id}
                  className="group rounded-2xl border border-[#dce3de] bg-white p-4 sm:p-5 shadow-[0_1px_2px_rgba(16,33,27,.03)] dark:border-dark-border dark:bg-dark-secondary hover:border-[#b8c9c0] dark:hover:border-dark-tertiary transition-all space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#e7f7ef] text-[#0b7a55] dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-bold font-mono">
                        Q{index + 1}
                      </span>
                      <span className="text-xs font-semibold text-slate-900 dark:text-dark-text-primary">
                        Customer Question (কাস্টমার যেভাবে প্রশ্ন করে)
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteFaq(faq.id)}
                      className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      title="Delete this Q&A pair"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Question Field */}
                  <Input
                    value={faq.question}
                    onChange={(e) => handleUpdateFaq(faq.id, "question", e.target.value)}
                    placeholder='যেমন: "apnader service charge koto?" বা "আপনাদের সাথে যোগাযোগ করার উপায় কী?"'
                    className="h-10 text-xs font-medium rounded-xl border-[#dce3de] dark:border-dark-border bg-[#f8faf8] dark:bg-dark-elevated text-slate-900 dark:text-dark-text-primary focus:bg-white focus:border-[#0b7a55]"
                  />

                  {/* Answer Field */}
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-slate-700 dark:text-dark-text-secondary">
                      Sales Team Answer & Style (আমাদের সেলস টিমের উত্তর ও কথা বলার ধরন)
                    </Label>
                    <Textarea
                      value={faq.answer}
                      onChange={(e) => handleUpdateFaq(faq.id, "answer", e.target.value)}
                      placeholder='যেমন: "Ji bhaiya, amader basic package start hoy... Apnar kon service ti dorkar bolle ami shob details bole dicchi!"'
                      rows={2}
                      className="text-xs rounded-xl border-[#dce3de] dark:border-dark-border bg-[#f8faf8] dark:bg-dark-elevated text-slate-900 dark:text-dark-text-primary focus:bg-white focus:border-[#0b7a55] leading-relaxed"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[#dce3de] dark:border-dark-border bg-white dark:bg-dark-primary flex items-center justify-between shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
            className="text-xs text-[#65736d] dark:text-dark-text-secondary hover:text-slate-900 rounded-xl"
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="gap-2 bg-[#0b7a55] hover:bg-[#096747] text-white rounded-xl px-5 text-xs font-semibold shadow-sm transition-all"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving Q&A...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Q&A
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
