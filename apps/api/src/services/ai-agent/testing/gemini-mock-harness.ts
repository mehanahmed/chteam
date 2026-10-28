/**
 * Offline Simulation Harness for Google GenAI SDK (@google/genai)
 * Location: apps/api/src/services/ai-agent/testing/gemini-mock-harness.ts
 */

export interface SimulatedRule {
  pattern: RegExp | string;
  response: {
    text?: string;
    functionCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>;
    status?: number;
  };
}

export interface InvocationsLog {
  model: string;
  contents: unknown;
  config?: unknown;
  timestamp: Date;
}

export class GeminiOfflineSimulationHarness {
  public callHistory: InvocationsLog[] = [];
  private rules: SimulatedRule[] = [];
  private failModels: Map<string, { status: number; message: string }> =
    new Map();
  private transientFailures: Map<string, number> = new Map();

  constructor() {
    this.installDefaultTrilingualRules();
  }

  /**
   * Register a simulated response for any prompt matching pattern
   */
  public onPattern(pattern: RegExp | string, text: string): this {
    this.rules.unshift({ pattern, response: { text } });
    return this;
  }

  /**
   * Register a simulated tool call response
   */
  public onToolCall(
    pattern: RegExp | string,
    name: string,
    args: Record<string, unknown>,
  ): this {
    this.rules.unshift({
      pattern,
      response: {
        functionCalls: [{ id: `call_${Date.now()}`, name, args }],
      },
    });
    return this;
  }

  /**
   * Simulate model failure (e.g. rate limit 429 or server outage 503)
   */
  public simulateModelFailure(
    modelName: string,
    status = 429,
    message = "Resource has been exhausted (e.g. check quota)",
  ): this {
    this.failModels.set(modelName, { status, message });
    return this;
  }

  /**
   * Simulate a transient model failure that fails N times then recovers
   */
  public simulateTransientFailure(
    modelName: string,
    failureCount = 1,
    status = 503,
    message = "Service Temporarily Unavailable",
  ): this {
    this.transientFailures.set(modelName, failureCount);
    this.failModels.set(modelName, { status, message });
    return this;
  }

  /**
   * Reset simulation state and rules
   */
  public reset(): void {
    this.callHistory = [];
    this.rules = [];
    this.failModels.clear();
    this.transientFailures.clear();
    this.installDefaultTrilingualRules();
  }

  /**
   * Execution handler that matches Gemini generateContent calls
   */
  public async handleGenerateContent(params: {
    model: string;
    contents: unknown;
    config?: unknown;
  }): Promise<{
    text: string;
    functionCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>;
    candidates: unknown[];
    usageMetadata: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
    };
  }> {
    this.callHistory.push({
      model: params.model,
      contents: params.contents,
      config: params.config,
      timestamp: new Date(),
    });

    // Check fault injection
    if (this.failModels.has(params.model)) {
      const remaining = this.transientFailures.get(params.model);
      if (remaining !== undefined) {
        if (remaining > 1) {
          this.transientFailures.set(params.model, remaining - 1);
        } else {
          this.transientFailures.delete(params.model);
          this.failModels.delete(params.model);
        }
      }
      const errInfo = this.failModels.get(params.model) || {
        status: 500,
        message: "Internal Error",
      };
      const err = Object.assign(
        new Error(`[Gemini API Mock ${errInfo.status}] ${errInfo.message}`),
        { status: errInfo.status },
      );
      throw err;
    }

    const promptText = this.extractPromptString(params.contents);

    for (const rule of this.rules) {
      const matches =
        typeof rule.pattern === "string"
          ? promptText.toLowerCase().includes(rule.pattern.toLowerCase())
          : rule.pattern.test(promptText);

      if (matches) {
        return {
          text: rule.response.text || "",
          functionCalls: rule.response.functionCalls,
          candidates: [
            {
              content: {
                parts: [{ text: rule.response.text || "" }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 120,
            candidatesTokenCount: 45,
            totalTokenCount: 165,
          },
        };
      }
    }

    // Default culturally grounded retail response
    return {
      text: "Ji bhaiya, Assalamu Alaikum! Apnake kivabe shahajjo korte pari?",
      candidates: [
        {
          content: {
            parts: [
              {
                text: "Ji bhaiya, Assalamu Alaikum! Apnake kivabe shahajjo korte pari?",
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 50,
        candidatesTokenCount: 15,
        totalTokenCount: 65,
      },
    };
  }

  private extractPromptString(contents: unknown): string {
    if (typeof contents === "string") return contents;
    if (Array.isArray(contents)) {
      return contents
        .map((c) => {
          if (typeof c === "string") return c;
          if (typeof c === "object" && c !== null && "parts" in c) {
            const parts = (c as { parts: Array<{ text?: string }> }).parts;
            return parts.map((p) => p.text || "").join(" ");
          }
          return "";
        })
        .join(" ");
    }
    if (
      typeof contents === "object" &&
      contents !== null &&
      "parts" in contents
    ) {
      const parts = (contents as { parts: Array<{ text?: string }> }).parts;
      return parts.map((p) => p.text || "").join(" ");
    }
    return "";
  }

  private installDefaultTrilingualRules(): void {
    // 1. Banglish Queries
    this.onPattern(
      /red color ta hobe/i,
      "Ji bhaiya, red color ta available ache! Apnar kon size ta lagbe?",
    );
    this.onPattern(
      /delivery charge koto/i,
      "Bhaiya, amader delivery charge inside Dhaka 80 Tk (24-48 hours), Dhaka suburbs 120 Tk, ebong outside Dhaka 150 Tk (3-5 days). Cash on delivery available!",
    );
    this.onPattern(
      /chittagong.*koto din/i,
      "Chittagong e amader standard courier delivery 3 theke 5 karjodibosh er moddhe paben bhaiya.",
    );
    this.onPattern(
      /original cotton/i,
      "Ji bhaiya, ekdom 100% pure combed cotton. Color ba fabric er kono issue hobe na, guaranteed!",
    );
    this.onPattern(
      /order confirm koren/i,
      "Oboshshoi bhaiya! Order confirm korte apnar Nam, 11-digit Phone number, ebong Full Delivery Address ta bolun.",
    );
    this.onPattern(
      /price koto|vai price/i,
      "Ji bhaiya, price 1,200 Tk. Apni kon size ta nite chanchhen?",
    );

    // 2. Bengali Script Queries (বাংলা লিপি)
    this.onPattern(
      /ঢাকার বাইরে ডেলিভারি/i,
      "ঢাকার বাইরে ডেলিভারি চার্জ ১৫০ টাকা এবং ডেলিভারি পেতে ৩-৫ কার্যদিবস সময় লাগবে। ক্যাশ অন ডেলিভারি সুবিধা রয়েছে।",
    );
    this.onPattern(
      /লাল কালার.*এভেইলেবল/i,
      "জি ভাইয়া, লাল কালারটি বর্তমানে এভেইলেবল রয়েছে। আপনি কোন সাইজটি নিতে চাচ্ছেন?",
    );
    this.onPattern(
      /ক্যাশ অন ডেলিভারি/i,
      "জি অবশ্যই, আমাদের সারা বাংলাদেশে ক্যাশ অন ডেলিভারি (COD) সুবিধা রয়েছে। পণ্য হাতে পেয়ে মূল্য পরিশোধ করতে পারবেন।",
    );
    this.onPattern(
      /অর্ডার করতে চাই/i,
      "জি অবশ্যই! অর্ডার কনফার্ম করার জন্য অনুগ্রহ করে আপনার নাম, মোবাইল নাম্বার এবং সম্পূর্ণ ডেলিভারি ঠিকানা প্রদান করুন।",
    );

    // 3. English Queries
    this.onPattern(
      /size XL/i,
      "Yes! Size XL is currently in stock. Would you like to proceed with booking this item?",
    );
    this.onPattern(
      /shipping rates/i,
      "Our shipping charges are 80 BDT inside Dhaka (1-2 business days) and 150 BDT outside Dhaka (3-5 business days). Cash on Delivery is available!",
    );
    this.onPattern(
      /return policy/i,
      "We offer a 7-day hassle-free exchange policy if the size does not fit, provided tags remain intact.",
    );

    // 4. Code-Switching & Code-Mixing
    this.onPattern(
      /cotton fabric.*price koto/i,
      "Ji bhaiya, eta 100% pure premium cotton fabric. Price matro 1,250 Tk. Kon size ta lagbe apnar?",
    );
    this.onPattern(
      /size L ache.*cash on delivery/i,
      "Ji bhaiya, size L in stock ache! Cash on delivery te order korte apnar address and phone number din please.",
    );

    // 5. Complaint & Human Escalation
    this.onPattern(
      /faltu service|taka ferot|1 soptaho/i,
      "Bhaiya, amra ontorikvabe dukhito apnar osubidhar jonno. Ami ekhoni amader human support agent er kache apnar issue ta handover korchi, unara khub druto jogajog korben.",
    );
    this.onPattern(
      /human agent|manush.*kotha/i,
      "Ji oboshshoi bhaiya, ami apnake amader representative er sathe connect kore dichhi. Please hold on a moment.",
    );
  }
}
