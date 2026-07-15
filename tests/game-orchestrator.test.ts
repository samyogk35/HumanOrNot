import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameOrchestrator, StateStore, GameOrchestratorOptions } from '../src/game/orchestrator';
import { GameState } from '../src/game/state-machine';

// In-memory stand-in for the Redis-backed GameStateManager. The state machine's
// strictness is covered in game-state.test.ts; here we only need it to hold state.
class FakeStore implements StateStore {
  private states = new Map<string, GameState>();
  async initGame(roomId: string): Promise<void> {
    this.states.set(roomId, 'lobby');
  }
  async getState(roomId: string): Promise<GameState | null> {
    return this.states.get(roomId) ?? null;
  }
  async transition(roomId: string, target: GameState): Promise<void> {
    this.states.set(roomId, target);
  }
}

const ROOM = 'room-1';
const CHAT_MS = 1200;
const VOTE_MS = 1000;
const CADENCE_MS = 500;

function makeOrch(overrides: Partial<GameOrchestratorOptions> = {}) {
  const broadcast = vi.fn();
  const generateResponse = vi.fn().mockResolvedValue('mock bot line');
  const orch = new GameOrchestrator({
    stateStore: new FakeStore(),
    generateResponse,
    broadcast,
    chatDurationMs: CHAT_MS,
    voteDurationMs: VOTE_MS,
    botCadenceMs: CADENCE_MS,
    now: () => 1000,
    rng: () => 0, // always pick index 0 from the pools
    botNamePool: ['BOTTY'],
    personaPool: ['persona-x'],
    ...overrides,
  });
  const payloads = () => broadcast.mock.calls.map((c) => c[1] as any);
  const ofType = (type: string) => payloads().filter((p) => p.type === type);
  const lastOfType = (type: string) => ofType(type).at(-1);
  return { orch, broadcast, generateResponse, payloads, ofType, lastOfType };
}

describe('GameOrchestrator (Phase 10 integration glue)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('broadcasts the roster with exactly one hidden bot on start', async () => {
    const { orch, ofType, lastOfType } = makeOrch();
    orch.addPlayer(ROOM, { id: 1, username: 'Alice' });
    orch.addPlayer(ROOM, { id: 2, username: 'Bob' });

    await orch.startGame(ROOM);

    const users = lastOfType('users').users;
    expect(users).toHaveLength(3); // 2 humans + 1 bot
    const bot = users.find((u: any) => u.username === 'BOTTY');
    expect(bot).toEqual({ id: '-1', username: 'BOTTY' }); // wire id is a string
    users.forEach((u: any) => expect(u).not.toHaveProperty('isBot'));

    const state = lastOfType('state');
    expect(state).toMatchObject({ state: 'chatting', endsAt: 1000 + CHAT_MS });

    // Cadence hasn't fired yet, so the LLM hasn't been asked for anything.
    expect(ofType('chat')).toHaveLength(0);
  });

  it('makes the bot speak on a cadence using the injected responder + transcript', async () => {
    const { orch, generateResponse, lastOfType } = makeOrch();
    orch.addPlayer(ROOM, { id: 1, username: 'Alice' });
    await orch.startGame(ROOM);

    orch.recordMessage(ROOM, 'Alice', 'hey is anyone a bot');
    await vi.advanceTimersByTimeAsync(CADENCE_MS);

    expect(generateResponse).toHaveBeenCalledTimes(1);
    const [history, persona] = generateResponse.mock.calls[0];
    expect(persona).toBe('persona-x');
    expect(history).toContainEqual({ sender: 'Alice', text: 'hey is anyone a bot' });

    const chat = lastOfType('chat');
    expect(chat).toMatchObject({ senderId: '-1', sender: 'BOTTY', text: 'mock bot line' });
    expect(typeof chat.id).toBe('string');
  });

  it('stops the bot when the chat timer moves the room to voting', async () => {
    const { orch, generateResponse, lastOfType } = makeOrch();
    orch.addPlayer(ROOM, { id: 1, username: 'Alice' });
    await orch.startGame(ROOM);

    // Two cadence ticks happen during the 1200ms chat window (at 500, 1000).
    await vi.advanceTimersByTimeAsync(CHAT_MS);
    const callsDuringChat = generateResponse.mock.calls.length;
    expect(callsDuringChat).toBeGreaterThanOrEqual(1);
    expect(lastOfType('state')).toMatchObject({ state: 'voting', endsAt: 1000 + VOTE_MS });

    // No further bot messages once voting starts.
    await vi.advanceTimersByTimeAsync(CADENCE_MS * 3);
    expect(generateResponse.mock.calls.length).toBe(callsDuringChat);
  });

  it('rejects votes when voting is not open and rejects double votes', async () => {
    const { orch } = makeOrch();
    orch.addPlayer(ROOM, { id: 1, username: 'Alice' });
    orch.addPlayer(ROOM, { id: 2, username: 'Bob' }); // 2nd human keeps voting open after 1 vote

    // Before any game: voting closed.
    await expect(orch.castVote(ROOM, { voterId: 1, targetId: 2 })).rejects.toThrow(/not open/i);

    await orch.startGame(ROOM);
    await vi.advanceTimersByTimeAsync(CHAT_MS); // -> voting

    await orch.castVote(ROOM, { voterId: 1, targetId: -1 });
    await expect(orch.castVote(ROOM, { voterId: 1, targetId: 2 })).rejects.toThrow(/already voted/i);
  });

  it('ends voting early once every human has voted and reveals the true bot', async () => {
    const { orch, lastOfType, ofType } = makeOrch();
    orch.addPlayer(ROOM, { id: 1, username: 'Alice' });
    orch.addPlayer(ROOM, { id: 2, username: 'Bob' });
    await orch.startGame(ROOM);
    await vi.advanceTimersByTimeAsync(CHAT_MS); // -> voting

    await orch.castVote(ROOM, { voterId: 1, targetId: -1 }); // Alice fingers the bot
    expect(ofType('reveal')).toHaveLength(0); // Bob hasn't voted yet
    await orch.castVote(ROOM, { voterId: 2, targetId: 1 }); // Bob votes Alice -> all voted

    const reveal = lastOfType('reveal');
    expect(reveal.trueBotId).toBe('-1');
    expect(reveal.tally).toEqual({ '-1': 1, '1': 1 });
    expect(reveal.scores).toEqual({ '1': 1 }); // only Alice guessed the bot
    expect(lastOfType('state')).toMatchObject({ state: 'reveal', endsAt: null });
  });

  it('reveals on the vote timer when not everyone votes', async () => {
    const { orch, ofType, lastOfType } = makeOrch();
    orch.addPlayer(ROOM, { id: 1, username: 'Alice' });
    orch.addPlayer(ROOM, { id: 2, username: 'Bob' });
    await orch.startGame(ROOM);
    await vi.advanceTimersByTimeAsync(CHAT_MS); // -> voting

    await orch.castVote(ROOM, { voterId: 1, targetId: -1 });
    expect(ofType('reveal')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(VOTE_MS); // vote timer fires
    expect(lastOfType('reveal').trueBotId).toBe('-1');
    expect(ofType('reveal')).toHaveLength(1); // fired exactly once
  });

  it('resets state on play-again: a fresh bot and cleared votes', async () => {
    const { orch, lastOfType } = makeOrch();
    orch.addPlayer(ROOM, { id: 1, username: 'Alice' });

    // First game to reveal.
    await orch.startGame(ROOM);
    await vi.advanceTimersByTimeAsync(CHAT_MS);
    await orch.castVote(ROOM, { voterId: 1, targetId: -1 });
    await vi.advanceTimersByTimeAsync(VOTE_MS);
    expect(lastOfType('reveal').trueBotId).toBe('-1');

    // Play again -> new game, new bot id, no leftover votes.
    await orch.startGame(ROOM);
    const users = lastOfType('users').users;
    expect(users.find((u: any) => u.username === 'BOTTY').id).toBe('-2');
    expect(users).toHaveLength(2); // Alice + new bot (old bot removed)

    await vi.advanceTimersByTimeAsync(CHAT_MS);
    await vi.advanceTimersByTimeAsync(VOTE_MS);
    const reveal = lastOfType('reveal');
    expect(reveal.trueBotId).toBe('-2');
    expect(reveal.tally).toEqual({}); // previous game's vote did not carry over
  });
});
