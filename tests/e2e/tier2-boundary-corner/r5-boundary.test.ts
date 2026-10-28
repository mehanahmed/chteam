import { beforeEach, describe, expect, test } from "bun:test";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const r5BoundaryTestCases: E2ETestCase[] = [
  {
    id: "TC-T2-R5-01",
    name: "Severe Banglish/Bengali Profanity & Legal/Police Threats",
    tier: 2,
    feature: "R5",
    description:
      "Customer threatens police action with profanity. System applies complaint tags, sends apology, halts replies.",
    steps: [
      {
        step: 1,
        description: "Customer sends severe threats and profanity",
        customerAction: {
          senderPhone: "8801725000001",
          text: "fakibaj page, fraud sobai, police e case korbo, amar tk ferot de nahole toder dekhe nibo",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["আন্তরিকভাবে দুঃখিত", "ম্যানেজার"],
          tagsExpected: {
            mustInclude: ["ai-paused", "needs-human", "complaint"],
          },
        },
      },
    ],
  },
  {
    id: "TC-T2-R5-02",
    name: "Passive-Aggressive Dissatisfaction & Delivery Delay Complaint",
    tier: 2,
    feature: "R5",
    description:
      "Customer expresses disappointment about 5-day delay without vulgarity. System detects complaint and tags contact.",
    steps: [
      {
        step: 1,
        description: "Customer sends polite complaint about delivery delay",
        customerAction: {
          senderPhone: "8801725000002",
          text: "5 din age delivery dewar kotha chilo, ajkeo pelam na, customer support e phon diley kew dhore na. khub e disappointed",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["বিলম্বের জন্য আমরা আন্তরিকভাবে দুঃখিত", "সাপোর্ট অফিসার"],
          tagsExpected: {
            mustInclude: ["ai-paused", "needs-human"],
          },
        },
      },
    ],
  },
  {
    id: "TC-T2-R5-03",
    name: "Explicit Human Agent Requests Across Dialects",
    tier: 2,
    feature: "R5",
    description:
      "Customer asks 'kono manush er sathe kotha bola jabe?'. System tags needs-human and reassures takeover.",
    steps: [
      {
        step: 1,
        description: "Customer asks for human in colloquial dialect",
        customerAction: {
          senderPhone: "8801725000003",
          text: "kono manush er sathe kotha bola jabe?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["human agent", "support team"],
          tagsExpected: {
            mustInclude: ["ai-paused", "needs-human"],
          },
        },
      },
    ],
  },
  {
    id: "TC-T2-R5-04",
    name: "Pre-Reply Interception on Concurrent Human Agent Manual Message",
    tier: 2,
    feature: "R5",
    description:
      "Agent sends manual message while customer is chatting. ai-paused attached, subsequent customer messages suppressed.",
    steps: [
      {
        step: 1,
        description: "Agent sends manual reply in thread",
        agentAction: {
          type: "manual_send",
          agentId: "agent-007",
          phone: "8801725000004",
          text: "Ami support team theke dekhchi, wait koren.",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 2,
        description: "Customer replies to human",
        customerAction: {
          senderPhone: "8801725000004",
          text: "accha thik ache vaiya",
        },
        expectations: {
          agentShouldReply: false,
          tagsExpected: {
            mustInclude: ["ai-paused"],
          },
        },
      },
    ],
  },
  {
    id: "TC-T2-R5-05",
    name: "UI Chat Header 'Pause AI' Toggle",
    tier: 2,
    feature: "R5",
    description:
      "Clicking Pause AI in MessageHeader attaches ai-paused and immediately halts autonomous replies.",
    steps: [
      {
        step: 1,
        description: "Agent triggers Pause AI",
        agentAction: {
          type: "pause",
          agentId: "agent-008",
          phone: "8801725000005",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 2,
        description: "Customer sends message while AI is paused",
        customerAction: {
          senderPhone: "8801725000005",
          text: "kew ki ache?",
        },
        expectations: {
          agentShouldReply: false,
          tagsExpected: {
            mustInclude: ["ai-paused"],
          },
        },
      },
    ],
  },
  {
    id: "TC-T2-R5-06",
    name: "UI Chat Header 'Resume AI' Toggle",
    tier: 2,
    feature: "R5",
    description:
      "Clicking Resume AI clears ai-paused and restores autonomous AI replies.",
    steps: [
      {
        step: 1,
        description: "Agent pauses AI",
        agentAction: {
          type: "pause",
          agentId: "agent-008",
          phone: "8801725000006",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 2,
        description: "Agent resumes AI",
        agentAction: {
          type: "resume",
          agentId: "agent-008",
          phone: "8801725000006",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 3,
        description: "Customer sends inquiry after resume",
        customerAction: {
          senderPhone: "8801725000006",
          text: "Black polo shirt er price koto ekhon?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["850"],
          tagsExpected: {
            mustNotInclude: ["ai-paused"],
          },
        },
      },
    ],
  },
  {
    id: "TC-T2-R5-07",
    name: "Repeated Domain Confusion Circuit Breaker",
    tier: 2,
    feature: "R5",
    description:
      "Customer asks two consecutive out-of-domain questions (passport renewal & electricity bill). Second turn triggers handoff.",
    steps: [
      {
        step: 1,
        description: "Turn 1: Customer asks about passport renewal",
        customerAction: {
          senderPhone: "8801725000007",
          text: "bhai passport renew korbo kivabe?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["পোশাক", "ফ্যাশন"],
          tagsExpected: {
            mustNotInclude: ["ai-paused"],
          },
        },
      },
      {
        step: 2,
        description: "Turn 2: Customer persists with electricity bill",
        customerAction: {
          senderPhone: "8801725000007",
          text: "amake bolen biddut bill kothay dibo?",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["সাপোর্ট এজেন্টের সাথে যুক্ত করে দিচ্ছি"],
          tagsExpected: {
            mustInclude: ["ai-paused", "needs-human"],
          },
        },
      },
    ],
  },
];

describe("Tier 2 - Feature R5: Boundary & Corner Cases", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of r5BoundaryTestCases) {
    test(`${tc.id}: ${tc.name}`, async () => {
      for (const step of tc.steps) {
        if (step.agentAction) {
          const targetPhone = step.agentAction.phone || "8801725000000";
          if (step.agentAction.type === "assign") {
            await harness.assignContactToHuman(
              targetPhone,
              step.agentAction.agentId,
            );
          } else if (step.agentAction.type === "manual_send") {
            await harness.sendAgentManualReply(
              targetPhone,
              step.agentAction.agentId,
              step.agentAction.text || "",
            );
          } else if (step.agentAction.type === "pause") {
            await harness.setAiPauseState(targetPhone, true);
          } else if (step.agentAction.type === "resume") {
            await harness.setAiPauseState(targetPhone, false);
          }
        }

        if (step.customerAction) {
          const countBefore = harness.getOutboundReplies(
            step.customerAction.senderPhone,
          ).length;
          await harness.sendCustomerWhatsAppMessage(step.customerAction);
          const replies = harness.getOutboundReplies(
            step.customerAction.senderPhone,
          );

          if (step.expectations.agentShouldReply) {
            expect(replies.length).toBeGreaterThan(countBefore);
            const lastReply = replies[replies.length - 1];
            if (step.expectations.replyMustContain) {
              for (const token of step.expectations.replyMustContain) {
                expect(lastReply.text.toLowerCase()).toContain(
                  token.toLowerCase(),
                );
              }
            }
          } else {
            expect(replies.length).toBe(countBefore);
          }

          if (step.expectations.tagsExpected?.mustInclude) {
            const tags = harness.getContactTags(
              step.customerAction.senderPhone,
            );
            for (const tag of step.expectations.tagsExpected.mustInclude) {
              expect(tags).toContain(tag);
            }
          }

          if (step.expectations.tagsExpected?.mustNotInclude) {
            const tags = harness.getContactTags(
              step.customerAction.senderPhone,
            );
            for (const tag of step.expectations.tagsExpected.mustNotInclude) {
              expect(tags).not.toContain(tag);
            }
          }
        }
      }
    });
  }
});
