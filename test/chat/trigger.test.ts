import { describe, it, expect } from "vitest";
import { stripMention, evaluateTrigger, mentionsName } from "../../src/chat/trigger.js";

describe("stripMention", () => {
  it("removes the bot mention tokens and trims", () => {
    expect(stripMention("<@123> hey there", "123")).toBe("hey there");
    expect(stripMention("hey <@!123> there", "123")).toBe("hey there");
  });
  it("leaves other mentions intact", () => {
    expect(stripMention("<@999> yo <@123>", "123")).toBe("<@999> yo");
  });
});

const m = (over: Partial<Parameters<typeof evaluateTrigger>[0]> = {}) => ({
  authorBot: false,
  system: false,
  content: "<@123> hi",
  mentionsBot: true,
  ...over,
});

describe("evaluateTrigger", () => {
  it("responds to a mention with stripped text", () => {
    expect(evaluateTrigger(m(), "123", false)).toEqual({
      respond: true,
      text: "hi",
    });
  });
  it("ignores bots and system messages", () => {
    expect(evaluateTrigger(m({ authorBot: true }), "123", false).respond).toBe(false);
    expect(evaluateTrigger(m({ system: true }), "123", false).respond).toBe(false);
  });
  it("responds to a reply-to-bot even without a mention", () => {
    expect(
      evaluateTrigger(m({ mentionsBot: false, content: "no ping" }), "123", true),
    ).toEqual({ respond: true, text: "no ping" });
  });
  it("uses a placeholder for a bare ping", () => {
    expect(evaluateTrigger(m({ content: "<@123>" }), "123", false)).toEqual({
      respond: true,
      text: "(just pinged you with no message)",
    });
  });
  it("does not respond when neither mentioned nor a reply nor named", () => {
    expect(
      evaluateTrigger(m({ mentionsBot: false, content: "just talking" }), "123", false).respond,
    ).toBe(false);
  });

  it("responds when the message just says the name in text", () => {
    expect(
      evaluateTrigger(
        m({ mentionsBot: false, content: "hey amigo, what's up" }),
        "123",
        false,
      ),
    ).toEqual({ respond: true, text: "hey amigo, what's up" });
  });
});

describe("mentionsName", () => {
  it("matches 'amigo' as a standalone word, any case", () => {
    expect(mentionsName("amigo")).toBe(true);
    expect(mentionsName("oi AMIGO!")).toBe(true);
    expect(mentionsName("what do you think, Amigo?")).toBe(true);
  });
  it("does not match substrings or other words", () => {
    expect(mentionsName("hola amigos")).toBe(false);
    expect(mentionsName("mi amiga")).toBe(false);
    expect(mentionsName("amigobot")).toBe(false);
    expect(mentionsName("just talking here")).toBe(false);
  });
});
