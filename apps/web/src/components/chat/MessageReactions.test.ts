import { describe, expect, test } from "bun:test";
import {
  getReactorIdentityLabel,
  resolveReactorAvatarUrl,
} from "./MessageReactions";

describe("reaction identity labels", () => {
  test("shows the canonical phone number instead of a private LID", () => {
    expect(
      getReactorIdentityLabel({
        reactorJid: "277905926004845@lid",
        reactorPhoneNumber: "+841665247989",
      }),
    ).toBe("+841665247989");
  });

  test("formats a phone JID when no separately resolved number is needed", () => {
    expect(
      getReactorIdentityLabel({
        reactorJid: "841665247989@s.whatsapp.net",
      }),
    ).toBe("+841665247989");
  });

  test("resolves avatar from reaction reactorAvatarUrl when http URL is provided", () => {
    expect(
      resolveReactorAvatarUrl({
        reactorJid: "8801602585112@s.whatsapp.net",
        reactorPhoneNumber: "+8801602585112",
        reactorAvatarUrl: "https://example.com/avatar.jpg",
        isOwn: false,
      }),
    ).toBe("https://example.com/avatar.jpg");
  });

  test("falls back to group participant profilePictureUrl when reactorAvatarUrl is s3:// or null", () => {
    const participants = [
      {
        jid: "8801602585112@s.whatsapp.net",
        phoneNumber: "+8801602585112",
        mentionIds: ["8801602585112"],
        contactId: "contact-1",
        profilePictureUrl: "https://example.com/sundori.jpg",
      },
    ];

    expect(
      resolveReactorAvatarUrl(
        {
          reactorJid: "8801602585112@s.whatsapp.net",
          reactorPhoneNumber: "+8801602585112",
          reactorAvatarUrl: "s3://whatsapp-media/media/test.jpg",
          isOwn: false,
        },
        participants,
      ),
    ).toBe("https://example.com/sundori.jpg");
  });

  test("uses currentUserAvatarUrl for own reaction", () => {
    expect(
      resolveReactorAvatarUrl(
        {
          reactorJid: "current-user",
          isOwn: true,
        },
        [],
        "https://example.com/me.jpg",
      ),
    ).toBe("https://example.com/me.jpg");
  });
});
