import { WEREWOLF_MAX_PLAYERS, WEREWOLF_MIN_PLAYERS } from "./constants.js";

export interface Lobby {
  hostId: string;
  players: string[];
}

export function emptyLobby(hostId: string): Lobby {
  return { hostId, players: [hostId] };
}

export function addPlayer(lobby: Lobby, playerId: string): Lobby {
  if (lobby.players.includes(playerId)) return lobby;
  if (lobby.players.length >= WEREWOLF_MAX_PLAYERS) {
    throw new Error("lobby full");
  }
  return { ...lobby, players: [...lobby.players, playerId] };
}

export function removePlayer(lobby: Lobby, playerId: string): Lobby {
  if (!lobby.players.includes(playerId)) return lobby;
  return { ...lobby, players: lobby.players.filter((p) => p !== playerId) };
}

export function canStart(lobby: Lobby): boolean {
  return lobby.players.length >= WEREWOLF_MIN_PLAYERS;
}
