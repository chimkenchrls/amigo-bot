import type { RoleName, Team } from "./types.js";

export interface RoleDef {
  name: RoleName;
  team: Team;
  acts: boolean;
  wakeIndex: number;
}

export const ROLES: Record<RoleName, RoleDef> = {
  werewolf: { name: "werewolf", team: "werewolf", acts: true, wakeIndex: 1 },
  minion: { name: "minion", team: "werewolf", acts: true, wakeIndex: 2 },
  mason: { name: "mason", team: "village", acts: true, wakeIndex: 3 },
  seer: { name: "seer", team: "village", acts: true, wakeIndex: 4 },
  robber: { name: "robber", team: "village", acts: true, wakeIndex: 5 },
  troublemaker: { name: "troublemaker", team: "village", acts: true, wakeIndex: 6 },
  insomniac: { name: "insomniac", team: "village", acts: true, wakeIndex: 7 },
  villager: { name: "villager", team: "village", acts: false, wakeIndex: 99 },
  tanner: { name: "tanner", team: "tanner", acts: false, wakeIndex: 99 },
};

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

/**
 * Deterministic bag composition. Always 2 werewolves, then the core actors,
 * then scaling roles as the table grows, Villagers filling the rest so the bag
 * is exactly playerCount + 3.
 */
export function selectRoleSet(playerCount: number): RoleName[] {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`playerCount out of range: ${playerCount}`);
  }
  const size = playerCount + 3;
  const bag: RoleName[] = ["werewolf", "werewolf", "seer", "robber", "troublemaker"];
  if (playerCount >= 5) bag.push("minion");
  if (playerCount >= 6) bag.push("insomniac");
  if (playerCount >= 7) bag.push("mason", "mason");
  if (playerCount >= 8) bag.push("tanner");
  while (bag.length < size) bag.push("villager");
  return bag.slice(0, size);
}
