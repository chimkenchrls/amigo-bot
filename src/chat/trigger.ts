export function stripMention(content: string, botUserId: string): string {
  return content
    .replace(new RegExp(`<@!?${botUserId}>`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TriggerMessage {
  authorBot: boolean;
  system: boolean;
  content: string;
  mentionsBot: boolean;
}

export interface TriggerOutcome {
  respond: boolean;
  text: string;
}

export function evaluateTrigger(
  msg: TriggerMessage,
  botUserId: string,
  isReplyToBot: boolean,
): TriggerOutcome {
  if (msg.authorBot || msg.system) return { respond: false, text: "" };
  const respond = msg.mentionsBot || isReplyToBot;
  const stripped = stripMention(msg.content, botUserId);
  return {
    respond,
    text: stripped || "(just pinged you with no message)",
  };
}
