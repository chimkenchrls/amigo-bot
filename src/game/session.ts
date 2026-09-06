import type { GameSessionHandle } from "./registry.js";
import type { MessagePayload } from "./render.js";
import { renderDay, renderLobby, renderNight, renderRoleEphemeral } from "./render.js";
import type { GameMaster } from "../ai/gameMaster.js";
import type { Logger } from "../lib/log.js";
import type { GameState, NightAction, NightResult, Phase, RoleName } from "./types.js";
import type { Lobby } from "./lobby.js";
import { addPlayer, canStart, emptyLobby, removePlayer } from "./lobby.js";
import { deal, pickRoleSet, playerView, resolveNight } from "./engine.js";
import { ROLES } from "./roles.js";
import { DAY_MS, LOBBY_TIMEOUT_MS, NIGHT_MS } from "./constants.js";

const MS_PER_MINUTE = 60_000;

/** The `NightAction.kind`s a given starting role is allowed to submit. */
const ACTION_KINDS: Record<RoleName, ReadonlyArray<NightAction["kind"]>> = {
  seer: ["seer-player", "seer-center"],
  robber: ["robber"],
  troublemaker: ["troublemaker"],
  werewolf: ["noop"],
  minion: ["noop"],
  mason: ["noop"],
  insomniac: ["noop"],
  villager: ["noop"],
  tanner: ["noop"],
};

/** A posted message the session can later edit in place. */
export interface SentMessage {
  id: string;
  edit(p: MessagePayload): Promise<void>;
}

/** The channel the game runs in — the only I/O surface the session touches. */
export interface GameChannel {
  id: string;
  send(p: MessagePayload): Promise<SentMessage>;
}

/** Opaque handle returned by `setTimer`, passed back to `clearTimer`. */
export type TimerHandle = unknown;

export interface SessionDeps {
  now(): number;
  setTimer(ms: number, fn: () => void): TimerHandle;
  clearTimer(h: TimerHandle): void;
  channel: GameChannel;
  gameMaster: GameMaster;
  rng(): number;
  logger: Logger;
  names: Record<string, string>;
  onEnd(channelId: string): void;
}

/**
 * Orchestrates one game in one channel. The single game module allowed to be
 * non-pure, but it performs no direct gateway I/O — everything goes through the
 * injected `deps`. This task implements the lobby phase, `start`/deal, the
 * transition stub into `night`, `abort`, the lobby timeout, and `showRole`.
 */
export class GameSession implements GameSessionHandle {
  readonly channelId: string;
  phase: Phase;

  private readonly deps: SessionDeps;
  private lobby: Lobby;
  private names: Record<string, string>;
  private state: GameState | undefined;
  private nightResults: NightResult[] = [];
  private lobbyMsg!: SentMessage;
  private nightMsg: SentMessage | undefined;
  private dayMsg: SentMessage | undefined;
  private activeTimer: TimerHandle | undefined;

  constructor(hostId: string, deps: SessionDeps) {
    this.deps = deps;
    this.channelId = deps.channel.id;
    this.phase = "lobby";
    this.lobby = emptyLobby(hostId);
    this.names = { ...deps.names };
  }

  /** Constructs the session, posts the lobby message, arms the lobby timeout. */
  static async create(hostId: string, deps: SessionDeps): Promise<GameSession> {
    const session = new GameSession(hostId, deps);
    await session.init();
    return session;
  }

  get hostId(): string {
    return this.lobby.hostId;
  }

  get players(): string[] {
    return this.state?.players ?? this.lobby.players;
  }

  private async init(): Promise<void> {
    this.lobbyMsg = await this.deps.channel.send(renderLobby(this.lobby, this.names));
    this.arm(LOBBY_TIMEOUT_MS, () => void this.abort("naubusan ng oras ang lobby"));
  }

  /** Arms `fn` after `ms`, clearing any previously armed timer first. */
  private arm(ms: number, fn: () => void): void {
    if (this.activeTimer !== undefined) this.deps.clearTimer(this.activeTimer);
    this.activeTimer = this.deps.setTimer(ms, fn);
  }

  async join(id: string, name: string): Promise<void> {
    if (this.phase !== "lobby") throw new Error("hindi na pwedeng sumali — nagsimula na");
    this.lobby = addPlayer(this.lobby, id);
    this.names[id] = name;
    await this.lobbyMsg.edit(renderLobby(this.lobby, this.names));
  }

  async leave(id: string): Promise<void> {
    if (this.phase !== "lobby") throw new Error("hindi na pwedeng umalis — nagsimula na");
    this.lobby = removePlayer(this.lobby, id);
    if (id === this.lobby.hostId && this.lobby.players.length > 0) {
      this.lobby = { ...this.lobby, hostId: this.lobby.players[0]! };
    }
    await this.lobbyMsg.edit(renderLobby(this.lobby, this.names));
  }

  async start(by: string): Promise<void> {
    if (this.phase !== "lobby") throw new Error("nagsimula na ang laro");
    if (by !== this.lobby.hostId) throw new Error("host lang ang pwedeng magsimula");
    if (!canStart(this.lobby)) throw new Error("kulang pa ang manlalaro");

    const roleSet = pickRoleSet(this.lobby.players.length);
    const { startingRoles } = deal(this.lobby.players, roleSet, this.deps.rng);
    this.state = {
      players: [...this.lobby.players],
      startingRoles,
      currentRoles: { ...startingRoles },
      nightActions: [],
      votes: {},
    };
    this.nightResults = [];
    await this.enterNight();
  }

  private async enterNight(): Promise<void> {
    this.phase = "night";
    this.state!.nightActions = [];
    this.arm(NIGHT_MS, () => void this.endNight());
    this.nightMsg = await this.deps.channel.send(renderNight(null));
  }

  /** True once every player whose starting role acts has an action recorded. */
  private allActingPlayersActed(): boolean {
    const state = this.state!;
    return state.players.every(
      (id) =>
        !ROLES[state.startingRoles[id]!].acts ||
        state.nightActions.some((a) => a.playerId === id),
    );
  }

  /**
   * Resolve the night once (idempotent — the timer and the last `act` can race),
   * freeze the results, then move to day.
   */
  private async endNight(): Promise<void> {
    if (this.phase !== "night") return;
    if (this.activeTimer !== undefined) {
      this.deps.clearTimer(this.activeTimer);
      this.activeTimer = undefined;
    }
    const state = this.state!;
    const { currentRoles, results } = resolveNight(
      state.startingRoles,
      state.nightActions,
    );
    state.currentRoles = currentRoles;
    this.nightResults = results;
    await this.enterDay();
  }

  private async enterDay(): Promise<void> {
    this.phase = "day";
    this.arm(DAY_MS, () => void this.endDay());
    this.dayMsg = await this.deps.channel.send(
      renderDay(null, Math.round(DAY_MS / MS_PER_MINUTE)),
    );
  }

  private async endDay(): Promise<void> {
    // filled in Task 12
  }

  async abort(reason: string): Promise<void> {
    if (this.phase === "done") return;
    this.phase = "done";
    if (this.activeTimer !== undefined) {
      this.deps.clearTimer(this.activeTimer);
      this.activeTimer = undefined;
    }
    try {
      await this.deps.channel.send({ content: `Natigil ang laro: ${reason}.` });
    } catch {
      /* best effort */
    }
    this.deps.onEnd(this.channelId);
  }

  showRole(id: string): MessagePayload {
    if (this.phase === "lobby" || this.state === undefined) {
      return { content: "Wala pang role — hindi pa nagsisimula." };
    }
    return renderRoleEphemeral(
      playerView(id, this.state, this.phase, this.nightResults),
    );
  }

  async skip(_by: string): Promise<void> {
    throw new Error("hindi pwede 'yan ngayon");
  }

  async act(playerId: string, action: NightAction): Promise<void> {
    if (this.phase !== "night" || this.state === undefined) {
      throw new Error("hindi pwede 'yan ngayon");
    }
    const state = this.state;
    if (!state.players.includes(playerId)) {
      throw new Error("wala ka sa laro");
    }
    if (state.nightActions.some((a) => a.playerId === playerId)) {
      throw new Error("umaksyon ka na kagabi");
    }
    const role = state.startingRoles[playerId]!;
    if (!ACTION_KINDS[role].includes(action.kind)) {
      throw new Error("mali ang aksyon para sa role mo");
    }
    state.nightActions.push(action);
    if (this.allActingPlayersActed()) await this.endNight();
  }

  async vote(_playerId: string, _target: string): Promise<void> {
    throw new Error("hindi pwede 'yan ngayon");
  }
}

export async function createGameSession(
  hostId: string,
  deps: SessionDeps,
): Promise<GameSession> {
  return GameSession.create(hostId, deps);
}
