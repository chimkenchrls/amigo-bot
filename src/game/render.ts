import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} from "discord.js";
import type { GameState, Outcome, PlayerView, RoleName } from "./types.js";
import type { Lobby } from "./lobby.js";
import { WEREWOLF_MAX_PLAYERS, WEREWOLF_MIN_PLAYERS } from "./constants.js";

export interface MessagePayload {
  content?: string;
  embeds?: unknown[];
  components?: unknown[];
}

const BLURBS: Record<RoleName, string> = {
  werewolf: "Werewolf — team lobo. Gabi: makikita mo ang kasabwat mo.",
  minion: "Minion — team lobo. Alam mo sino ang lobo; sila hindi alam ikaw.",
  mason: "Mason — team nayon. Magkakita kayong mga mason sa gabi.",
  seer: "Seer — team nayon. Silipin ang isang manlalaro o dalawang center card.",
  robber: "Robber — team nayon. Palit card sa isa, tapos mo makikita bago mo.",
  troublemaker:
    "Troublemaker — team nayon. Palitan ang card ng dalawang iba (di mo makikita).",
  insomniac: "Insomniac — team nayon. Pagkatapos ng gabi, silip mo sariling card.",
  villager: "Villager — team nayon. Walang gagawin sa gabi.",
  tanner: "Tanner — solo. Panalo ka lang kung ikaw ang mabo-vote out.",
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
      `**One Night Werewolf** — hino-host ni AmIgo\n` +
      `${lobby.players.length}/${WEREWOLF_MAX_PLAYERS} sumali (min ${WEREWOLF_MIN_PLAYERS}):\n${list}`,
    components: [
      buttonRow(
        btn("wolf:join", "Sali", ButtonStyle.Success),
        btn("wolf:leave", "Alis", ButtonStyle.Secondary),
        btn("wolf:start", "Simulan", ButtonStyle.Primary),
        btn("wolf:cancel", "Kanselahin", ButtonStyle.Danger),
      ),
    ],
  };
}

export function renderNight(narration: string | null): MessagePayload {
  return {
    content:
      (narration ?? "🌙 Gabi na. Nakapikit ang lahat...") +
      "\n\nPindutin ang **🔍 Role Mo** para makita ang role at (kung may aksyon ka) ang **🎭 Aksyon**.",
    components: [
      buttonRow(
        btn("wolf:role", "🔍 Role Mo", ButtonStyle.Secondary),
        btn("wolf:act", "🎭 Aksyon", ButtonStyle.Primary),
        btn("wolf:skip", "⏭️ Skip (host)", ButtonStyle.Secondary),
      ),
    ],
  };
}

export function renderDay(narration: string | null, minutes: number): MessagePayload {
  return {
    content:
      (narration ?? "☀️ Umaga na.") +
      `\n\n**${minutes} minuto** kayong mag-usap, tapos boto. Pindutin ang 🔍 kung kailangan.`,
    components: [
      buttonRow(
        btn("wolf:role", "🔍 Role Mo", ButtonStyle.Secondary),
        btn("wolf:skip", "⏭️ Skip sa boto (host)", ButtonStyle.Secondary),
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
    .setPlaceholder("Sino ang ivo-vote mo?")
    .addOptions(playerOptions(names, players));
  return {
    content:
      "🗳️ **Boto na.** Pumili ng ivo-vote out. Pwede palitan hanggang matapos ang oras.",
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
  lines.push("**Ang mga role:**");
  for (const id of state.players) {
    lines.push(
      `- ${names[id] ?? id}: ${state.startingRoles[id] ?? "?"} → ${state.currentRoles[id] ?? "?"}`,
    );
  }
  lines.push(
    `**Gitna:** ${state.startingRoles["center-0"] ?? "?"}, ${state.startingRoles["center-1"] ?? "?"}, ${state.startingRoles["center-2"] ?? "?"}`,
  );
  const deaths = outcome.deaths.length
    ? outcome.deaths.map((id) => names[id] ?? id).join(", ")
    : "wala";
  lines.push(`**Namatay:** ${deaths}`);
  lines.push(outcome.summary);
  return { content: lines.join("\n") };
}

export function renderRoleEphemeral(view: PlayerView): MessagePayload & { flags: number } {
  const parts = [`**Role mo:** ${roleBlurb(view.startingRole)}`];
  if (view.nightLines.length) {
    parts.push("", "**Nalaman mo kagabi:**", ...view.nightLines);
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
      .setPlaceholder("Sino ang sisilipin mo?")
      .addOptions(playerOptions(names, actablePlayers));
    return {
      content: "Silipin ang isang manlalaro, o ang gitna.",
      components: [
        selectRow(menu),
        buttonRow(
          btn("wolf:seer:center", "Silipin ang gitna (2 card)", ButtonStyle.Secondary),
        ),
      ],
      flags,
    };
  }

  if (role === "robber") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("wolf:rob")
      .setPlaceholder("Sino ang nanakawan mo?")
      .addOptions(playerOptions(names, actablePlayers));
    return {
      content: "Sino ang nanakawan mo ng role?",
      components: [selectRow(menu)],
      flags,
    };
  }

  if (role === "troublemaker") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("wolf:tm")
      .setPlaceholder("Pumili ng dalawa.")
      .setMinValues(2)
      .setMaxValues(2)
      .addOptions(playerOptions(names, actablePlayers));
    return {
      content: "Pumili ng DALAWA na papalitan ang card.",
      components: [selectRow(menu)],
      flags,
    };
  }

  const content =
    role === "villager" || role === "tanner"
      ? "Wala kang gagawin ngayong gabi. Matulog ka na. 😴"
      : "Tapos ka na sa gabi. Sa **umaga** mo makikita ang mga nakita mo — pindutin ang 🔍 pagsapit ng araw.";
  return { content, flags };
}
