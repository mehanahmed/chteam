import { beforeEach, describe, expect, test } from "bun:test";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const r5HandoffTestCases: E2ETestCase[] = [
  {
    id: "T1-R5-01",
    name: "Dissatisfaction & Damage Complaint Detection",
    tier: 1,
    feature: "R5",
    description:
      "Customer sends angry complaint about broken product demanding refund. Tags attached and AI falls silent.",
    steps: [
      {
        step: 1,
        description: "Customer submits angry complaint",
        customerAction: {
          senderPhone: "8801715000001",
          text: "Product vanga asche, ekdom baje quality, tk ferot den!",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["আন্তরিকভাবে দুঃখিত", "ম্যানেজার"],
          tagsExpected: {
            mustInclude: ["ai-paused", "needs-human", "complaint"],
          },
        },
      },
      {
        step: 2,
        description: "Subsequent message while paused is suppressed",
        customerAction: {
          senderPhone: "8801715000001",
          text: "kew ki reply dibe?",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
    ],
  },
  {
    id: "T1-R5-02",
    name: "Explicit Human Agent Request Detection",
    tier: 1,
    feature: "R5",
    description:
      "Customer explicitly asks to speak with a human agent. Tags attached and reassurance sent.",
    steps: [
      {
        step: 1,
        description: "Customer asks for human agent",
        customerAction: {
          senderPhone: "8801715000002",
          text: "Bhai kono manush er sathe kotha bolte chai, agent k daken",
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
    id: "T1-R5-03",
    name: "Agent Assignment Circuit Breaker (Pre-Reply Interception)",
    tier: 1,
    feature: "R5",
    description:
      "Human agent claims contact in OmniTeam. Subsequent customer messages are 100% suppressed.",
    steps: [
      {
        step: 1,
        description: "Agent assigns contact to himself",
        agentAction: {
          type: "assign",
          agentId: "agent-user-001",
          phone: "8801715000003",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 2,
        description: "Customer sends message while assigned to human",
        customerAction: {
          senderPhone: "8801715000003",
          text: "Bhaiya stock ache?",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
    ],
  },
  {
    id: "T1-R5-04",
    name: "Manual Agent Send Interception",
    tier: 1,
    feature: "R5",
    description:
      "Agent sends manual message from web inbox. Contact is tagged ai-paused and AI drops further replies.",
    steps: [
      {
        step: 1,
        description: "Agent sends manual message to customer",
        agentAction: {
          type: "manual_send",
          agentId: "agent-user-002",
          phone: "8801715000004",
          text: "Hello, this is agent Sara. I am taking over this chat.",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 2,
        description: "Customer replies to manual agent message",
        customerAction: {
          senderPhone: "8801715000004",
          text: "Thanks Sara, please check my tracking.",
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
    id: "T1-R5-05",
    name: "Chat Header UI Pause & Resume Lifecycle",
    tier: 1,
    feature: "R5",
    description:
      "Agent toggles Pause AI via web UI header, then resumes AI. AI halts when paused, resumes when active.",
    steps: [
      {
        step: 1,
        description: "Agent clicks Pause AI in UI",
        agentAction: {
          type: "pause",
          agentId: "agent-user-003",
          phone: "8801715000005",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 2,
        description: "Customer sends message while AI is paused",
        customerAction: {
          senderPhone: "8801715000005",
          text: "vai price koto?",
        },
        expectations: {
          agentShouldReply: false,
          tagsExpected: {
            mustInclude: ["ai-paused"],
          },
        },
      },
      {
        step: 3,
        description: "Agent clicks Resume AI in UI",
        agentAction: {
          type: "resume",
          agentId: "agent-user-003",
          phone: "8801715000005",
        },
        expectations: {
          agentShouldReply: false,
        },
      },
      {
        step: 4,
        description: "Customer sends message after AI is resumed",
        customerAction: {
          senderPhone: "8801715000005",
          text: "bhai black polo shirt er price koto?",
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
];

describe("Tier 1 - Feature R5: Complaint Detection & Smooth Human Handoff", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of r5HandoffTestCases) {
    test(`${tc.id}: ${tc.name}`, async () => {
      for (const step of tc.steps) {
        if (step.agentAction) {
          const targetPhone = step.agentAction.phone || "8801715000000";
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
            // Should NOT have sent an AI reply
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
