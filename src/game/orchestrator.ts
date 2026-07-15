import { randomUUID } from 'crypto';
import { GameState } from './state-machine';
import { BotManager, PlayerInput } from './bot-manager';
import { VotingManager } from './voting-manager';
import { ChatTurn } from './llm-glue';

/**
 * The slice of GameStateManager the orchestrator needs. Declaring it as an
 * interface lets unit tests inject a trivial in-memory fake instead of a real
 * Redis-backed manager, while app.ts passes the real GameStateManager.
 */
export interface StateStore {
  initGame(roomId: string): Promise<void>;
  getState(roomId: string): Promise<GameState | null>;
  transition(roomId: string, target: GameState): Promise<void>;
}

/** Produces the bot's next line. Mock in Phase 10; Ollama-backed in Phase 13. */
export type ResponderFn = (
  history: ChatTurn[],
  persona: string
) => Promise<string>;

/** Publishes a payload to every subscriber of the room (Redis pub/sub in app.ts). */
export type BroadcastFn = (roomId: string, payload: object) => void;

export interface GameOrchestratorOptions {
  stateStore: StateStore;
  generateResponse: ResponderFn;
  broadcast: BroadcastFn;
  chatDurationMs?: number;
  voteDurationMs?: number;
  botCadenceMs?: number;
  historyLimit?: number;
  now?: () => number;
  rng?: () => number;
  botNamePool?: string[];
  personaPool?: string[];
}

const DEFAULT_BOT_NAMES = ['quietcat', 'mike_h', 'lurker99', 'sunny', 'dev_null', 'k8'];
const DEFAULT_PERSONAS = [
  'a laconic night-shift worker who types in lowercase and rarely uses punctuation',
  'a chatty college student who loves memes and abbreviations',
  'a dry, sarcastic person who answers questions with questions',
];

interface RoomTimers {
  chat?: NodeJS.Timeout;
  vote?: NodeJS.Timeout;
}

/**
 * Wires the tested game modules (state machine, bot manager, voting manager) into
 * a single per-room game loop: start -> chatting (bot on a cadence) -> voting ->
 * reveal. Owned by the app instance that received `start` (v1 timer-ownership; see
 * SPEC §3.3). All time, randomness, LLM calls, and transport are injected so the
 * loop is deterministically unit-testable.
 */
export class GameOrchestrator {
  private readonly stateStore: StateStore;
  private readonly generateResponse: ResponderFn;
  private readonly broadcast: BroadcastFn;
  private readonly chatDurationMs: number;
  private readonly voteDurationMs: number;
  private readonly botCadenceMs: number;
  private readonly historyLimit: number;
  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly botNamePool: string[];
  private readonly personaPool: string[];

  private readonly bots = new BotManager();
  private readonly voting = new VotingManager();
  private readonly transcripts = new Map<string, ChatTurn[]>();
  private readonly personas = new Map<string, string>();
  private readonly timers = new Map<string, RoomTimers>();
  private readonly rooms = new Set<string>();
  // Rooms mid-reveal, guarded so a vote-timer and an all-voted early end can't
  // both fire the reveal (guard is set synchronously, before any await).
  private readonly revealing = new Set<string>();
  private nextBotId = -1;

  constructor(opts: GameOrchestratorOptions) {
    this.stateStore = opts.stateStore;
    this.generateResponse = opts.generateResponse;
    this.broadcast = opts.broadcast;
    this.chatDurationMs = opts.chatDurationMs ?? 180_000;
    this.voteDurationMs = opts.voteDurationMs ?? 60_000;
    this.botCadenceMs = opts.botCadenceMs ?? 15_000;
    this.historyLimit = opts.historyLimit ?? 30;
    this.now = opts.now ?? (() => Date.now());
    this.rng = opts.rng ?? Math.random;
    this.botNamePool = opts.botNamePool ?? DEFAULT_BOT_NAMES;
    this.personaPool = opts.personaPool ?? DEFAULT_PERSONAS;
  }

  /** Add a human to the room roster (deduped by id) and broadcast the new roster. */
  addPlayer(roomId: string, player: PlayerInput): void {
    this.rooms.add(roomId);
    const existing = this.bots.getInternalPlayers(roomId);
    if (existing.some((p) => p.id === player.id)) return;
    this.bots.addHuman(roomId, player);
    this.broadcastUsers(roomId);
  }

  /** Record a human chat line into the room transcript the bot reads for context. */
  recordMessage(roomId: string, sender: string, text: string): void {
    this.pushTranscript(roomId, { sender, text });
  }

  /**
   * Start (or restart) a game: reset any prior game, move lobby -> chatting,
   * inject a fresh bot, broadcast the roster + phase, and arm the bot cadence and
   * the chat-phase timer.
   */
  async startGame(roomId: string): Promise<void> {
    this.rooms.add(roomId);
    this.resetRoom(roomId);

    await this.stateStore.initGame(roomId);
    await this.stateStore.transition(roomId, 'chatting');

    const persona = this.pick(this.personaPool);
    const username = this.pick(this.botNamePool);
    this.personas.set(roomId, persona);
    this.bots.injectBot(roomId, { id: this.nextBotId--, username });

    this.broadcastUsers(roomId);
    this.broadcast(roomId, {
      type: 'state',
      roomId,
      state: 'chatting',
      endsAt: this.now() + this.chatDurationMs,
    });

    this.bots.startBotCadence(roomId, () => void this.botSpeak(roomId), this.botCadenceMs);
    this.getTimers(roomId).chat = setTimeout(
      () => void this.endChat(roomId),
      this.chatDurationMs
    );
  }

  /**
   * Record a vote. Throws if voting isn't open or the voter already voted (the
   * caller relays the error to just the offending socket). Ends voting early once
   * every human has voted.
   */
  async castVote(
    roomId: string,
    vote: { voterId: number; targetId: number }
  ): Promise<void> {
    const state = await this.stateStore.getState(roomId);
    if (state !== 'voting') {
      throw new Error('voting is not open');
    }
    this.voting.castVote(roomId, vote); // throws on double vote
    if (this.everyHumanVoted(roomId)) {
      await this.endVoting(roomId);
    }
  }

  /** Clear all timers/cadences across rooms (called on app teardown). */
  dispose(): void {
    for (const roomId of this.rooms) {
      this.clearTimers(roomId);
      this.bots.stopBotCadence(roomId);
    }
  }

  // --- internals ---------------------------------------------------------

  private async botSpeak(roomId: string): Promise<void> {
    const bot = this.bots.getInternalPlayers(roomId).find((p) => p.isBot);
    if (!bot) return;
    const persona = this.personas.get(roomId) ?? '';
    try {
      const text = await this.generateResponse(this.getTranscript(roomId), persona);
      // The bot sees its own lines in future context, same as a human would.
      this.pushTranscript(roomId, { sender: bot.username, text });
      this.broadcast(roomId, {
        type: 'chat',
        roomId,
        id: randomUUID(),
        senderId: String(bot.id),
        sender: bot.username,
        text,
      });
    } catch {
      // A silent bot beats a crashing room; skip this tick (SPEC §7).
    }
  }

  private async endChat(roomId: string): Promise<void> {
    if ((await this.stateStore.getState(roomId)) !== 'chatting') return;
    this.bots.stopBotCadence(roomId);
    await this.stateStore.transition(roomId, 'voting');
    this.broadcast(roomId, {
      type: 'state',
      roomId,
      state: 'voting',
      endsAt: this.now() + this.voteDurationMs,
    });
    this.getTimers(roomId).vote = setTimeout(
      () => void this.endVoting(roomId),
      this.voteDurationMs
    );
  }

  private async endVoting(roomId: string): Promise<void> {
    if (this.revealing.has(roomId)) return;
    this.revealing.add(roomId);
    this.clearTimers(roomId);

    await this.stateStore.transition(roomId, 'reveal');

    const bot = this.bots.getInternalPlayers(roomId).find((p) => p.isBot);
    const botId = bot ? bot.id : this.nextBotId;
    const { tally } = this.voting.getRevealPayload(roomId, botId);
    const scores = this.voting.calculateScores(roomId, botId);

    this.broadcast(roomId, {
      type: 'reveal',
      roomId,
      trueBotId: String(botId),
      tally: stringifyKeys(tally),
      scores: stringifyKeys(scores),
    });
    this.broadcast(roomId, { type: 'state', roomId, state: 'reveal', endsAt: null });
  }

  private everyHumanVoted(roomId: string): boolean {
    const humans = this.bots.getInternalPlayers(roomId).filter((p) => !p.isBot).length;
    if (humans === 0) return false;
    const cast = Object.values(this.voting.tallyVotes(roomId)).reduce((a, b) => a + b, 0);
    return cast >= humans;
  }

  private broadcastUsers(roomId: string): void {
    const users = this.bots
      .getPublicPlayers(roomId)
      .map((p) => ({ id: String(p.id), username: p.username }));
    this.broadcast(roomId, { type: 'users', roomId, users });
  }

  private resetRoom(roomId: string): void {
    this.clearTimers(roomId);
    this.bots.removeBot(roomId);
    this.voting.clearVotes(roomId);
    this.transcripts.delete(roomId);
    this.personas.delete(roomId);
    this.revealing.delete(roomId);
  }

  private getTimers(roomId: string): RoomTimers {
    let t = this.timers.get(roomId);
    if (!t) {
      t = {};
      this.timers.set(roomId, t);
    }
    return t;
  }

  private clearTimers(roomId: string): void {
    const t = this.timers.get(roomId);
    if (!t) return;
    if (t.chat) clearTimeout(t.chat);
    if (t.vote) clearTimeout(t.vote);
    this.timers.delete(roomId);
  }

  private getTranscript(roomId: string): ChatTurn[] {
    return this.transcripts.get(roomId) ?? [];
  }

  private pushTranscript(roomId: string, turn: ChatTurn): void {
    const list = this.getTranscript(roomId);
    list.push(turn);
    if (list.length > this.historyLimit) list.shift();
    this.transcripts.set(roomId, list);
  }

  private pick<T>(pool: T[]): T {
    return pool[Math.floor(this.rng() * pool.length)];
  }
}

/** Re-key a numeric-id map as string ids for the wire (SPEC §6.2). */
function stringifyKeys(map: Record<number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) out[k] = v;
  return out;
}
