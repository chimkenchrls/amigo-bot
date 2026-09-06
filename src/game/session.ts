import type { GameSessionHandle } from "./registry.js";
import type { MessagePayload } from "./render.js";
import {
  renderActEphemeral,
  renderDay,
  renderLobby,
  renderNight,
  renderReveal,
  renderRoleEphemeral,
  renderVote,
} from "./render.js";
import type { GameMaster, Narration } from "../ai/gameMaster.js";
import type { Logger } from "../lib/log.js";
import type {
  GameState,
  NightAction,
  NightResult,
  Outcome,
  Phase,
  RoleName,
} from "./types.js";
import type { Lobby } from "./lobby.js";
import { addPlayer, canStart, emptyLobby, removePlayer } from "./lobby.js";
import {
  deal,
  decideWinner,
  pickRoleSet,
  playerView,
  resolveNight,
  tallyVotes,
} from "./engine.js";
import { ROLES } from "./roles.js";
import {
  DAY_MS,
  LOBBY_TIMEOUT_MS,
  MAX_GAME_MS,
  NARRATION_TIMEOUT_MS,
  NIGHT_MS,
  REVEAL_NARRATION_TIMEOUT_MS,
  VOTE_MS,
} from "./constants.js";

const OVER_TIME_REASON = "masyadong tumagal ang laro";

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
  private voteMsg: SentMessage | undefined;
  private revealMsg: SentMessage | undefined;
  private deaths: string[] = [];
  private activeTimer: TimerHandle | undefined;
  private maxGameTimer: TimerHandle | undefined;
  private readonly startedAt: number;

  constructor(hostId: string, deps: SessionDeps) {
    this.deps = deps;
    this.channelId = deps.channel.id;
    this.phase = "lobby";
    this.lobby = emptyLobby(hostId);
    this.names = { ...deps.names };
    this.startedAt = deps.now();
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
    this.maxGameTimer = this.deps.setTimer(MAX_GAME_MS, () =>
      void this.abort(OVER_TIME_REASON),
    );
  }

  /** True once the wall-clock budget for a single game has been exceeded. */
  private overTime(): boolean {
    return this.deps.now() - this.startedAt > MAX_GAME_MS;
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
    if (this.overTime()) {
      await this.abort(OVER_TIME_REASON);
      return;
    }
    this.phase = "night";
    this.state!.nightActions = [];
    this.arm(NIGHT_MS, () => void this.endNight());
    this.nightMsg = await this.deps.channel.send(renderNight(null));
    void this.narrateInto(
      "night",
      this.nightMsg,
      () => this.deps.gameMaster.narrateNight({ playerNames: this.playerNames() }),
      (t) => renderNight(t),
      NARRATION_TIMEOUT_MS,
    );
  }

  private playerNames(): string[] {
    return (this.state?.players ?? []).map((id) => this.names[id] ?? id);
  }

  /** Edit `msg` in place with AmIgo's flavor once it arrives; never blocks the phase, never throws. */
  private async narrateInto(
    phase: Phase,
    msg: SentMessage,
    call: () => Promise<Narration>,
    render: (text: string) => MessagePayload,
    capMs: number,
  ): Promise<void> {
    let h: TimerHandle | undefined;
    try {
      const res = await Promise.race<Narration>([
        call(),
        new Promise<Narration>((resolve) => {
          h = this.deps.setTimer(capMs, () => resolve({ ok: false }));
        }),
      ]);
      if (res.ok && this.phase === phase) {
        await msg.edit(render(res.text)).catch(() => {});
      }
    } catch (err) {
      this.deps.logger.warn("game narration failed", {
        phase,
        name: err instanceof Error ? err.name : "unknown",
      });
    } finally {
      if (h !== undefined) this.deps.clearTimer(h);
    }
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
      (id) => this.names[id] ?? id,
    );
    state.currentRoles = currentRoles;
    this.nightResults = results;
    await this.enterDay();
  }

  private async enterDay(): Promise<void> {
    if (this.overTime()) {
      await this.abort(OVER_TIME_REASON);
      return;
    }
    this.phase = "day";
    this.arm(DAY_MS, () => void this.endDay());
    const minutes = Math.round(DAY_MS / MS_PER_MINUTE);
    this.dayMsg = await this.deps.channel.send(renderDay(null, minutes));
    void this.narrateInto(
      "day",
      this.dayMsg,
      () =>
        this.deps.gameMaster.narrateDay({
          playerNames: this.playerNames(),
          minutes,
        }),
      (t) => renderDay(t, minutes),
      NARRATION_TIMEOUT_MS,
    );
  }

  private async endDay(): Promise<void> {
    if (this.phase !== "day") return;
    await this.enterVote();
  }

  private async enterVote(): Promise<void> {
    if (this.overTime()) {
      await this.abort(OVER_TIME_REASON);
      return;
    }
    this.phase = "vote";
    this.arm(VOTE_MS, () => void this.endVote());
    this.voteMsg = await this.deps.channel.send(
      renderVote(this.names, this.state!.players),
    );
  }

  /**
   * Tally the votes once (idempotent — the timer and the last `vote` can race),
   * freeze the deaths, then move to reveal.
   */
  private async endVote(): Promise<void> {
    if (this.phase !== "vote") return;
    if (this.activeTimer !== undefined) {
      this.deps.clearTimer(this.activeTimer);
      this.activeTimer = undefined;
    }
    const { deaths } = tallyVotes(this.state!.votes, this.state!.players);
    this.deaths = deaths;
    await this.enterReveal();
  }

  private async enterReveal(): Promise<void> {
    if (this.overTime()) {
      await this.abort(OVER_TIME_REASON);
      return;
    }
    this.phase = "reveal";
    if (this.activeTimer !== undefined) {
      this.deps.clearTimer(this.activeTimer);
      this.activeTimer = undefined;
    }
    const outcome = decideWinner(
      this.state!.currentRoles,
      this.deaths,
      this.state!.players,
    );
    const narration = await this.narrateReveal(outcome);
    try {
      this.revealMsg = await this.deps.channel.send(
        renderReveal(narration, this.state!, outcome, this.names),
      );
    } catch {
      /* best effort */
    }
    if (this.phase === "reveal") {
      this.phase = "done";
      this.deps.onEnd(this.channelId);
      if (this.maxGameTimer !== undefined) {
        this.deps.clearTimer(this.maxGameTimer);
        this.maxGameTimer = undefined;
      }
    }
  }

  /** Capped await for the reveal narration — the payoff line, worth a short wait. */
  private async narrateReveal(outcome: Outcome): Promise<string | null> {
    let h: TimerHandle | undefined;
    try {
      const res = await Promise.race<Narration>([
        this.deps.gameMaster.narrateReveal({
          winningTeam: outcome.winningTeam,
          deadNames: outcome.deaths.map((id) => this.names[id] ?? id),
          playerNames: this.playerNames(),
        }),
        new Promise<Narration>((resolve) => {
          h = this.deps.setTimer(REVEAL_NARRATION_TIMEOUT_MS, () =>
            resolve({ ok: false }),
          );
        }),
      ]);
      return res.ok ? res.text : null;
    } catch (err) {
      this.deps.logger.warn("game narration failed", {
        phase: "reveal",
        name: err instanceof Error ? err.name : "unknown",
      });
      return null;
    } finally {
      if (h !== undefined) this.deps.clearTimer(h);
    }
  }

  async abort(reason: string): Promise<void> {
    if (this.phase === "done") return;
    this.phase = "done";
    if (this.activeTimer !== undefined) {
      this.deps.clearTimer(this.activeTimer);
      this.activeTimer = undefined;
    }
    if (this.maxGameTimer !== undefined) {
      this.deps.clearTimer(this.maxGameTimer);
      this.maxGameTimer = undefined;
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
    if (!this.state.players.includes(id)) {
      return { content: "Hindi ka kasali sa laro." };
    }
    return renderRoleEphemeral(
      playerView(id, this.state, this.phase, this.nightResults),
    );
  }

  actPrompt(playerId: string): MessagePayload {
    if (this.state === undefined || !this.state.players.includes(playerId)) {
      return { content: "Hindi ka kasali sa laro." };
    }
    const role = this.state.startingRoles[playerId]!;
    const others = this.state.players.filter((p) => p !== playerId);
    return renderActEphemeral(role, this.names, others);
  }

  async skip(by: string): Promise<void> {
    if (this.overTime()) {
      await this.abort(OVER_TIME_REASON);
      return;
    }
    if (by !== this.hostId) throw new Error("host lang ang pwedeng mag-skip");
    switch (this.phase) {
      case "night":
        await this.endNight();
        return;
      case "day":
        await this.endDay();
        return;
      case "vote":
        await this.endVote();
        return;
      default:
        throw new Error("wala namang pwedeng i-skip ngayon");
    }
  }

  async act(playerId: string, action: NightAction): Promise<void> {
    if (this.overTime()) {
      await this.abort(OVER_TIME_REASON);
      return;
    }
    if (this.phase !== "night" || this.state === undefined) {
      throw new Error("hindi pwede 'yan ngayon");
    }
    const state = this.state;
    if (!state.players.includes(playerId)) {
      throw new Error("wala ka sa laro");
    }
    if (action.playerId !== playerId) {
      throw new Error("hindi tugma ang aksyon sa manlalaro");
    }
    if (state.nightActions.some((a) => a.playerId === playerId)) {
      throw new Error("umaksyon ka na kagabi");
    }
    const role = state.startingRoles[playerId]!;
    if (!ACTION_KINDS[role].includes(action.kind)) {
      throw new Error("mali ang aksyon para sa role mo");
    }
    if (action.kind === "seer-player" || action.kind === "robber") {
      if (!state.players.includes(action.target)) {
        throw new Error("wala sa laro ang target mo");
      }
    } else if (action.kind === "troublemaker") {
      if (
        !state.players.includes(action.a) ||
        !state.players.includes(action.b) ||
        action.a === action.b
      ) {
        throw new Error("mali ang pinili mong papalitan");
      }
    } else if (action.kind === "seer-center") {
      if (!action.centers.every((c) => c === 0 || c === 1 || c === 2)) {
        throw new Error("wala sa gitna ang pinili mo");
      }
    }
    state.nightActions.push(action);
    if (this.allActingPlayersActed()) await this.endNight();
  }

  async vote(playerId: string, target: string): Promise<void> {
    if (this.overTime()) {
      await this.abort(OVER_TIME_REASON);
      return;
    }
    if (this.phase !== "vote" || this.state === undefined) {
      throw new Error("hindi pwede 'yan ngayon");
    }
    const state = this.state;
    if (!state.players.includes(playerId)) throw new Error("wala ka sa laro");
    if (!state.players.includes(target)) throw new Error("wala sa laro ang binoto mo");
    if (playerId === target) throw new Error("bawal iboto ang sarili mo");
    state.votes[playerId] = target;
    if (Object.keys(state.votes).length === state.players.length) {
      await this.endVote();
    }
  }
}

export async function createGameSession(
  hostId: string,
  deps: SessionDeps,
): Promise<GameSession> {
  return GameSession.create(hostId, deps);
}
