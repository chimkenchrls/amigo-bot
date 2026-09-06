export type Team = "village" | "werewolf" | "tanner";

export type RoleName =
  | "werewolf"
  | "minion"
  | "mason"
  | "seer"
  | "robber"
  | "troublemaker"
  | "insomniac"
  | "villager"
  | "tanner";

export type Phase = "lobby" | "night" | "day" | "vote" | "reveal" | "done";

/** slotId is a playerId, or "center-0" | "center-1" | "center-2". */
export type SlotId = string;

export interface GameState {
  players: string[];
  startingRoles: Record<SlotId, RoleName>;
  currentRoles: Record<SlotId, RoleName>;
  nightActions: NightAction[];
  votes: Record<string, string>;
}

export type NightAction =
  | { kind: "noop"; playerId: string }
  | { kind: "seer-player"; playerId: string; target: string }
  | { kind: "seer-center"; playerId: string; centers: [number, number] }
  | { kind: "robber"; playerId: string; target: string }
  | { kind: "troublemaker"; playerId: string; a: string; b: string };

/** What one player learned during the night, frozen at their wake moment. */
export interface NightResult {
  playerId: string;
  lines: string[];
}

export interface Outcome {
  winningTeam: Team;
  deaths: string[];
  summary: string;
}

export interface PlayerView {
  startingRole: RoleName;
  nightLines: string[];
  revealed: boolean;
}
