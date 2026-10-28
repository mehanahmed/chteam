import { beforeEach, describe, expect, test } from "bun:test";
import { OpaqueBoxHarness } from "../harness/opaque-box-harness.js";
import type { E2ETestCase } from "../types.js";

export const r4OrderBookingTestCases: E2ETestCase[] = [
  {
    id: "T1-R4-01",
    name: "Inside Dhaka COD Order Booking Complete Path",
    tier: 1,
    feature: "R4",
    description:
      "Customer provides full details in one message for Dhaka. Order is created in WooCommerce and confirmation summary sent.",
    steps: [
      {
        step: 1,
        description: "Customer submits full order details in Dhanmondi, Dhaka",
        customerAction: {
          senderPhone: "8801714000001",
          text: "Name: Tanvir Ahmed, Phone: 01711223344, Address: House 12, Road 4, Dhanmondi, Dhaka. 1 Panjabi order confirm koren.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Order ID", "1800", "60", "1860", "Dhanmondi"],
          orderExpected: {
            created: true,
            deliveryZone: "inside_dhaka",
            deliveryFee: 60,
            total: 1860,
            status: "processing",
          },
        },
      },
    ],
  },
  {
    id: "T1-R4-02",
    name: "Conversational Slot Filling for Missing Phone and Address",
    tier: 1,
    feature: "R4",
    description:
      "Customer provides name and item only. AI prompts for phone and address, then creates order once provided.",
    steps: [
      {
        step: 1,
        description: "Customer provides only name and product",
        customerAction: {
          senderPhone: "8801714000002",
          text: "Name: Tanvir, 1 Panjabi lagbe",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["মোবাইল নম্বর", "ঠিকানা"],
          orderExpected: {
            created: false,
          },
        },
      },
      {
        step: 2,
        description: "Customer supplies 11-digit phone and full address",
        customerAction: {
          senderPhone: "8801714000002",
          text: "Phone: 01711223344, Address: House 12, Road 4, Dhanmondi, Dhaka",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Order ID", "1860"],
          orderExpected: {
            created: true,
            status: "processing",
          },
        },
      },
    ],
  },
  {
    id: "T1-R4-03",
    name: "Sub-Dhaka Zone Detection (Savar/Gazipur/Narayanganj)",
    tier: 1,
    feature: "R4",
    description:
      "Customer provides Savar address. Delivery zone classified as sub_dhaka with ৳100 delivery fee.",
    steps: [
      {
        step: 1,
        description: "Customer orders to Savar Bazar",
        customerAction: {
          senderPhone: "8801714000003",
          text: "Name: Kamal, Phone: 01711223344, Address: House 5, Road 2, Savar Thana Road, Savar Bazar, Savar. 1 Panjabi.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Order ID", "100", "1900"],
          orderExpected: {
            created: true,
            deliveryZone: "sub_dhaka",
            deliveryFee: 100,
            total: 1900,
            status: "processing",
          },
        },
      },
    ],
  },
  {
    id: "T1-R4-04",
    name: "Outside Dhaka Advance Payment Guard (RTO Loss Prevention)",
    tier: 1,
    feature: "R4",
    description:
      "Customer orders to Chittagong. Classified as outside_dhaka (৳120). Order placed in on-hold status awaiting delivery advance.",
    steps: [
      {
        step: 1,
        description: "Customer orders to Chittagong",
        customerAction: {
          senderPhone: "8801714000004",
          text: "Name: Mehedi Hasan, Phone: 01819876543, Address: House 12, GEC Circle, Chittagong. 1 Panjabi.",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["120", "অগ্রিম", "বিকাশ", "1920"],
          orderExpected: {
            created: true,
            deliveryZone: "outside_dhaka",
            deliveryFee: 120,
            total: 1920,
            status: "on-hold",
          },
        },
      },
    ],
  },
  {
    id: "T1-R4-05",
    name: "Coupon Code Calculation Engine",
    tier: 1,
    feature: "R4",
    description:
      "Customer applies WELCOME10 coupon on ৳2000 subtotal in Dhaka. Formula calculates discount: ৳2000 - ৳200 + ৳60 = ৳1860.",
    steps: [
      {
        step: 1,
        description: "Customer orders with WELCOME10 coupon code",
        customerAction: {
          senderPhone: "8801714000005",
          text: "Name: Farhan, Phone: 01711223344, Address: Gulshan 2, Dhaka. 1 Panjabi, coupon: WELCOME10",
        },
        expectations: {
          agentShouldReply: true,
          replyMustContain: ["Order ID", "1680"],
          orderExpected: {
            created: true,
            total: 1680,
            status: "processing",
          },
        },
      },
    ],
  },
];

describe("Tier 1 - Feature R4: In-Chat Order Collection & Placement", () => {
  let harness: OpaqueBoxHarness;

  beforeEach(async () => {
    harness = new OpaqueBoxHarness();
    await harness.initialize();
  });

  for (const tc of r4OrderBookingTestCases) {
    test(`${tc.id}: ${tc.name}`, async () => {
      for (const step of tc.steps) {
        if (step.customerAction) {
          await harness.sendCustomerWhatsAppMessage(step.customerAction);
          const reply = harness.getLastOutboundReply(
            step.customerAction.senderPhone,
          );

          if (step.expectations.agentShouldReply) {
            expect(reply).not.toBeNull();
            if (step.expectations.replyMustContain && reply) {
              for (const token of step.expectations.replyMustContain) {
                expect(reply.text.toLowerCase()).toContain(token.toLowerCase());
              }
            }
          }

          if (step.expectations.orderExpected) {
            const orders = harness.getCreatedOrders();
            if (step.expectations.orderExpected.created) {
              expect(orders.length).toBeGreaterThan(0);
              const lastOrder = harness.getLastCreatedOrder();
              expect(lastOrder).not.toBeNull();
              if (step.expectations.orderExpected.status) {
                expect(lastOrder?.status).toBe(
                  step.expectations.orderExpected.status,
                );
              }
              if (step.expectations.orderExpected.deliveryFee !== undefined) {
                const shippingLine = lastOrder?.shipping_lines[0];
                expect(Number(shippingLine?.total)).toBe(
                  step.expectations.orderExpected.deliveryFee,
                );
              }
              if (step.expectations.orderExpected.total !== undefined) {
                expect(Number(lastOrder?.total)).toBe(
                  step.expectations.orderExpected.total,
                );
              }
            } else {
              expect(orders.length).toBe(0);
            }
          }
        }
      }
    });
  }
});
