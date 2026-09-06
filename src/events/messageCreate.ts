import type { Message } from "discord.js";
import { DISCORD_UNKNOWN_MESSAGE } from "../constants.js";
import { evaluateTrigger } from "../chat/trigger.js";
import { handleChat, type ChatContext, type ChatDeps } from "../chat/handler.js";
import type { BotMessageCache } from "../lib/botMessages.js";
import type { GameRegistry } from "../game/registry.js";

export type MessageDeps = ChatDeps & {
  botMessages: BotMessageCache;
  getBotUserId: () => string;
  registry: GameRegistry;
};

export async function isReplyToBot(
  message: Message,
  botUserId: string,
  cache: BotMessageCache,
): Promise<boolean> {
  const refId = message.reference?.messageId;
  if (!refId) return false;
  if (cache.has(refId)) return true;
  try {
    const ref = await message.channel.messages.fetch(refId);
    return ref.author.id === botUserId;
  } catch {
    return false;
  }
}

export function onMessageCreate(
  deps: MessageDeps,
): (message: Message) => Promise<void> {
  const run = handleChat(deps);
  return async (message: Message): Promise<void> => {
    const botId = deps.getBotUserId();
    if (!botId) return;

    // Cheap short-circuits before any cache lookup or REST fetch: bot-authored
    // and system messages can never trigger a reply, and a message that already
    // @mentions the bot doesn't need the reply-chain check at all.
    if (message.author.bot || message.system) return;

    if (deps.registry.has(message.channelId)) return;

    const mentionsBot = message.mentions.users.has(botId);
    const replyToBot = mentionsBot
      ? false
      : await isReplyToBot(message, botId, deps.botMessages);
    const outcome = evaluateTrigger(
      {
        authorBot: message.author.bot,
        system: message.system,
        content: message.content,
        mentionsBot,
      },
      botId,
      replyToBot,
    );
    if (!outcome.respond) return;

    const channel = message.channel;
    // Narrow the v14 channel union to a text channel we can post in. The only
    // TextBasedChannel member without `sendTyping`/`send` is PartialGroupDMChannel,
    // so this `in` check statically drops it (no cast needed).
    if (!("sendTyping" in channel)) return;

    const displayName = message.member?.displayName ?? message.author.username;

    const ctx: ChatContext = {
      channelId: message.channelId,
      userId: message.author.id,
      displayName,
      text: outcome.text,
      guildId: message.guildId,
      sendTyping: () => channel.sendTyping(),
      reply: async (content) => {
        try {
          const sent = await message.reply(content);
          return { id: sent.id, edit: async (c) => void (await sent.edit(c)) };
        } catch (err) {
          if (!isUnknownMessage(err)) throw err;
          const sent = await channel.send(content);
          return { id: sent.id, edit: async (c) => void (await sent.edit(c)) };
        }
      },
      followUp: async (content) => {
        const sent = await channel.send(content);
        return { id: sent.id, edit: async (c) => void (await sent.edit(c)) };
      },
      react: (emoji) => message.react(emoji).then(() => undefined),
    };

    await run(ctx);
  };
}

function isUnknownMessage(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: number }).code === DISCORD_UNKNOWN_MESSAGE
  );
}
