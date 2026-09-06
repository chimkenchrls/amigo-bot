import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} from "discord.js";
import type { GameState, Outcome, PlayerView, RoleName } from "./types.js";
import type { Lobby } from "./lobby.js";
import { ROLE_LABELS } from "./roles.js";
import { WEREWOLF_MAX_PLAYERS, WEREWOLF_MIN_PLAYERS } from "./constants.js";

const roleName = (role: RoleName | undefined): string =>
  role ? ROLE_LABELS[role] : "?";

export interface MessagePayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

const BLURBS: Record<RoleName, string> = {
  werewolf: "**Aswang** — Werewolf team. At night you see your fellow Aswang.",
  minion: "**Minion** — Werewolf team. You see who the Aswang are; they don't see you.",
  mason: "**Tropa** — Village team. You and the other Tropa see each other at night.",
  seer: "**Manghuhula** — Village team. Peek one player's card, or two center cards.",
  robber: "**Magnanakaw** — Village team. Swap your card with someone's, then see your new role.",
  troublemaker:
    "**Pasaway** — Village team. Swap two other players' cards without looking.",
  insomniac: "**Puyat** — Village team. At the end of the night, check your own card.",
  villager: "**Tambay** — Village team. No night action.",
  tanner: "**Martir** — Solo. You win only if you get voted out.",
};

export const roleBlurb = (role: RoleName): string => BLURBS[role];

const buttonRow = (...b: ButtonBuilder[]): unknown =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(...b).toJSON();

const selectRow = (menu: StringSelectMenuBuilder): unknown =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu).toJSON();

const btn = (id: string, label: string, style: ButtonStyle): ButtonBuilder =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

const playerOptions = (
  names: Record<string, string>,
  ids: string[],
): { label: string; value: string }[] =>
  ids.map((id) => ({ label: names[id] ?? id, value: id }));

export function renderLobby(lobby: Lobby, names: Record<string, string>): MessagePayload {
  const list = lobby.players.map((id, i) => `${i + 1}. ${names[id] ?? id}`).join("\n");
  return {
    content:
      `**One Night Werewolf** — hosted by AmIgo\n` +
      `${lobby.players.length}/${WEREWOLF_MAX_PLAYERS} joined (min ${WEREWOLF_MIN_PLAYERS}):\n${list}`,
    components: [
      buttonRow(
        btn("wolf:join", "Join", ButtonStyle.Success),
        btn("wolf:leave", "Leave", ButtonStyle.Secondary),
        btn("wolf:start", "Start", ButtonStyle.Primary),
        btn("wolf:cancel", "Cancel", ButtonStyle.Danger),
      ),
    ],
  };
}

export function renderNight(narration: string | null): MessagePayload {
  return {
    content:
      (narration ?? "🌙 Night falls. Everyone closes their eyes...") +
      "\n\nHit **🔍 My Role** to see your card, and **🎭 Act** if your role does something at night.",
    components: [
      buttonRow(
        btn("wolf:role", "🔍 My Role", ButtonStyle.Secondary),
        btn("wolf:act", "🎭 Act", ButtonStyle.Primary),
        btn("wolf:skip", "⏭️ Skip (host)", ButtonStyle.Secondary),
      ),
    ],
  };
}

export function renderDay(narration: string | null, minutes: number): MessagePayload {
  return {
    content:
      (narration ?? "☀️ Morning.") +
      `\n\nYou have **${minutes} min** to talk, then you vote. Hit 🔍 if you need it.`,
    components: [
      buttonRow(
        btn("wolf:role", "🔍 My Role", ButtonStyle.Secondary),
        btn("wolf:skip", "⏭️ Skip to vote (host)", ButtonStyle.Secondary),
      ),
    ],
  };
}

export function renderVote(
  names: Record<string, string>,
  players: string[],
): MessagePayload {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("wolf:vote")
    .setPlaceholder("Who are you voting out?")
    .addOptions(playerOptions(names, players));
  return {
    content:
      "🗳️ **Vote.** Pick who to vote out. You can change it until time's up.",
    components: [selectRow(menu)],
  };
}

export function renderReveal(
  narration: string | null,
  state: GameState,
  outcome: Outcome,
  names: Record<string, string>,
): MessagePayload {
  const lines: string[] = [];
  if (narration) {
    lines.push(narration, "");
  }
  lines.push("**The roles:**");
  for (const id of state.players) {
    lines.push(
      `- ${names[id] ?? id}: ${roleName(state.startingRoles[id])} → ${roleName(state.currentRoles[id])}`,
    );
  }
  lines.push(
    `**Center:** ${roleName(state.startingRoles["center-0"])}, ${roleName(state.startingRoles["center-1"])}, ${roleName(state.startingRoles["center-2"])}`,
  );
  const deaths = outcome.deaths.length
    ? outcome.deaths.map((id) => names[id] ?? id).join(", ")
    : "nobody";
  lines.push(`**Voted out:** ${deaths}`);
  lines.push(outcome.summary);
  return { content: lines.join("\n") };
}

export function renderRoleEphemeral(view: PlayerView): MessagePayload & { flags: number } {
  const parts = [`**Your role:** ${roleBlurb(view.startingRole)}`];
  if (view.nightLines.length) {
    parts.push("", "**What you learned last night:**", ...view.nightLines);
  }
  return { content: parts.join("\n"), flags: MessageFlags.Ephemeral };
}

export function renderActEphemeral(
  role: RoleName,
  names: Record<string, string>,
  actablePlayers: string[],
): MessagePayload & { flags: number } {
  const flags = MessageFlags.Ephemeral;

  if (role === "seer") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("wolf:seer:player")
      .setPlaceholder("Whose card do you want to see?")
      .addOptions(playerOptions(names, actablePlayers));
    return {
      content: "Peek at one player's card, or two of the center cards.",
      components: [
        selectRow(menu),
        buttonRow(
          btn("wolf:seer:center", "Look at the center (2 cards)", ButtonStyle.Secondary),
        ),
      ],
      flags,
    };
  }

  if (role === "robber") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("wolf:rob")
      .setPlaceholder("Who do you want to rob?")
      .addOptions(playerOptions(names, actablePlayers));
    return {
      content: "Whose role do you want to steal?",
      components: [selectRow(menu)],
      flags,
    };
  }

  if (role === "troublemaker") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("wolf:tm")
      .setPlaceholder("Pick two.")
      .setMinValues(2)
      .setMaxValues(2)
      .addOptions(playerOptions(names, actablePlayers));
    return {
      content: "Pick TWO players whose cards to swap.",
      components: [selectRow(menu)],
      flags,
    };
  }

  const content =
    role === "villager" || role === "tanner"
      ? "Nothing to do tonight. Get some sleep. 😴"
      : "You're done for the night. You'll see what you learned in the **morning** — hit 🔍 when day breaks.";
  return { content, flags };
}
