import type { NightAction, NightResult, RoleName, SlotId } from "./types.js";
import { selectRoleSet } from "./roles.js";

export function pickRoleSet(playerCount: number): RoleName[] {
  return selectRoleSet(playerCount);
}

export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function deal(
  players: string[],
  roleSet: RoleName[],
  rng: () => number,
): { startingRoles: Record<SlotId, RoleName> } {
  const shuffled = shuffle(roleSet, rng);
  const startingRoles: Record<SlotId, RoleName> = {};
  players.forEach((id, idx) => {
    startingRoles[id] = shuffled[idx]!;
  });
  for (let c = 0; c < 3; c++) {
    startingRoles[`center-${c}`] = shuffled[players.length + c]!;
  }
  return { startingRoles };
}

const WAKE_ORDER: RoleName[] = [
  "werewolf", "minion", "mason", "seer", "robber", "troublemaker", "insomniac",
];

export function resolveNight(
  startingRoles: Record<SlotId, RoleName>,
  actions: NightAction[],
): { currentRoles: Record<SlotId, RoleName>; results: NightResult[] } {
  const board: Record<SlotId, RoleName> = { ...startingRoles };
  const results = new Map<string, string[]>();
  const push = (id: string, line: string) => {
    const arr = results.get(id) ?? [];
    arr.push(line);
    results.set(id, arr);
  };
  const actionFor = (playerId: string) =>
    actions.find((a) => a.playerId === playerId);
  const playerIds = Object.keys(startingRoles).filter((k) => !k.startsWith("center-"));

  for (const role of WAKE_ORDER) {
    // Sight is computed against the STARTING board; swaps mutate the current board.
    const wakers = playerIds.filter((id) => startingRoles[id] === role);
    for (const id of wakers) {
      switch (role) {
        case "werewolf": {
          const others = playerIds.filter(
            (o) => o !== id && startingRoles[o] === "werewolf",
          );
          if (others.length === 0) {
            const centerWolf = ["center-0", "center-1", "center-2"].find(
              (c) => startingRoles[c] === "werewolf",
            );
            push(id, centerWolf
              ? "Mag-isa kang lobo. May kapwa-lobo sa gitna."
              : "Mag-isa kang lobo ngayon gabi.");
          } else {
            push(id, `Kasabwat mong lobo: ${others.join(", ")}.`);
          }
          break;
        }
        case "minion": {
          const wolves = playerIds.filter((o) => startingRoles[o] === "werewolf");
          push(id, wolves.length
            ? `Ang mga lobo: ${wolves.join(", ")}. Protektahan mo sila.`
            : "Walang lobo sa mga manlalaro. Ikaw lang bahala.");
          break;
        }
        case "mason": {
          const others = playerIds.filter(
            (o) => o !== id && startingRoles[o] === "mason",
          );
          push(id, others.length
            ? `Kapwa mason: ${others.join(", ")}.`
            : "Ikaw lang ang mason. Nasa gitna ang isa pa.");
          break;
        }
        case "seer": {
          const a = actionFor(id);
          if (a?.kind === "seer-player") {
            push(id, `Ang card ni ${a.target}: ${board[a.target]}.`);
          } else if (a?.kind === "seer-center") {
            const [x, y] = a.centers;
            push(id, `Gitna #${x + 1}: ${board[`center-${x}`]}. Gitna #${y + 1}: ${board[`center-${y}`]}.`);
          }
          break;
        }
        case "robber": {
          const a = actionFor(id);
          if (a?.kind === "robber") {
            const acquired = board[a.target]!;
            board[a.target] = board[id]!;
            board[id] = acquired;
            push(id, `Ninakaw mo ang role ni ${a.target}. Ikaw na ang: ${acquired}.`);
          }
          break;
        }
        case "troublemaker": {
          const a = actionFor(id);
          if (a?.kind === "troublemaker") {
            const tmp = board[a.a]!;
            board[a.a] = board[a.b]!;
            board[a.b] = tmp;
          }
          break;
        }
        case "insomniac": {
          push(id, `Ang role mo ngayon: ${board[id]}.`);
          break;
        }
      }
    }
  }

  const list: NightResult[] = playerIds.map((id) => ({
    playerId: id,
    lines: results.get(id) ?? [],
  }));
  return { currentRoles: board, results: list };
}
